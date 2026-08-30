"""목데이터용 기하 합성.

CDM Design 하나에서 레이어별 .blg 버퍼를 만든다. 실제 HKP 에는 배선 좌표가 들어 있을
것이므로 Phase 5에서는 이 파일이 빠지고 파서가 같은 LayerGeometry 를 채운다.

"그럴듯해 보이는 그림"이 목적이 아니라 **뷰어가 실제로 감당해야 할 규모와 구조**를
만드는 것이 목적이다. 그래서:

- 패드는 실제 핀 좌표에서 나온다 (부품 표와 뷰어가 같은 좌표를 가리킨다)
- 배선은 넷의 핀들을 실제로 잇는다. 45° 코너를 쓰는 맨해튼 라우팅이라 배선처럼 보인다
- 전원·GND 넷은 배선하지 않는다. 실제로도 플레인으로 연결되고, 이걸 라우팅하면
  선분 수가 몇 배로 뛰면서 실제 보드와 다른 분포가 된다
"""

from __future__ import annotations

import random

from boardlens.cdm.cdm_v1 import Design, LayerRole
from boardlens.geometry.blg import NO_NET, LayerGeometry
from boardlens.ingest.summarize import is_power_net
from boardlens.units import NM_PER_MM, NM_PER_UM

CONDUCTOR = (LayerRole.SIGNAL, LayerRole.PLANE_POWER, LayerRole.PLANE_GND, LayerRole.MIXED)
PLANE = (LayerRole.PLANE_POWER, LayerRole.PLANE_GND)


def _pad_size(pitch_nm: int | None, package: str) -> tuple[int, int]:
    if pitch_nm:
        return int(pitch_nm * 0.6), int(pitch_nm * 0.6)
    if package.startswith(("0201", "0402")):
        return 500 * NM_PER_UM, 550 * NM_PER_UM
    if package.startswith(("0603", "0805")):
        return 900 * NM_PER_UM, 900 * NM_PER_UM
    return 700 * NM_PER_UM, 700 * NM_PER_UM


