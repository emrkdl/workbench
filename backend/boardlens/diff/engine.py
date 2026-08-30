"""리비전 비교 엔진.

어려운 부분은 무엇이 달라졌는지 세는 것이 아니라 **무엇을 같은 것으로 볼 것인가**다.

- 부품은 RefDes 가 안정적인 키다. 다만 CAD 가 다시 저장되기만 해도 좌표 하위 자릿수는
  흔들리므로, 임계값 미만의 이동은 변경으로 세지 않는다.
- 넷은 이름이 키가 되지 못한다. VDD_1V8 이 VDD_CORE 로 바뀌면 이름만 보고는 "넷 하나
  삭제 + 하나 추가"가 되고, 그건 설계자에게 노이즈다. 연결된 핀 집합의 해시로 매칭해야
  '이름만 바뀐 넷'과 '회로가 바뀐 넷'이 갈린다.

결과인 ChangeSet 은 (rev_a, rev_b, parser_version) 으로 캐시할 수 있는 순수 함수의 출력이다.
"""

from __future__ import annotations

from datetime import datetime
from math import hypot

from boardlens.cdm.api_v1 import (
    ChangeKind,
    ChangeSet,
    ChangeStats,
    ComponentChange,
    ComponentSnapshot,
    FieldChange,
    NetChange,
    StackupChange,
)
from boardlens.cdm.cdm_v1 import Component, Design, Net
from boardlens.ingest.summarize import net_signature
from boardlens.units import DEFAULT_MOVE_THRESHOLD_NM, format_length, to_mm

#: 이름도 시그니처도 안 맞는 넷을 마지막으로 짝지을 때 요구하는 핀 집합 겹침 비율.
#: 이름이 바뀌면서 핀도 한둘 달라진 넷을 삭제+추가로 흘려보내지 않기 위한 장치다.
NET_OVERLAP_THRESHOLD = 0.7

#: 항목 목록의 기본 상한. 다른 보드끼리 비교하면 변경이 수천 건이 되는데, 그것을 한 줄씩
#: 읽는 사람은 없고 응답만 1 MB 를 넘는다. 통계는 전부 세고 목록만 자른다.
DEFAULT_LIST_LIMIT = 500

#: 목록을 자를 때 남길 우선순위. 추가·삭제·치환은 몇 건이든 눈으로 봐야 하고,
#: 단순 이동은 지도에서 보는 편이 빠르다.
_COMPONENT_RANK = {
    ChangeKind.REMOVED: 0, ChangeKind.ADDED: 1, ChangeKind.REPLACED: 2,
    ChangeKind.FLIPPED: 3, ChangeKind.ROTATED: 4, ChangeKind.MOVED: 5,
}
_NET_RANK = {
    ChangeKind.REMOVED: 0, ChangeKind.ADDED: 1, ChangeKind.REWIRED: 2, ChangeKind.RENAMED: 3,
}


def _trim_components(changes: list[ComponentChange], limit: int | None) -> list[ComponentChange]:
    if limit is None or len(changes) <= limit:
        return changes
    # 같은 종류 안에서는 많이 움직인 것부터
    return sorted(
        changes,
        key=lambda c: (_COMPONENT_RANK.get(c.kind, 9), -(c.distance_nm or 0)),
    )[:limit]


def _trim_nets(changes: list[NetChange], limit: int | None) -> list[NetChange]:
    if limit is None or len(changes) <= limit:
        return changes
    # 같은 종류 안에서는 핀이 많이 달라진 것부터
    return sorted(
        changes,
        key=lambda n: (
            _NET_RANK.get(n.kind, 9),
            -(len(n.pins_added or []) + len(n.pins_removed or [])),
        ),
    )[:limit]


def _snapshot(c: Component) -> ComponentSnapshot:
    return ComponentSnapshot(
        x_nm=c.x_nm,
        y_nm=c.y_nm,
        rotation_mdeg=c.rotation_mdeg,
        side=c.side.value,
        package=c.package,
        part_number=c.part_number,
        body_w_nm=c.body_w_nm,
        body_h_nm=c.body_h_nm,
    )


def _angle_delta(a: int, b: int) -> int:
    """0~360000 범위에서 최단 회전량. 350° -> 10° 는 20° 지 340° 가 아니다."""
    d = (b - a) % 360_000
    return d - 360_000 if d > 180_000 else d


