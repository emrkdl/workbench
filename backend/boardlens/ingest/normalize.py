"""정규화 — CDM 규약을 강제하는 단계.

파서는 원본이 준 대로 채운다. 여기서 좌표계 규약을 맞춘다:

  - 원점을 보드 외형의 좌하단으로 옮긴다. CAD 마다 원점이 제각각인데, 정규화하지 않으면
    리비전 간 좌표 비교가 성립하지 않는다 — Diff 가 전 부품을 "이동함"으로 잡는다
  - 각도를 0 이상 360000 미만으로 접는다
  - 넷 시그니처를 채운다. 파서는 이 값을 계산하지 않는다
"""

from __future__ import annotations

from boardlens.cdm.cdm_v1 import Design
from boardlens.ingest.summarize import net_signature
from boardlens.units import normalize_angle


def _outline_origin(design: Design) -> tuple[int, int]:
    xs: list[int] = []
    ys: list[int] = []
    for poly in design.header.outline:
        if poly.is_cutout:
            continue
        xs.extend(poly.points_nm[0::2])
        ys.extend(poly.points_nm[1::2])
    return (min(xs), min(ys)) if xs else (0, 0)


def shift(design: Design, dx: int, dy: int) -> None:
    if dx == 0 and dy == 0:
        return
    for poly in design.header.outline:
        pts = poly.points_nm
        for i in range(0, len(pts), 2):
            pts[i] -= dx
            pts[i + 1] -= dy
    for c in design.components:
        c.x_nm -= dx
        c.y_nm -= dy
        for p in c.pins:
            p.x_nm -= dx
            p.y_nm -= dy
    for f in design.drc_findings or []:
        if f.x_nm is not None:
            f.x_nm -= dx
        if f.y_nm is not None:
            f.y_nm -= dy
    for g in design.layer_geometry or []:
        g.bbox.x0_nm -= dx
        g.bbox.x1_nm -= dx
        g.bbox.y0_nm -= dy
        g.bbox.y1_nm -= dy


def normalize(design: Design) -> None:
    ox, oy = _outline_origin(design)
    shift(design, ox, oy)

    for c in design.components:
        c.rotation_mdeg = normalize_angle(c.rotation_mdeg)

    for net in design.nets:
        net.signature = net_signature(net.pins)
