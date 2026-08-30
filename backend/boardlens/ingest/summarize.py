"""CDM Design -> RevisionSummary 집계.

인제스트의 마지막 단계다. 카탈로그 파셋과 Overview 화면은 전부 이 결과만 읽고 원본
테이블을 건드리지 않는다 — 사용자가 필터 슬라이더를 움직일 때마다 2,000만 행을
집계할 수는 없기 때문이다.

목데이터도 실제 HKP도 같은 CDM Design 을 내놓으므로 이 모듈은 양쪽에 그대로 쓰인다.
Phase 5에서 파서가 붙어도 여기는 바뀌지 않는다.
"""

from __future__ import annotations

import hashlib
import re

from boardlens.cdm.api_v1 import ComponentRow, NetRow, OutlineKind, RevisionSummary
from boardlens.cdm.cdm_v1 import Design, LayerRole, Net, NetPinRef, Polygon
from boardlens.units import NM_PER_MM, NM_PER_UM

CONDUCTOR_ROLES = {LayerRole.SIGNAL, LayerRole.PLANE_POWER, LayerRole.PLANE_GND, LayerRole.MIXED}
PLANE_ROLES = {LayerRole.PLANE_POWER, LayerRole.PLANE_GND}

#: 넷 이름만으로 전원 넷을 추정할 때 쓰는 패턴. net_class 가 있으면 그쪽이 우선한다.
_POWER_NAME = re.compile(r"^(v(dd|cc|ss|ee|bat|in|out|ref)|gnd|agnd|dgnd|pgnd|\+?\d+v\d*)", re.I)

_BGA_PACKAGE = re.compile(r"\b(bga|csp|wlp)\b|^(bga|lfbga|tfbga|vfbga|fcbga|wlcsp)", re.I)


def net_signature(pins: list[NetPinRef]) -> str:
    """넷에 연결된 핀 집합의 해시.

    Diff 에서 넷을 이름이 아니라 이것으로 매칭한다. VDD_1V8 이 VDD_CORE 로 이름만
    바뀐 경우와, 이름은 그대로인데 핀이 하나 늘어난 경우를 구분하는 유일한 수단이다.
    이름 기반으로만 비교하면 전자가 "넷 1개 삭제 + 1개 추가"로 잡혀서 설계자에게
    쓸모없는 노이즈가 된다.
    """
    keys = sorted(f"{p.refdes}.{p.pin_name}" for p in pins)
    return hashlib.sha1("\n".join(keys).encode()).hexdigest()[:16]


def is_power_net(net: Net) -> bool:
    if net.net_class and net.net_class.lower() in {"power", "ground", "gnd"}:
        return True
    return bool(_POWER_NAME.match(net.name))


def is_bga(package: str) -> bool:
    return bool(_BGA_PACKAGE.search(package))


def _polygon_area_nm2(poly: Polygon) -> float:
    """신발끈 공식. 좌표가 정수 nm 이라 곱이 커지므로 float 로 받는다."""
    pts = poly.points_nm
    n = len(pts) // 2
    if n < 3:
        return 0.0
    total = 0.0
    for i in range(n):
        x1, y1 = pts[2 * i], pts[2 * i + 1]
        j = (i + 1) % n
        x2, y2 = pts[2 * j], pts[2 * j + 1]
        total += x1 * y2 - x2 * y1
    return abs(total) / 2.0


def _outline_bbox(outline: list[Polygon]) -> tuple[int, int, int, int]:
    xs: list[int] = []
    ys: list[int] = []
    for poly in outline:
        if poly.is_cutout:
            continue
        pts = poly.points_nm
        xs.extend(pts[0::2])
        ys.extend(pts[1::2])
    if not xs:
        return 0, 0, 0, 0
    return min(xs), min(ys), max(xs), max(ys)


def _is_rectangular(outline: list[Polygon]) -> bool:
    solids = [p for p in outline if not p.is_cutout]
    if len(solids) != 1 or len(solids[0].points_nm) != 8:
        return False
    xs = set(solids[0].points_nm[0::2])
    ys = set(solids[0].points_nm[1::2])
    return len(xs) == 2 and len(ys) == 2  # 축 정렬 직사각형


def complexity_score(
    layer_count: int,
    density_per_cm2: float,
    pin_count: int,
    min_trace_width_nm: int,
    has_advanced_via: bool,
) -> float:
    """0~100 단일 지표. 보드 간 난이도를 대략 비교하기 위한 것이다.

    절대적 의미는 없고 순위를 매기는 용도다. 가중치는 설계팀 감각에 맞춰 조정할 값이라
    상수로 빼 두었다. 각 항은 0~1 로 정규화한 뒤 합산하고 100을 곱한다.
    """
    layers = min(layer_count / 16.0, 1.0)
    density = min(density_per_cm2 / 60.0, 1.0)
    pins = min(pin_count / 20_000.0, 1.0)
    # 선폭은 작을수록 어렵다. 100µm 를 1.0 의 기준으로 삼는다.
    fineness = min((100 * NM_PER_UM) / max(min_trace_width_nm, 1) / 2.0, 1.0)
    via = 1.0 if has_advanced_via else 0.0

    score = 100.0 * (0.22 * layers + 0.26 * density + 0.20 * pins + 0.22 * fineness + 0.10 * via)
    return round(min(score, 100.0), 1)