def diff_components(
    a: Design, b: Design, move_threshold_nm: int
) -> tuple[list[ComponentChange], dict[str, int]]:
    by_a = {c.refdes: c for c in a.components}
    by_b = {c.refdes: c for c in b.components}
    changes: list[ComponentChange] = []
    counts = {"added": 0, "removed": 0, "moved": 0, "replaced": 0}

    for refdes in sorted(by_a.keys() - by_b.keys()):
        changes.append(ComponentChange(refdes=refdes, kind=ChangeKind.REMOVED, before=_snapshot(by_a[refdes])))
        counts["removed"] += 1

    for refdes in sorted(by_b.keys() - by_a.keys()):
        changes.append(ComponentChange(refdes=refdes, kind=ChangeKind.ADDED, after=_snapshot(by_b[refdes])))
        counts["added"] += 1

    for refdes in sorted(by_a.keys() & by_b.keys()):
        ca, cb = by_a[refdes], by_b[refdes]
        distance = round(hypot(cb.x_nm - ca.x_nm, cb.y_nm - ca.y_nm))
        rotation = _angle_delta(ca.rotation_mdeg, cb.rotation_mdeg)
        moved = distance >= move_threshold_nm
        rotated = rotation != 0
        flipped = ca.side != cb.side
        replaced = ca.part_number != cb.part_number or ca.package != cb.package

        if not (moved or rotated or flipped or replaced):
            continue

        # 한 부품에 여러 변경이 겹칠 수 있다. kind 는 가장 무거운 것 하나를 고르고,
        # 이동량과 회전량은 따로 실어 화면이 "3.5 mm 이동 · 90° 회전"을 함께 보여줄 수 있게 한다.
        if replaced:
            kind = ChangeKind.REPLACED
            counts["replaced"] += 1
        elif flipped:
            kind = ChangeKind.FLIPPED
        elif moved:
            kind = ChangeKind.MOVED
            counts["moved"] += 1
        else:
            kind = ChangeKind.ROTATED

        changes.append(
            ComponentChange(
                refdes=refdes,
                kind=kind,
                before=_snapshot(ca),
                after=_snapshot(cb),
                distance_nm=distance if moved else None,
                rotation_delta_mdeg=rotation if rotated else None,
            )
        )

    return changes, counts


def _pin_keys(net: Net) -> set[str]:
    return {f"{p.refdes}.{p.pin_name}" for p in net.pins}


def _signature(net: Net) -> str:
    return net.signature or net_signature(net.pins)


def _rewire(name_a: str | None, name_b: str | None, pins_a: set[str], pins_b: set[str], length_delta: int | None) -> NetChange:
    return NetChange(
        kind=ChangeKind.REWIRED,
        name_a=name_a,
        name_b=name_b,
        pins_added=sorted(pins_b - pins_a),
        pins_removed=sorted(pins_a - pins_b),
        length_delta_nm=length_delta,
    )


