"""무결성 검사.

CDM 스키마를 통과해도 의미상 깨진 데이터는 들어온다. 여기서 규칙을 돌리되, 대부분은
**실패가 아니라 경고**로 기록한다 — 실제 설계 데이터는 원래 조금씩 지저분하고, 그걸
이유로 적재를 거부하면 아무도 시스템을 쓰지 않는다.

실패로 막는 것은 둘뿐이다. RefDes 중복(Diff 의 매칭 키가 깨진다)과 적층 인덱스 불연속
(층 구조를 해석할 수 없다). 나머지는 적재하고 리비전 상세에 띄운다.
"""

from __future__ import annotations

from collections import Counter

from boardlens.cdm.cdm_v1 import Design, IngestWarning, Severity


class IntegrityError(Exception):
    """적재를 막아야 하는 위반."""


def _outline_box(design: Design) -> tuple[int, int, int, int] | None:
    xs: list[int] = []
    ys: list[int] = []
    for poly in design.header.outline:
        if poly.is_cutout:
            continue
        xs.extend(poly.points_nm[0::2])
        ys.extend(poly.points_nm[1::2])
    return (min(xs), min(ys), max(xs), max(ys)) if xs else None


def validate(design: Design) -> list[IngestWarning]:
    warnings: list[IngestWarning] = list(design.warnings or [])

    # ── 막아야 하는 것 ──
    duplicates = [r for r, n in Counter(c.refdes for c in design.components).items() if n > 1]
    if duplicates:
        raise IntegrityError(
            f"RefDes 가 중복됩니다 ({len(duplicates)}건): {', '.join(sorted(duplicates)[:8])}"
            " — Diff 의 매칭 키라 중복된 채로는 적재할 수 없습니다"
        )

    indices = [l.index for l in design.stackup]
    if indices and indices != list(range(1, len(indices) + 1)):
        raise IntegrityError(
            f"적층 인덱스가 1부터 연속이 아닙니다: {indices[:12]} — 층 구조를 해석할 수 없습니다"
        )

    # ── 기록만 하는 것 ──
    box = _outline_box(design)
    if box:
        x0, y0, x1, y1 = box
        outside = sum(1 for c in design.components if not (x0 <= c.x_nm <= x1 and y0 <= c.y_nm <= y1))
        if outside:
            warnings.append(IngestWarning(
                code="component_outside_outline",
                severity=Severity.WARNING,
                message="부품 좌표가 보드 외형 밖입니다 — 배치 오류이거나 원점 정규화 실패 신호입니다",
                count=outside,
            ))

    orphans = sum(1 for n in design.nets if not n.pins)
    if orphans:
        warnings.append(IngestWarning(
            code="orphan_net",
            severity=Severity.WARNING,
            message="핀이 0개인 넷",
            count=orphans,
        ))

    unrouted = sum(1 for n in design.nets if n.unrouted)
    if unrouted:
        warnings.append(IngestWarning(
            code="unrouted_net",
            severity=Severity.WARNING,
            message="미배선 넷",
            count=unrouted,
        ))

    # 넷이 가리키는 핀이 실제 부품에 있는지 — 없으면 넷리스트 Diff 가 조용히 어긋난다
    known = {(c.refdes, p.name) for c in design.components for p in c.pins}
    if known:
        dangling = sum(
            1 for n in design.nets for p in n.pins if (p.refdes, p.pin_name) not in known
        )
        if dangling:
            warnings.append(IngestWarning(
                code="dangling_net_pin",
                severity=Severity.WARNING,
                message="넷이 가리키는 핀이 부품 목록에 없습니다",
                count=dangling,
            ))

    return warnings