def summarize(design: Design) -> RevisionSummary:
    """CDM Design 하나에서 리비전 요약을 계산한다."""
    conductors = [l for l in design.stackup if l.role in CONDUCTOR_ROLES]
    planes = [l for l in conductors if l.role in PLANE_ROLES]

    x0, y0, x1, y1 = _outline_bbox(design.header.outline)
    solid_area = sum(_polygon_area_nm2(p) for p in design.header.outline if not p.is_cutout)
    cutouts = [p for p in design.header.outline if p.is_cutout]
    cutout_area = sum(_polygon_area_nm2(p) for p in cutouts)
    area_mm2 = max((solid_area - cutout_area) / (NM_PER_MM * NM_PER_MM), 0.0)

    top = sum(1 for c in design.components if c.side == "top")
    pin_count = sum(len(c.pins) for c in design.components)

    package_counts: dict[str, int] = {}
    for c in design.components:
        package_counts[c.package] = package_counts.get(c.package, 0) + 1

    bgas = [c for c in design.components if is_bga(c.package)]
    bga_pitches = [c.pin_pitch_nm for c in bgas if c.pin_pitch_nm]

    via_by_kind: dict[str, int] = {}
    for v in design.vias:
        via_by_kind[v.kind.value] = via_by_kind.get(v.kind.value, 0) + v.count
    has_advanced_via = any(k in via_by_kind for k in ("blind", "buried", "micro"))

    density = len(design.components) / (area_mm2 / 100.0) if area_mm2 > 0 else 0.0

    findings = design.drc_findings or []
    rules = design.design_rules

    return RevisionSummary(
        layer_count=len(conductors),
        signal_layer_count=sum(1 for l in conductors if l.role == LayerRole.SIGNAL),
        plane_layer_count=len(planes),
        width_nm=x1 - x0,
        height_nm=y1 - y0,
        area_mm2=round(area_mm2, 2),
        outline_kind=OutlineKind.RECTANGULAR if _is_rectangular(design.header.outline) else OutlineKind.SHAPED,
        cutout_count=len(cutouts),
        board_thickness_nm=design.header.board_thickness_nm,
        component_count=len(design.components),
        component_top_count=top,
        component_bottom_count=len(design.components) - top,
        pin_count=pin_count,
        bga_count=len(bgas),
        min_bga_pitch_nm=min(bga_pitches) if bga_pitches else None,
        package_counts=package_counts,
        density_per_cm2=round(density, 2),
        net_count=len(design.nets),
        total_route_length_nm=sum(n.length_nm for n in design.nets),
        diff_pair_count=sum(1 for n in design.nets if n.diff_partner) // 2,
        unrouted_count=sum(1 for n in design.nets if n.unrouted),
        power_net_count=sum(1 for n in design.nets if is_power_net(n)),
        via_total=sum(v.count for v in design.vias),
        via_by_kind=via_by_kind,
        hole_count=sum(d.count for d in design.drills),
        min_trace_width_nm=rules.min_trace_width_nm,
        min_clearance_nm=rules.min_clearance_nm,
        min_drill_nm=rules.min_drill_nm,
        max_aspect_ratio=rules.max_aspect_ratio,
        drc_error_count=sum(1 for f in findings if f.severity == "error"),
        drc_warning_count=sum(1 for f in findings if f.severity == "warning"),
        warning_count=sum(w.count for w in (design.warnings or [])),
        complexity_score=complexity_score(
            layer_count=len(conductors),
            density_per_cm2=density,
            pin_count=pin_count,
            min_trace_width_nm=rules.min_trace_width_nm,
            has_advanced_via=has_advanced_via,
        ),
    )


def to_component_rows(design: Design) -> list[ComponentRow]:
    """부품 테이블용 경량 행. 핀 배열을 떼어내 2,000행 가상 스크롤에 맞춘다."""
    return [
        ComponentRow(
            refdes=c.refdes,
            part_number=c.part_number,
            manufacturer=c.manufacturer,
            value=c.value,
            package=c.package,
            x_nm=c.x_nm,
            y_nm=c.y_nm,
            rotation_mdeg=c.rotation_mdeg,
            side=c.side.value,
            pin_count=len(c.pins),
            pin_pitch_nm=c.pin_pitch_nm,
            body_w_nm=c.body_w_nm,
            body_h_nm=c.body_h_nm,
        )
        for c in design.components
    ]


#: 카드 그림에 실을 대표 부품 수. 86px 짜리 카드에서 형태로 읽히는 것은 이 정도가 한계다.
LANDMARK_COUNT = 48


def pick_landmarks(rows: list[ComponentRow], limit: int = LANDMARK_COUNT) -> list[ComponentRow]:
    """몸통이 큰 순으로 고른다.

    보드를 알아보게 하는 것은 큰 IC 와 커넥터의 배치다. 수동 소자는 카드 크기에서
    점으로만 보여 어느 보드나 비슷해 보인다.
    """
    def area(c: ComponentRow) -> int:
        return (c.body_w_nm or 0) * (c.body_h_nm or 0)

    return sorted(rows, key=area, reverse=True)[:limit]


def to_net_rows(design: Design) -> list[NetRow]:
    return [
        NetRow(
            name=n.name,
            net_class=n.net_class,
            diff_partner=n.diff_partner,
            pin_count=len(n.pins),
            length_nm=n.length_nm,
            via_count=n.via_count,
            width_nm=n.width_nm,
            unrouted=n.unrouted,
            layer_span=sorted({e.layer_index for e in (n.length_by_layer or [])}),
        )
        for n in design.nets
    ]


def fill_signatures(design: Design) -> None:
    """정규화 단계에서 넷 시그니처를 채운다. 파서는 이 값을 계산하지 않는다."""
    for net in design.nets:
        net.signature = net_signature(net.pins)
