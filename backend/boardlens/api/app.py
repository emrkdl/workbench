"""bl-core — REST API.

프론트가 목데이터에서 쓰던 것과 **같은 모양**을 낸다. cdm/schema 에서 생성된 같은 타입을
쓰기 때문이고, 그래서 프론트에서 바꿀 것은 `web/src/lib/api.ts` 의 주소 하나뿐이다.

기하 버퍼(.blg)만 이 JSON API 를 거치지 않는다. 브라우저가 blob 스토어에서 직접 받아
GPU 로 올린다 — 설계 문서 Fig 01 의 ".blg 직스트림" 경로다. 여기서는 권한 확인을 거쳐
바이트를 그대로 흘려보내는 얇은 통로만 제공한다.
"""

from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from boardlens import auth
from boardlens.cdm.api_v1 import (
    BoardPage,
    ChangeSet,
    ChangeSetIndex,
    ChangeSetKind,
    ChangeSetRef,
    PartDetail,
    PartIndex,
    PortfolioStats,
    RevisionDetail,
)
from boardlens.db import models as m
from boardlens.db import queries
from boardlens.db.session import get_session
from boardlens.diff.engine import diff
from boardlens.ingest import jobs
from boardlens.ingest.pipeline import ingest_payload
from boardlens.storage import BlobStore, default_store
from boardlens.units import DEFAULT_MOVE_THRESHOLD_NM

app = FastAPI(title="BoardLens API", version="1.0.0", docs_url="/api/docs", openapi_url="/api/openapi.json")

# 운영에서는 nginx 가 API 와 정적 파일을 같은 오리진으로 묶으므로 CORS 가 필요 없다.
# 개발에서 Vite(5174)와 API(8000)가 갈리는 동안만 허용 목록을 연다.
_origins = [o for o in os.environ.get("BOARDLENS_CORS_ORIGINS", "").split(",") if o]
if _origins:
    app.add_middleware(
        CORSMiddleware, allow_origins=_origins, allow_credentials=False,
        allow_methods=["*"], allow_headers=["*"],
    )

_store: BlobStore = default_store()


def store() -> BlobStore:
    return _store


def set_store(s: BlobStore) -> None:
    """테스트와 배포 스크립트가 스토어를 갈아 끼울 때 쓴다."""
    global _store
    _store = s


SessionDep = Annotated[Session, Depends(get_session)]


def current_user(
    session: SessionDep,
    authorization: Annotated[str | None, Header()] = None,
) -> auth.Principal:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "로그인이 필요합니다")
    user_id = auth.read_token(authorization.split(" ", 1)[1])
    if user_id is None:
        raise HTTPException(401, "세션이 만료되었습니다. 다시 로그인하세요")
    principal = auth.PROVIDER.load(session, user_id)
    if principal is None:
        raise HTTPException(401, "사용 중지된 계정입니다")
    return principal


UserDep = Annotated[auth.Principal, Depends(current_user)]


def require(action: str):
    def dependency(user: UserDep) -> auth.Principal:
        if not user.can(action):
            required = auth.PERMISSIONS.get(action, "?")
            raise HTTPException(403, f"권한이 부족합니다 — {action} 에는 {required} 이상이 필요합니다")
        return user

    return dependency


# ── 인증 ──────────────────────────────────────


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    token: str
    username: str
    display_name: str
    role: str
    projects: list[str]


@app.post("/api/auth/login", response_model=LoginResponse)
def login(body: LoginRequest, session: SessionDep, request: Request) -> LoginResponse:
    principal = auth.PROVIDER.authenticate(session, body.username, body.password)
    if principal is None:
        # 사용자 이름이 틀린 것인지 비밀번호가 틀린 것인지 구분해 주지 않는다.
        raise HTTPException(401, "아이디 또는 비밀번호가 맞지 않습니다")
    auth.audit(session, principal, "login", "user", principal.id, ip=request.client.host if request.client else None)
    return LoginResponse(
        token=auth.issue_token(principal.id), username=principal.username,
        display_name=principal.display_name, role=principal.role, projects=list(principal.projects),
    )


@app.get("/api/auth/me", response_model=LoginResponse)
def me(user: UserDep) -> LoginResponse:
    return LoginResponse(
        token="", username=user.username, display_name=user.display_name,
        role=user.role, projects=list(user.projects),
    )


@app.get("/api/health")
def health(session: SessionDep) -> dict:
    ready = session.scalar(
        select(m.Revision).where(m.Revision.ingest_state == "ready").limit(1)
    )
    return {
        "status": "ok",
        "database": "connected",
        "has_data": ready is not None,
        "auth_provider": getattr(auth.PROVIDER, "name", "unknown"),
    }


