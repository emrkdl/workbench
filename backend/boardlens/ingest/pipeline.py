"""인제스트 파이프라인.

    uploaded → parsing → normalizing → indexing → ready
                  ↘         ↓            ↙
                        failed

모든 단계가 원본 파일을 소모하지 않는다. 그래서 어느 단계에서 실패하든, 그리고 파서를
개선했을 때든 parsing 부터 다시 돌릴 수 있다. **재파싱이 예외가 아니라 정규 경로**라는
것이 이 설계의 요지다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import delete, insert, select
from sqlalchemy.orm import Session

from boardlens.analytics.parts import normalize_mpn
from boardlens.cdm.cdm_v1 import Design
from boardlens.db import models as m
from boardlens.ingest.normalize import normalize
from boardlens.ingest.summarize import summarize
from boardlens.ingest.validate import IntegrityError, validate
from boardlens.parser import REGISTRY, ParseError
from boardlens.storage import BlobStore, design_key, sha256

STATES = ("uploaded", "parsing", "normalizing", "indexing", "ready", "failed")


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


@dataclass
class IngestResult:
    revision_id: str
    state: str
    warnings: list[dict] = field(default_factory=list)
    error: str | None = None
    parser_name: str | None = None
    parser_version: str | None = None


def _set_state(session: Session, revision_id: str, state: str, error: str | None = None) -> None:
    rev = session.get(m.Revision, revision_id)
    if rev is not None:
        rev.ingest_state = state
        rev.ingest_error = error
    job = session.scalar(
        select(m.IngestJob).where(m.IngestJob.revision_id == revision_id).order_by(m.IngestJob.id.desc())
    )
    if job is not None:
        job.state = state
        job.error = error
        if state in ("ready", "failed"):
            job.finished_at = datetime.now(timezone.utc)
    session.flush()


def _upsert_parts(session: Session, design: Design) -> dict[str, str]:
    """부품 마스터를 갱신하고 (정규형 → part.id) 를 돌려준다."""
    seen: dict[str, tuple[str, str | None]] = {}
    for c in design.components:
        if c.part_number:
            seen.setdefault(normalize_mpn(c.part_number), (c.part_number, c.manufacturer))
    if not seen:
        return {}

    existing = {
        p.mpn_normalized
        for p in session.scalars(select(m.Part).where(m.Part.mpn_normalized.in_(list(seen)))).all()
    }
    for key, (display, maker) in seen.items():
        if key not in existing:
            session.add(m.Part(id=key, mpn_normalized=key, mpn_display=display, manufacturer=maker))
    session.flush()
    return {k: k for k in seen}


def _load(
    session: Session,
    design: Design,
    revision: m.Revision,
    store: BlobStore,
    geometry_root: Path | None,
) -> None:
    """리비전의 자식 행을 통째로 갈아끼운다. 리비전은 불변이라 부분 갱신이라는 개념이 없다."""
    rid = revision.id
    for model in (m.NetPin, m.Net, m.Component, m.StackupLayer, m.DrcFinding, m.LayerGeometry):
        session.execute(delete(model).where(model.revision_id == rid))
    session.flush()

    part_ids = _upsert_parts(session, design)

    if design.stackup:
        session.execute(
            insert(m.StackupLayer),
            [
                {
                    "revision_id": rid, "index": l.index, "name": l.name, "source_name": l.source_name,
                    "role": l.role.value, "thickness_nm": l.thickness_nm, "material": l.material,
                    "dk": l.dk, "df": l.df, "copper_weight_um": l.copper_weight_um,
                    "copper_area_ratio": l.copper_area_ratio,
                    "impedance_single_ohm": l.impedance_single_ohm,
                    "impedance_diff_ohm": l.impedance_diff_ohm,
                }
                for l in design.stackup
            ],
        )

    if design.components:
        session.execute(
            insert(m.Component),
            [
                {
                    "revision_id": rid, "refdes": c.refdes,
                    "part_id": part_ids.get(normalize_mpn(c.part_number)) if c.part_number else None,
                    "part_number": c.part_number, "manufacturer": c.manufacturer, "value": c.value,
                    "package": c.package, "x_nm": c.x_nm, "y_nm": c.y_nm,
                    "rotation_mdeg": c.rotation_mdeg, "side": c.side.value,
                    "pin_count": len(c.pins), "pin_pitch_nm": c.pin_pitch_nm,
                    "body_w_nm": c.body_w_nm, "body_h_nm": c.body_h_nm,
                }
                for c in design.components
            ],
        )

    if design.nets:
        session.execute(
            insert(m.Net),
            [
                {
                    "revision_id": rid, "name": n.name, "signature": n.signature or "",
                    "net_class": n.net_class, "diff_partner": n.diff_partner, "pin_count": len(n.pins),
                    "length_nm": n.length_nm,
                    "length_by_layer": [
                        {"layer_index": e.layer_index, "length_nm": e.length_nm}
                        for e in (n.length_by_layer or [])
                    ],
                    "via_count": n.via_count, "width_nm": n.width_nm, "unrouted": n.unrouted,
                }
                for n in design.nets
            ],
        )
        session.flush()
        net_ids = dict(
            session.execute(select(m.Net.name, m.Net.id).where(m.Net.revision_id == rid)).all()
        )
        rows = [
            {"revision_id": rid, "net_id": net_ids[n.name], "refdes": p.refdes, "pin_name": p.pin_name}
            for n in design.nets
            for p in n.pins
            if n.name in net_ids
        ]
        if rows:
            session.execute(insert(m.NetPin), rows)

    if design.drc_findings:
        session.execute(
            insert(m.DrcFinding),
            [
                {
                    "revision_id": rid, "rule": f.rule, "severity": f.severity.value,
                    "message": f.message, "x_nm": f.x_nm, "y_nm": f.y_nm,
                    "layer_index": f.layer_index, "net_name": f.net_name, "refdes": f.refdes,
                }
                for f in design.drc_findings
            ],
        )

    for g in design.layer_geometry or []:
        # 참조된 .blg 를 스토어로 들여온다. 이게 없으면 뷰어가 빈 화면을 띄운다.
        if geometry_root is not None:
            src = geometry_root / g.storage_key
            if src.exists():
                store.put(g.storage_key, src.read_bytes())
        session.add(
            m.LayerGeometry(
                revision_id=rid, layer_index=g.layer_index, storage_key=g.storage_key,
                object_count=g.object_count, byte_size=g.byte_size,
                bbox=g.bbox.model_dump(), kind_counts=g.kind_counts,
            )
        )
    session.flush()


def ingest_payload(
    session: Session,
    store: BlobStore,
    *,
    payload: bytes,
    filename: str,
    actor: str,
    project_key: str | None = None,
    adapter_name: str | None = None,
    geometry_root: Path | None = None,
) -> IngestResult:
    adapter = REGISTRY.by_name(adapter_name) if adapter_name else REGISTRY.for_file(filename, payload)

    # 원본은 내용 해시로 주소를 잡아 먼저 보관한다. 파싱이 실패해도 파일은 남아야
    # 파서를 고친 뒤 그대로 다시 돌릴 수 있다.
    digest = sha256(payload)
    key = design_key(digest)
    if not store.exists(key):
        store.put(key, payload)

    revision_id = ""
    try:
        design = adapter.parse(payload, source=filename)

        board_id = slug(design.header.board_key)
        revision_id = f"{board_id}-{slug(design.header.revision_label)}"
        project = project_key or design.header.project_key or "default"
        project_id = slug(project)

        if session.get(m.Project, project_id) is None:
            session.add(m.Project(id=project_id, key=project, name=project))
        board = session.get(m.Board, board_id)
        if board is None:
            board = m.Board(
                id=board_id, project_id=project_id, board_key=design.header.board_key,
                name=design.header.board_name, part_number=design.header.part_number,
                product_family=design.header.product_family, owner=design.header.author, tags=[],
            )
            session.add(board)
        revision = session.get(m.Revision, revision_id)
        if revision is None:
            revision = m.Revision(
                id=revision_id, board_id=board_id, label=f"Rev {design.header.revision_label}"
            )
            session.add(revision)
        session.flush()

        if session.scalar(select(m.IngestJob).where(m.IngestJob.revision_id == revision_id)) is None:
            session.add(
                m.IngestJob(
                    revision_id=revision_id, state="parsing",
                    parser_name=adapter.name, parser_version=adapter.version,
                )
            )
        session.flush()
        _set_state(session, revision_id, "normalizing")

        normalize(design)
        warnings = validate(design)
        design.warnings = warnings

        _set_state(session, revision_id, "indexing")
        summary = summarize(design)
        _load(session, design, revision, store, geometry_root)

        revision.author = design.header.author
        revision.designed_at = design.header.designed_at
        revision.source_tool = design.header.source_tool
        revision.source_version = design.header.source_version
        revision.cdm_version = design.cdm_version
        revision.parser_name = adapter.name
        revision.parser_version = adapter.version
        revision.summary = summary.model_dump(mode="json")
        revision.header = design.header.model_dump(mode="json", exclude={"outline"})
        revision.design_rules = design.design_rules.model_dump(mode="json")
        revision.outline = [p.model_dump(mode="json") for p in design.header.outline]
        revision.vias = [v.model_dump(mode="json") for v in design.vias]
        revision.drills = [d.model_dump(mode="json") for d in design.drills]
        revision.warnings = [w.model_dump(mode="json") for w in warnings]

        board.name = design.header.board_name
        board.part_number = design.header.part_number
        board.product_family = design.header.product_family

        already = session.scalar(
            select(m.DesignFile).where(
                m.DesignFile.revision_id == revision_id, m.DesignFile.sha256 == digest
            )
        )
        if already is None:
            session.add(
                m.DesignFile(
                    id=f"{revision_id}-{digest[:12]}", revision_id=revision_id, filename=filename,
                    sha256=digest, byte_size=len(payload), storage_key=key,
                    uploaded_by=actor, kind="design",
                )
            )

        _set_state(session, revision_id, "ready")
        session.add(
            m.AuditLog(
                actor=actor, action="ingest", target_type="revision", target_id=revision_id,
                detail={"filename": filename, "sha256": digest, "parser": adapter.name},
            )
        )
        return IngestResult(
            revision_id=revision_id, state="ready",
            warnings=[w.model_dump(mode="json") for w in warnings],
            parser_name=adapter.name, parser_version=adapter.version,
        )

    except (ParseError, IntegrityError) as e:
        # 실패해도 원본과 리비전 행은 남긴다. 무엇이 왜 막혔는지 화면에서 보여야
        # 파서를 고칠 수 있고, 고친 뒤 같은 파일로 바로 재시도할 수 있다.
        if revision_id:
            _set_state(session, revision_id, "failed", str(e))
        return IngestResult(
            revision_id=revision_id, state="failed", error=str(e),
            parser_name=adapter.name, parser_version=adapter.version,
        )
