"""DB 행 → API 모델.

화면이 소비하는 모양은 목데이터와 완전히 같다. cdm/schema 에서 생성된 같은 타입을
쓰기 때문이고, 그래서 프론트는 데이터 출처가 바뀐 것을 알지 못한다.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from boardlens.analytics import portfolio
from boardlens.cdm.api_v1 import (
    Board,
    BoardPage,
    CatalogFacets,
    ComponentRow,
    DesignFileRef,
    NetRow,
    Part,
    PartDetail,
    PartIndex,
    PartUsage,
    PortfolioStats,
    RangeFacet,
    Revision,
    RevisionDetail,
    RevisionRef,
    RevisionSummary,
)
from boardlens.cdm.cdm_v1 import (
    Design,
    DesignHeader,
    DesignRules,
    DrcFinding,
    DrillEntry,
    IngestWarning,
    LayerGeometryRef,
    Net,
    NetPinRef,
    Polygon,
    StackupLayer,
    ViaSpec,
)
from boardlens.cdm.cdm_v1 import Component as CdmComponent
from boardlens.db import models as m


def _summary(row: m.Revision) -> RevisionSummary:
    return RevisionSummary.model_validate(row.summary)


def _revision(row: m.Revision, board: m.Board) -> Revision:
    return Revision(
        id=row.id, board_id=row.board_id, board_key=board.board_key, board_name=board.name,
        label=row.label, parent_revision_id=row.parent_revision_id, status=row.status,
        ingest_state=row.ingest_state, ingest_error=row.ingest_error, author=row.author,
        designed_at=row.designed_at, created_at=row.created_at.isoformat(), note=row.note,
        source_tool=row.source_tool, source_version=row.source_version,
        parser_version=row.parser_version, summary=_summary(row),
    )


def _latest(session: Session) -> dict[str, m.Revision]:
    """보드마다 가장 최근 ready 리비전. 카탈로그가 보여주는 것이 이것이다."""
    out: dict[str, m.Revision] = {}
    rows = session.scalars(
        select(m.Revision).where(m.Revision.ingest_state == "ready").order_by(m.Revision.created_at)
    ).all()
    for r in rows:
        out[r.board_id] = r
    return out


def board_page(session: Session, *, projects: tuple[str, ...] = ()) -> BoardPage:
    boards = session.scalars(select(m.Board)).all()
    if projects:
        allowed = {p.id for p in session.scalars(select(m.Project).where(m.Project.key.in_(projects))).all()}
        boards = [b for b in boards if b.project_id in allowed]

    latest = _latest(session)
    counts = dict(
        session.execute(
            select(m.Revision.board_id, func.count()).group_by(m.Revision.board_id)
        ).all()
    )
    projects_by_id = {p.id: p for p in session.scalars(select(m.Project)).all()}

    items: list[Board] = []
    for b in boards:
        rev = latest.get(b.id)
        if rev is None:
            continue  # 아직 ready 인 리비전이 없는 보드는 카탈로그에 내지 않는다
        items.append(
            Board(
                id=b.id, project_key=projects_by_id[b.project_id].key if b.project_id in projects_by_id else "",
                board_key=b.board_key, name=b.name, part_number=b.part_number,
                product_family=b.product_family, owner=b.owner, status=rev.status,
                source_tool=rev.source_tool, tags=list(b.tags or []),
                revision_count=counts.get(b.id, 1),
                latest_revision_id=rev.id, latest_revision_label=rev.label,
                created_at=b.created_at.isoformat(), updated_at=rev.created_at.isoformat(),
                outline=[Polygon.model_validate(p) for p in (rev.outline or [])],
                summary=_summary(rev),
            )
        )
    items.sort(key=lambda x: x.updated_at, reverse=True)

    def tally(values) -> dict[str, int]:
        out: dict[str, int] = {}
        for v in values:
            if v:
                out[str(v)] = out.get(str(v), 0) + 1
        return dict(sorted(out.items(), key=lambda kv: (-kv[1], kv[0])))

    def span(values) -> RangeFacet:
        vals = list(values) or [0]
        return RangeFacet(min=min(vals), max=max(vals))

    return BoardPage(
        items=items, total=len(items), offset=0, limit=len(items),
        facets=CatalogFacets(
            product_family=tally(b.product_family for b in items),
            status=tally(b.status.value for b in items),
            owner=tally(b.owner for b in items),
            source_tool=tally(b.source_tool for b in items),
            tags=tally(t for b in items for t in b.tags),
            layer_count=span(b.summary.layer_count for b in items),
            area_mm2=span(b.summary.area_mm2 for b in items),
            component_count=span(b.summary.component_count for b in items),
            min_trace_width_nm=span(b.summary.min_trace_width_nm for b in items),
        ),
    )


def revision_detail(session: Session, revision_id: str) -> RevisionDetail | None:
    row = session.get(m.Revision, revision_id)
    if row is None:
        return None
    board = session.get(m.Board, row.board_id)
    assert board is not None

    lineage = [
        RevisionRef(
            id=r.id, label=r.label, status=r.status, created_at=r.created_at.isoformat(),
            parent_revision_id=r.parent_revision_id, author=r.author, note=r.note,
        )
        for r in session.scalars(
            select(m.Revision).where(m.Revision.board_id == row.board_id).order_by(m.Revision.created_at)
        ).all()
    ]

    components = [
        ComponentRow(
            refdes=c.refdes, part_number=c.part_number, manufacturer=c.manufacturer, value=c.value,
            package=c.package, x_nm=c.x_nm, y_nm=c.y_nm, rotation_mdeg=c.rotation_mdeg,
            side=c.side, pin_count=c.pin_count, pin_pitch_nm=c.pin_pitch_nm,
            body_w_nm=c.body_w_nm, body_h_nm=c.body_h_nm,
        )
        for c in session.scalars(
            select(m.Component).where(m.Component.revision_id == revision_id).order_by(m.Component.refdes)
        ).all()
    ]

    nets = [
        NetRow(
            name=n.name, net_class=n.net_class, diff_partner=n.diff_partner, pin_count=n.pin_count,
            length_nm=n.length_nm, via_count=n.via_count, width_nm=n.width_nm, unrouted=n.unrouted,
            layer_span=sorted({e["layer_index"] for e in (n.length_by_layer or [])}),
        )
        for n in session.scalars(select(m.Net).where(m.Net.revision_id == revision_id)).all()
    ]

    stackup = [
        StackupLayer(
            index=l.index, name=l.name, source_name=l.source_name, role=l.role,
            thickness_nm=l.thickness_nm, material=l.material, dk=l.dk, df=l.df,
            copper_weight_um=l.copper_weight_um, copper_area_ratio=l.copper_area_ratio,
            impedance_single_ohm=l.impedance_single_ohm, impedance_diff_ohm=l.impedance_diff_ohm,
        )
        for l in session.scalars(
            select(m.StackupLayer).where(m.StackupLayer.revision_id == revision_id).order_by(m.StackupLayer.index)
        ).all()
    ]

    geometry = [
        LayerGeometryRef(
            layer_index=g.layer_index, storage_key=g.storage_key, object_count=g.object_count,
            byte_size=g.byte_size, bbox=g.bbox, kind_counts=g.kind_counts,
        )
        for g in session.scalars(
            select(m.LayerGeometry).where(m.LayerGeometry.revision_id == revision_id).order_by(m.LayerGeometry.layer_index)
        ).all()
    ]

    findings = [
        DrcFinding(
            rule=f.rule, severity=f.severity, message=f.message, x_nm=f.x_nm, y_nm=f.y_nm,
            layer_index=f.layer_index, net_name=f.net_name, refdes=f.refdes,
        )
        for f in session.scalars(select(m.DrcFinding).where(m.DrcFinding.revision_id == revision_id)).all()
    ]

    files = [
        DesignFileRef(
            id=f.id, filename=f.filename, sha256=f.sha256, byte_size=f.byte_size,
            uploaded_at=f.uploaded_at.isoformat(), uploaded_by=f.uploaded_by,
            storage_key=f.storage_key, kind=f.kind,
        )
        for f in session.scalars(select(m.DesignFile).where(m.DesignFile.revision_id == revision_id)).all()
    ]

    header = row.header or {}
    return RevisionDetail(
        revision=_revision(row, board),
        part_number=header.get("part_number"),
        project_key=header.get("project_key"),
        product_family=header.get("product_family"),
        surface_finish=header.get("surface_finish"),
        special_processes=header.get("special_processes") or [],
        outline=[Polygon.model_validate(p) for p in (row.outline or [])],
        stackup=stackup,
        design_rules=DesignRules.model_validate(row.design_rules),
        vias=[ViaSpec.model_validate(v) for v in (row.vias or [])],
        drills=[DrillEntry.model_validate(d) for d in (row.drills or [])],
        drc_findings=findings,
        warnings=[IngestWarning.model_validate(w) for w in (row.warnings or [])],
        layer_geometry=geometry,
        components=components,
        nets=nets,
        files=files,
        lineage=lineage,
    )


def reconstruct_design(session: Session, revision_id: str) -> Design | None:
    """비교 엔진에 넘길 Design 을 DB 행에서 되짚는다.

    핀 좌표는 복원하지 않는다 — Diff 는 부품의 위치·회전·면·파트넘버와 넷의 핀 집합만
    보고, 핀 좌표는 쓰지 않는다. 넣지 않아도 되는 것을 넣지 않는 편이 빠르고 정직하다.
    """
    row = session.get(m.Revision, revision_id)
    if row is None:
        return None

    net_pins: dict[int, list[NetPinRef]] = defaultdict(list)
    for net_id, refdes, pin_name in session.execute(
        select(m.NetPin.net_id, m.NetPin.refdes, m.NetPin.pin_name).where(m.NetPin.revision_id == revision_id)
    ).all():
        net_pins[net_id].append(NetPinRef(refdes=refdes, pin_name=pin_name))

    nets = [
        Net(
            name=n.name, signature=n.signature, net_class=n.net_class, diff_partner=n.diff_partner,
            pins=net_pins.get(n.id, []), length_nm=n.length_nm, via_count=n.via_count,
            width_nm=n.width_nm, unrouted=n.unrouted,
        )
        for n in session.scalars(select(m.Net).where(m.Net.revision_id == revision_id)).all()
    ]

    components = [
        CdmComponent(
            refdes=c.refdes, part_number=c.part_number, manufacturer=c.manufacturer, value=c.value,
            package=c.package, x_nm=c.x_nm, y_nm=c.y_nm, rotation_mdeg=c.rotation_mdeg,
            side=c.side, pin_pitch_nm=c.pin_pitch_nm,
            body_w_nm=c.body_w_nm, body_h_nm=c.body_h_nm, pins=[],
        )
        for c in session.scalars(select(m.Component).where(m.Component.revision_id == revision_id)).all()
    ]

    stackup = [
        StackupLayer(
            index=l.index, name=l.name, source_name=l.source_name, role=l.role,
            thickness_nm=l.thickness_nm, material=l.material, dk=l.dk, df=l.df,
            copper_weight_um=l.copper_weight_um, copper_area_ratio=l.copper_area_ratio,
        )
        for l in session.scalars(
            select(m.StackupLayer).where(m.StackupLayer.revision_id == revision_id).order_by(m.StackupLayer.index)
        ).all()
    ]

    header = dict(row.header or {})
    header["outline"] = row.outline or []
    return Design(
        cdm_version=row.cdm_version or "1.0.0",
        parser_name=row.parser_name,
        parser_version=row.parser_version,
        header=DesignHeader.model_validate(header),
        stackup=stackup,
        components=components,
        nets=nets,
        vias=[ViaSpec.model_validate(v) for v in (row.vias or [])],
        drills=[DrillEntry.model_validate(d) for d in (row.drills or [])],
        design_rules=DesignRules.model_validate(row.design_rules),
    )


# ── 분석 ──────────────────────────────────────


def part_index(session: Session) -> PartIndex:
    usage = dict(
        session.execute(
            select(m.Component.part_id, func.count(func.distinct(m.Revision.board_id)))
            .join(m.Revision, m.Revision.id == m.Component.revision_id)
            .where(m.Component.part_id.isnot(None))
            .group_by(m.Component.part_id)
        ).all()
    )
    quantity = dict(
        session.execute(
            select(m.Component.part_id, func.count())
            .where(m.Component.part_id.isnot(None))
            .group_by(m.Component.part_id)
        ).all()
    )
    parts = [
        Part(
            id=p.id, manufacturer=p.manufacturer, mpn_normalized=p.mpn_normalized,
            mpn_display=p.mpn_display, description=p.description, lifecycle=p.lifecycle,
            board_count=usage.get(p.id, 0), total_quantity=quantity.get(p.id, 0),
        )
        for p in session.scalars(select(m.Part)).all()
    ]
    parts.sort(key=lambda p: (-p.board_count, -p.total_quantity, p.mpn_normalized))
    return PartIndex(generated_at=datetime.now().isoformat(timespec="seconds"), parts=parts)


def part_detail(session: Session, part_id: str) -> PartDetail | None:
    part = session.get(m.Part, part_id)
    if part is None:
        return None

    rows = session.execute(
        select(m.Component.revision_id, m.Component.refdes, m.Revision, m.Board)
        .join(m.Revision, m.Revision.id == m.Component.revision_id)
        .join(m.Board, m.Board.id == m.Revision.board_id)
        .where(m.Component.part_id == part_id)
    ).all()

    grouped: dict[str, list] = defaultdict(list)
    meta: dict[str, tuple[m.Revision, m.Board]] = {}
    for revision_id, refdes, rev, board in rows:
        grouped[revision_id].append(refdes)
        meta[revision_id] = (rev, board)

    usages = [
        PartUsage(
            board_key=meta[rid][1].board_key, board_name=meta[rid][1].name,
            revision_label=meta[rid][0].label, revision_id=rid, status=meta[rid][0].status,
            quantity=len(refdes_list), refdes_list=sorted(refdes_list, key=lambda r: (len(r), r)),
        )
        for rid, refdes_list in grouped.items()
    ]
    usages.sort(key=lambda u: (u.board_key, u.revision_label))

    return PartDetail(
        part=Part(
            id=part.id, manufacturer=part.manufacturer, mpn_normalized=part.mpn_normalized,
            mpn_display=part.mpn_display, description=part.description, lifecycle=part.lifecycle,
            board_count=len({u.board_key for u in usages}),
            total_quantity=sum(u.quantity for u in usages),
        ),
        usages=usages,
    )


def insights(session: Session) -> PortfolioStats:
    revisions = [
        _revision(r, session.get(m.Board, r.board_id))  # type: ignore[arg-type]
        for r in session.scalars(select(m.Revision).where(m.Revision.ingest_state == "ready")).all()
    ]
    index = part_index(session)
    reused = sum(1 for p in index.parts if p.board_count > 1)
    boards = session.scalars(select(m.Board)).all()
    return portfolio.build(
        revisions,
        first_seen_year={b.board_key: b.created_at.year for b in boards},
        part_count=len(index.parts),
        reused_part_count=reused,
        reuse_ratio=round(reused / len(index.parts), 4) if index.parts else 0.0,
        top_parts=index.parts[:12],
    )