def diff_nets(a: Design, b: Design) -> tuple[list[NetChange], dict[str, int]]:
    """넷 매칭 3단계: 이름 → 핀 집합 해시 → 핀 집합 겹침."""
    changes: list[NetChange] = []
    counts = {"added": 0, "removed": 0, "renamed": 0, "rewired": 0, "pins_added": 0, "pins_removed": 0}

    left = {n.name: n for n in a.nets}
    right = {n.name: n for n in b.nets}

    # 1단계 — 이름이 같은 넷. 시그니처까지 같으면 변경 없음이므로 결과에 넣지 않는다.
    for name in sorted(left.keys() & right.keys()):
        na, nb = left.pop(name), right.pop(name)
        if _signature(na) == _signature(nb):
            continue
        pa, pb = _pin_keys(na), _pin_keys(nb)
        changes.append(_rewire(name, name, pa, pb, nb.length_nm - na.length_nm))
        counts["rewired"] += 1

    # 2단계 — 핀 집합이 정확히 같은 넷. 이름만 바뀐 경우다.
    by_sig_b: dict[str, list[Net]] = {}
    for n in right.values():
        by_sig_b.setdefault(_signature(n), []).append(n)

    for name in sorted(left.keys()):
        na = left[name]
        bucket = by_sig_b.get(_signature(na))
        if not bucket:
            continue
        nb = bucket.pop(0)
        left.pop(name)
        right.pop(nb.name)
        changes.append(
            NetChange(
                kind=ChangeKind.RENAMED,
                name_a=na.name,
                name_b=nb.name,
                length_delta_nm=nb.length_nm - na.length_nm,
            )
        )
        counts["renamed"] += 1

    # 3단계 — 이름도 시그니처도 안 맞지만 핀이 대부분 겹치는 넷. 이름과 연결이 함께
    # 바뀐 경우이며, 삭제+추가로 두면 실제로 무엇이 달라졌는지 읽을 수 없다.
    remaining_b = list(right.values())
    for name in sorted(left.keys()):
        na = left[name]
        pa = _pin_keys(na)
        if not pa:
            continue
        best, best_score = None, 0.0
        for nb in remaining_b:
            pb = _pin_keys(nb)
            union = pa | pb
            if not union:
                continue
            score = len(pa & pb) / len(union)
            if score > best_score:
                best, best_score = nb, score
        if best is None or best_score < NET_OVERLAP_THRESHOLD:
            continue
        pb = _pin_keys(best)
        left.pop(name)
        right.pop(best.name)
        remaining_b.remove(best)
        changes.append(_rewire(na.name, best.name, pa, pb, best.length_nm - na.length_nm))
        counts["rewired"] += 1

    for name in sorted(left.keys()):
        changes.append(NetChange(kind=ChangeKind.REMOVED, name_a=name, pins_removed=sorted(_pin_keys(left[name]))))
        counts["removed"] += 1
    for name in sorted(right.keys()):
        changes.append(NetChange(kind=ChangeKind.ADDED, name_b=name, pins_added=sorted(_pin_keys(right[name]))))
        counts["added"] += 1

    for ch in changes:
        counts["pins_added"] += len(ch.pins_added or [])
        counts["pins_removed"] += len(ch.pins_removed or [])

    return changes, counts


_LAYER_FIELDS: list[tuple[str, str, object]] = [
    ("role", "역할", lambda l: l.role.value),
    ("thickness_nm", "두께", lambda l: format_length(l.thickness_nm, "um")),
    ("material", "재질", lambda l: l.material or "—"),
    ("dk", "Dk", lambda l: f"{l.dk:.2f}" if l.dk else "—"),
    ("df", "Df", lambda l: f"{l.df:.4f}" if l.df else "—"),
    ("copper_weight_um", "동박", lambda l: f"{l.copper_weight_um} µm" if l.copper_weight_um else "—"),
]


def diff_stackup(a: Design, b: Design) -> list[StackupChange]:
    """원본 층명으로 맞춘다. 층이 삽입되면 인덱스가 통째로 밀려서 인덱스 매칭은 못 쓴다."""
    by_a = {l.source_name: l for l in a.stackup}
    by_b = {l.source_name: l for l in b.stackup}
    changes: list[StackupChange] = []

    for name, la in by_a.items():
        if name not in by_b:
            changes.append(StackupChange(index=la.index, kind=ChangeKind.REMOVED, layer_name=la.name))

    for name, lb in by_b.items():
        if name not in by_a:
            changes.append(StackupChange(index=lb.index, kind=ChangeKind.INSERTED, layer_name=lb.name))
            continue
        la = by_a[name]
        fields = [
            FieldChange(path=f"stackup.{name}.{key}", label=label, before=fmt(la), after=fmt(lb))
            for key, label, fmt in _LAYER_FIELDS
            if fmt(la) != fmt(lb)
        ]
        if fields:
            changes.append(
                StackupChange(index=lb.index, kind=ChangeKind.SPEC_CHANGED, layer_name=lb.name, fields=fields)
            )

    return sorted(changes, key=lambda c: c.index)


def _fields(pairs: list[tuple[str, str, str, str]]) -> list[FieldChange]:
    return [
        FieldChange(path=path, label=label, before=before, after=after)
        for path, label, before, after in pairs
        if before != after
    ]