# ── 카탈로그 · 리비전 ──────────────────────────


@app.get("/api/catalog", response_model=BoardPage)
def catalog(session: SessionDep, user: Annotated[auth.Principal, Depends(require("board.read"))]) -> BoardPage:
    return queries.board_page(session, projects=user.projects)


@app.get("/api/revisions/{revision_id}", response_model=RevisionDetail)
def revision(
    revision_id: str,
    session: SessionDep,
    user: Annotated[auth.Principal, Depends(require("revision.read"))],
) -> RevisionDetail:
    detail = queries.revision_detail(session, revision_id)
    if detail is None:
        raise HTTPException(404, "리비전을 찾을 수 없습니다")
    if not user.sees_project(detail.project_key):
        raise HTTPException(403, "이 프로젝트를 볼 권한이 없습니다")
    return detail


@app.get("/api/geometry/{revision_id}/{layer_index}")
def geometry(
    revision_id: str,
    layer_index: int,
    session: SessionDep,
    _: Annotated[auth.Principal, Depends(require("geometry.read"))],
    blobs: Annotated[BlobStore, Depends(store)],
) -> Response:
    row = session.scalar(
        select(m.LayerGeometry).where(
            m.LayerGeometry.revision_id == revision_id, m.LayerGeometry.layer_index == layer_index
        )
    )
    if row is None or not blobs.exists(row.storage_key):
        raise HTTPException(404, "레이어 기하 버퍼가 없습니다")
    # 이미 gzip 으로 저장돼 있다. 풀었다 다시 압축하지 않고 그대로 흘려보낸다.
    return Response(
        content=blobs.get(row.storage_key),
        media_type="application/octet-stream",
        headers={"Content-Encoding": "gzip", "Cache-Control": "private, max-age=604800"},
    )


@app.get("/api/files/{file_id}/download")
def download(
    file_id: str,
    session: SessionDep,
    request: Request,
    user: Annotated[auth.Principal, Depends(require("file.download"))],
    blobs: Annotated[BlobStore, Depends(store)],
) -> StreamingResponse:
    row = session.get(m.DesignFile, file_id)
    if row is None or not blobs.exists(row.storage_key):
        raise HTTPException(404, "파일을 찾을 수 없습니다")
    # 원본 다운로드는 예외 없이 남긴다. 설계 데이터가 어디로 나갔는지 모르는 상태를 만들지 않는다.
    auth.audit(
        session, user, "download", "design_file", file_id,
        ip=request.client.host if request.client else None,
        detail={"filename": row.filename, "sha256": row.sha256},
    )
    return StreamingResponse(
        blobs.open(row.storage_key),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{row.filename}"'},
    )


# ── 비교 ──────────────────────────────────────


def _pair_key(a: str, b: str) -> str:
    return f"{a}__{b}"


@app.get("/api/changesets", response_model=ChangeSetIndex)
def changeset_index(
    session: SessionDep,
    _: Annotated[auth.Principal, Depends(require("compare.read"))],
) -> ChangeSetIndex:
    """같은 보드의 인접 리비전 쌍. 실제 계산은 요청받은 시점에 한다."""
    pairs: list[ChangeSetRef] = []
    boards = {b.id: b for b in session.scalars(select(m.Board)).all()}
    by_board: dict[str, list[m.Revision]] = {}
    for r in session.scalars(
        select(m.Revision).where(m.Revision.ingest_state == "ready").order_by(m.Revision.created_at)
    ).all():
        by_board.setdefault(r.board_id, []).append(r)

    for board_id, revs in by_board.items():
        board = boards[board_id]
        for i in range(len(revs)):
            for j in range(i + 1, len(revs)):
                cs = _changeset(session, revs[i].id, revs[j].id)
                pairs.append(
                    ChangeSetRef(
                        revision_a_id=revs[i].id, revision_b_id=revs[j].id,
                        board_key=board.board_key, board_name=board.name,
                        label_a=revs[i].label, label_b=revs[j].label,
                        kind=ChangeSetKind.REVISION, generated_at=cs.generated_at, stats=cs.stats,
                    )
                )
    return ChangeSetIndex(pairs=pairs, move_threshold_nm=DEFAULT_MOVE_THRESHOLD_NM)


_CACHE: dict[tuple[str, str, str | None], ChangeSet] = {}