def _chain(points: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """가장 가까운 핀부터 차례로 잇는 순회.

    핀을 x 좌표순으로 이으면 보드를 가로지르는 긴 대각선이 쏟아진다. 실제 배선은
    거의 언제나 국소적이므로 최근접 순회로 잡아야 배선 밀도와 길이 분포가 그럴듯해진다.
    """
    if len(points) < 3:
        return points
    remaining = points[1:]
    order = [points[0]]
    while remaining:
        cx, cy = order[-1]
        i = min(range(len(remaining)), key=lambda k: (remaining[k][0] - cx) ** 2 + (remaining[k][1] - cy) ** 2)
        order.append(remaining.pop(i))
    return order


def _route(x0: int, y0: int, x1: int, y1: int) -> list[tuple[int, int, int, int]]:
    """45° 코너 하나를 쓰는 두 선분. PCB 배선의 기본 형태다."""
    dx, dy = x1 - x0, y1 - y0
    if dx == 0 and dy == 0:
        return []
    sx = 1 if dx >= 0 else -1
    sy = 1 if dy >= 0 else -1
    run = min(abs(dx), abs(dy))
    # 먼저 긴 축으로 직선, 남은 만큼 대각선
    if abs(dx) >= abs(dy):
        bx, by = x0 + sx * (abs(dx) - run), y0
    else:
        bx, by = x0, y0 + sy * (abs(dy) - run)
    out = []
    if (bx, by) != (x0, y0):
        out.append((x0, y0, bx, by))
    out.append((bx, by, x1, y1))
    return out


def synthesize(design: Design, rng: random.Random) -> dict[int, LayerGeometry]:
    conductors = [l for l in design.stackup if l.role in CONDUCTOR]
    if not conductors:
        return {}
    signal_layers = [l.index for l in conductors if l.role == LayerRole.SIGNAL] or [conductors[0].index]
    plane_layers = [l.index for l in conductors if l.role in PLANE]
    top, bottom = conductors[0].index, conductors[-1].index

    geo = {l.index: LayerGeometry(layer_index=l.index) for l in conductors}
    net_id = {n.name: i for i, n in enumerate(design.nets)}

    # ── 패드 — 부품 표의 좌표와 같은 값을 쓴다 ──
    pin_at: dict[tuple[str, str], tuple[int, int]] = {}
    pin_layer: dict[str, int] = {}
    for c in design.components:
        layer = top if c.side.value == "top" else bottom
        pin_layer[c.refdes] = layer
        w, h = _pad_size(c.pin_pitch_nm, c.package)
        for p in c.pins:
            pin_at[(c.refdes, p.name)] = (p.x_nm, p.y_nm)
            geo[layer].pads.append((p.x_nm, p.y_nm, w, h, NO_NET))

    # 패드에 넷을 붙인다. 연결은 Net.pins 한 곳에서만 선언되므로 여기서 되짚는다.
    pad_index: dict[tuple[int, int, int], int] = {}
    for layer, g in geo.items():
        for i, (x, y, _, _, _) in enumerate(g.pads):
            pad_index[(layer, x, y)] = i
    for ni, net in enumerate(design.nets):
        for ref in net.pins:
            pos = pin_at.get((ref.refdes, ref.pin_name))
            layer = pin_layer.get(ref.refdes)
            if pos is None or layer is None:
                continue
            i = pad_index.get((layer, pos[0], pos[1]))
            if i is not None:
                x, y, w, h, _ = geo[layer].pads[i]
                geo[layer].pads[i] = (x, y, w, h, ni)

    # ── 배선 ──
    default_width = design.design_rules.min_trace_width_nm
    for ni, net in enumerate(design.nets):
        if is_power_net(net) or net.unrouted or len(net.pins) < 2:
            continue
        points = [pin_at[(p.refdes, p.pin_name)] for p in net.pins if (p.refdes, p.pin_name) in pin_at]
        if len(points) < 2:
            continue
        points = _chain(sorted(set(points)))
        layers = sorted({e.layer_index for e in (net.length_by_layer or [])} & set(signal_layers)) or [
            rng.choice(signal_layers)
        ]
        width = net.width_nm or default_width
        for i in range(len(points) - 1):
            layer = layers[i % len(layers)]
            (ax, ay), (bx, by) = points[i], points[i + 1]
            for seg in _route(ax, ay, bx, by):
                geo[layer].traces.append((*seg, width, ni))
            # 층이 바뀌는 자리에는 비아가 선다
            if len(layers) > 1 and i + 1 < len(points) - 1:
                nxt = layers[(i + 1) % len(layers)]
                if nxt != layer:
                    d = design.design_rules.min_drill_nm * 2
                    geo[layer].vias.append((bx, by, d, ni))
                    geo[nxt].vias.append((bx, by, d, ni))

    # ── 플레인 — 보드 대부분을 덮고 분할 몇 개 ──
    xs = [p for poly in design.header.outline if not poly.is_cutout for p in poly.points_nm[0::2]]
    ys = [p for poly in design.header.outline if not poly.is_cutout for p in poly.points_nm[1::2]]
    if xs and plane_layers:
        x0, x1 = min(xs) + NM_PER_MM, max(xs) - NM_PER_MM
        y0, y1 = min(ys) + NM_PER_MM, max(ys) - NM_PER_MM
        power_nets = [i for i, n in enumerate(design.nets) if is_power_net(n)]
        for layer in plane_layers:
            splits = rng.randint(1, 3)
            step = (x1 - x0) // splits
            for k in range(splits):
                gap = 400 * NM_PER_UM
                ax = x0 + k * step + (gap if k else 0)
                bx = x0 + (k + 1) * step - gap
                net = power_nets[k % len(power_nets)] if power_nets else NO_NET
                geo[layer].planes.append(([ax, y0, bx, y0, bx, y1, ax, y1], net))

    return geo
