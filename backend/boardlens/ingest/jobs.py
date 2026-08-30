"""인제스트 잡 큐.

Redis 도 Celery 도 쓰지 않는다. 폐쇄망 온프렘에서는 운영 인력이 붙는 미들웨어 하나하나가
비용이고, 하루 수십 건 규모에 별도 브로커는 과잉이다. PostgreSQL 의
``SELECT … FOR UPDATE SKIP LOCKED`` 로 충분하며, 잡 상태를 같은 트랜잭션에서 볼 수 있어
재파싱·실패 추적도 단순해진다. 처리량이 문제가 되는 시점에 교체하면 되고, 그 시점은
오지 않을 가능성이 높다.
"""

from __future__ import annotations

import os
import socket
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from boardlens.db import models as m
from boardlens.ingest.pipeline import IngestResult, ingest_payload
from boardlens.storage import BlobStore

MAX_ATTEMPTS = 3


def worker_id() -> str:
    return f"{socket.gethostname()}:{os.getpid()}"


def enqueue(session: Session, revision_id: str, *, parser_name: str | None = None) -> m.IngestJob:
    job = m.IngestJob(revision_id=revision_id, state="uploaded", parser_name=parser_name)
    session.add(job)
    session.flush()
    return job


def enqueue_reparse(session: Session, *, parser_name: str, below_version: str) -> int:
    """파서 버전이 올라갔을 때 옛 버전으로 들어온 리비전을 전부 다시 큐에 넣는다.

    재파싱은 예외 상황이 아니라 정기 작업이다 — 파서는 앞으로도 계속 고쳐진다.
    """
    stale = session.scalars(
        select(m.Revision).where(
            m.Revision.parser_name == parser_name,
            (m.Revision.parser_version.is_(None)) | (m.Revision.parser_version < below_version),
        )
    ).all()
    for rev in stale:
        enqueue(session, rev.id, parser_name=parser_name)
    return len(stale)


def claim(session: Session, *, worker: str | None = None) -> m.IngestJob | None:
    """대기 중인 잡 하나를 잠근다.

    SKIP LOCKED 는 워커를 여러 개 띄웠을 때 서로 같은 잡을 붙들고 기다리지 않게 한다.
    SQLite 에는 없는 기능이라 단일 워커 전제로 물러선다 — 테스트 환경에서만 해당한다.
    """
    stmt = (
        select(m.IngestJob)
        .where(m.IngestJob.state.in_(("uploaded", "failed")), m.IngestJob.attempts < MAX_ATTEMPTS)
        .order_by(m.IngestJob.created_at)
        .limit(1)
    )
    if session.bind is not None and session.bind.dialect.name == "postgresql":
        stmt = stmt.with_for_update(skip_locked=True)

    job = session.scalar(stmt)
    if job is None:
        return None
    job.state = "parsing"
    job.attempts += 1
    job.locked_by = worker or worker_id()
    job.started_at = datetime.now(timezone.utc)
    session.flush()
    return job


def run_job(
    session: Session,
    store: BlobStore,
    job: m.IngestJob,
    *,
    actor: str = "system",
    geometry_root: Path | None = None,
) -> IngestResult:
    """잡 하나를 처리한다. 원본은 blob 스토어에 남아 있으므로 언제든 다시 돌릴 수 있다."""
    design_file = session.scalar(
        select(m.DesignFile)
        .where(m.DesignFile.revision_id == job.revision_id)
        .order_by(m.DesignFile.uploaded_at.desc())
    )
    if design_file is None:
        job.state = "failed"
        job.error = "원본 파일이 없습니다 — 업로드 기록을 확인하세요"
        job.finished_at = datetime.now(timezone.utc)
        session.flush()
        return IngestResult(revision_id=job.revision_id, state="failed", error=job.error)

    payload = store.get(design_file.storage_key)
    return ingest_payload(
        session, store,
        payload=payload, filename=design_file.filename, actor=actor,
        adapter_name=job.parser_name, geometry_root=geometry_root,
    )


def run_pending(
    session: Session,
    store: BlobStore,
    *,
    limit: int = 50,
    geometry_root: Path | None = None,
) -> list[IngestResult]:
    out: list[IngestResult] = []
    for _ in range(limit):
        job = claim(session)
        if job is None:
            break
        out.append(run_job(session, store, job, geometry_root=geometry_root))
    return out