def _changeset(session: Session, a: str, b: str) -> ChangeSet:
    """(rev_a, rev_b, parser_version) 로 캐시한다. 파서가 갱신되면 자동으로 무효가 된다."""
    rev_b = session.get(m.Revision, b)
    key = (a, b, rev_b.parser_version if rev_b else None)
    hit = _CACHE.get(key)
    if hit is not None:
        return hit

    design_a = queries.reconstruct_design(session, a)
    design_b = queries.reconstruct_design(session, b)
    if design_a is None or design_b is None:
        raise HTTPException(404, "비교할 리비전을 찾을 수 없습니다")
    result = diff(design_a, design_b, a, b)
    _CACHE[key] = result
    return result


@app.get("/api/changesets/{revision_a}/{revision_b}", response_model=ChangeSet)
def changeset(
    revision_a: str,
    revision_b: str,
    session: SessionDep,
    _: Annotated[auth.Principal, Depends(require("compare.read"))],
) -> ChangeSet:
    return _changeset(session, revision_a, revision_b)


# ── 분석 ──────────────────────────────────────


@app.get("/api/parts", response_model=PartIndex)
def parts(session: SessionDep, _: Annotated[auth.Principal, Depends(require("board.read"))]) -> PartIndex:
    return queries.part_index(session)


@app.get("/api/parts/{part_id}", response_model=PartDetail)
def part(
    part_id: str,
    session: SessionDep,
    _: Annotated[auth.Principal, Depends(require("board.read"))],
) -> PartDetail:
    detail = queries.part_detail(session, part_id)
    if detail is None:
        raise HTTPException(404, "부품을 찾을 수 없습니다")
    return detail


@app.get("/api/insights", response_model=PortfolioStats)
def insights(session: SessionDep, _: Annotated[auth.Principal, Depends(require("board.read"))]) -> PortfolioStats:
    return queries.insights(session)


# ── 관리 ──────────────────────────────────────


class IngestResponse(BaseModel):
    revision_id: str
    state: str
    error: str | None = None
    warnings: list[dict] = []


@app.post("/api/ingest", response_model=IngestResponse)
async def ingest(
    file: UploadFile,
    session: SessionDep,
    user: Annotated[auth.Principal, Depends(require("revision.upload"))],
    blobs: Annotated[BlobStore, Depends(store)],
    project_key: str | None = None,
) -> IngestResponse:
    payload = await file.read()
    result = ingest_payload(
        session, blobs, payload=payload, filename=file.filename or "upload.bin",
        actor=user.username, project_key=project_key,
        geometry_root=Path(os.environ["BOARDLENS_GEOMETRY_ROOT"])
        if os.environ.get("BOARDLENS_GEOMETRY_ROOT")
        else None,
    )
    return IngestResponse(
        revision_id=result.revision_id, state=result.state,
        error=result.error, warnings=result.warnings,
    )


@app.get("/api/admin/jobs")
def job_list(session: SessionDep, _: Annotated[auth.Principal, Depends(require("revision.reparse"))]) -> list[dict]:
    return [
        {
            "id": j.id, "revision_id": j.revision_id, "state": j.state, "attempts": j.attempts,
            "parser": j.parser_name, "parser_version": j.parser_version, "error": j.error,
            "created_at": j.created_at.isoformat(),
        }
        for j in session.scalars(select(m.IngestJob).order_by(m.IngestJob.created_at.desc()).limit(200)).all()
    ]


class ReparseRequest(BaseModel):
    parser_name: str
    below_version: str


@app.post("/api/admin/reparse")
def reparse(
    body: ReparseRequest,
    session: SessionDep,
    user: Annotated[auth.Principal, Depends(require("revision.reparse"))],
) -> dict:
    """파서 버전이 올라갔을 때 옛 버전으로 들어온 리비전을 전부 다시 큐에 넣는다."""
    count = jobs.enqueue_reparse(session, parser_name=body.parser_name, below_version=body.below_version)
    auth.audit(session, user, "reparse", "parser", body.parser_name, detail=body.model_dump())
    _CACHE.clear()
    return {"queued": count}


@app.get("/api/admin/audit")
def audit_log(
    session: SessionDep,
    _: Annotated[auth.Principal, Depends(require("audit.read"))],
    limit: int = 200,
) -> list[dict]:
    return [
        {
            "at": a.at.isoformat(), "actor": a.actor, "action": a.action,
            "target": f"{a.target_type}:{a.target_id}", "ip": a.ip, "detail": a.detail,
        }
        for a in session.scalars(select(m.AuditLog).order_by(m.AuditLog.at.desc()).limit(limit)).all()
    ]


@app.get("/api/meta")
def meta(session: SessionDep) -> dict:
    counts = {
        "boards": session.scalar(select(m.Board.id).limit(1)) is not None,
    }
    return {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "cdm_version": "1.0.0",
        "has_boards": counts["boards"],
    }