def diff_header(a: Design, b: Design) -> list[FieldChange]:
    ha, hb = a.header, b.header

    def outline_size(design: Design) -> str:
        xs = [p for poly in design.header.outline if not poly.is_cutout for p in poly.points_nm[0::2]]
        ys = [p for poly in design.header.outline if not poly.is_cutout for p in poly.points_nm[1::2]]
        if not xs:
            return "—"
        return f"{to_mm(max(xs) - min(xs)):.1f} × {to_mm(max(ys) - min(ys)):.1f} mm"

    return _fields([
        ("header.board_key", "보드 코드", ha.board_key, hb.board_key),
        ("header.part_number", "파트넘버", ha.part_number or "—", hb.part_number or "—"),
        ("header.source", "CAD 툴", f"{ha.source_tool} {ha.source_version}", f"{hb.source_tool} {hb.source_version}"),
        ("header.author", "설계자", ha.author or "—", hb.author or "—"),
        ("header.outline", "외형 치수", outline_size(a), outline_size(b)),
        ("header.board_thickness_nm", "보드 두께", format_length(ha.board_thickness_nm), format_length(hb.board_thickness_nm)),
        ("header.surface_finish", "표면 처리", ha.surface_finish or "—", hb.surface_finish or "—"),
        ("header.special_processes", "특수 공정", ", ".join(ha.special_processes or []) or "—", ", ".join(hb.special_processes or []) or "—"),
        ("stackup.layer_count", "도체층 수", str(_conductors(a)), str(_conductors(b))),
    ])


def _conductors(d: Design) -> int:
    return sum(1 for l in d.stackup if l.role.value in ("signal", "plane_power", "plane_gnd", "mixed"))


def diff_rules(a: Design, b: Design) -> list[FieldChange]:
    ra, rb = a.design_rules, b.design_rules
    um = lambda v: format_length(v, "um") if v else "—"  # noqa: E731
    return _fields([
        ("rules.min_trace_width_nm", "최소 선폭", um(ra.min_trace_width_nm), um(rb.min_trace_width_nm)),
        ("rules.min_clearance_nm", "최소 간격", um(ra.min_clearance_nm), um(rb.min_clearance_nm)),
        ("rules.min_drill_nm", "최소 드릴", um(ra.min_drill_nm), um(rb.min_drill_nm)),
        ("rules.min_annular_ring_nm", "최소 애뉼러 링", um(ra.min_annular_ring_nm), um(rb.min_annular_ring_nm)),
        ("rules.max_aspect_ratio", "최대 종횡비", f"{ra.max_aspect_ratio}" if ra.max_aspect_ratio else "—", f"{rb.max_aspect_ratio}" if rb.max_aspect_ratio else "—"),
        ("rules.min_bga_pitch_nm", "BGA 최소 피치", um(ra.min_bga_pitch_nm), um(rb.min_bga_pitch_nm)),
    ])


def diff(
    a: Design,
    b: Design,
    revision_a_id: str,
    revision_b_id: str,
    move_threshold_nm: int = DEFAULT_MOVE_THRESHOLD_NM,
    list_limit: int | None = DEFAULT_LIST_LIMIT,
) -> ChangeSet:
    component_changes, ccounts = diff_components(a, b, move_threshold_nm)
    net_changes, ncounts = diff_nets(a, b)
    stackup_changes = diff_stackup(a, b)

    return ChangeSet(
        revision_a_id=revision_a_id,
        revision_b_id=revision_b_id,
        generated_at=datetime.now().isoformat(timespec="seconds"),
        parser_version=b.parser_version,
        move_threshold_nm=move_threshold_nm,
        list_limit=list_limit if (len(component_changes) > (list_limit or 1 << 30)
                                  or len(net_changes) > (list_limit or 1 << 30)) else None,
        stats=ChangeStats(
            components_added=ccounts["added"],
            components_removed=ccounts["removed"],
            components_moved=ccounts["moved"],
            components_replaced=ccounts["replaced"],
            nets_added=ncounts["added"],
            nets_removed=ncounts["removed"],
            nets_renamed=ncounts["renamed"],
            nets_rewired=ncounts["rewired"],
            pins_added=ncounts["pins_added"],
            pins_removed=ncounts["pins_removed"],
            layers_changed=len(stackup_changes),
            # 배선 기하 비교는 .blg 버퍼가 생기는 Phase 2 이후다. 지금 채우면 없는 분석을
            # 있는 것처럼 보여주는 셈이라 비워 둔다.
            geometry_regions=0,
        ),
        header_changes=diff_header(a, b),
        rule_changes=diff_rules(a, b),
        component_changes=_trim_components(component_changes, list_limit),
        net_changes=_trim_nets(net_changes, list_limit),
        stackup_changes=stackup_changes,
        geometry_regions=[],
    )
