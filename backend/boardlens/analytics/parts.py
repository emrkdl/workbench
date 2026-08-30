"""부품 마스터와 역검색.

"이 파트넘버를 쓰는 보드를 전부 찾아라." — 단종 공지가 뜰 때마다 설계팀이 손으로 하던
일이고, 여기서는 조인 한 번이다. 우선순위가 가장 높은 분석 기능인 이유이기도 하다.

정확도의 관건은 **MPN 정규화**다. 같은 부품이 GRM188R71H104KA93D 와 GRM188R71H104KA93
으로 들어오면 다른 부품이 되고, 그 순간 역검색은 조용히 절반만 답한다. 정규화 규칙은
코드가 아니라 데이터로 관리해야 나중에 고칠 수 있다 — 아래 SUFFIXES 가 그 자리다.
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field

from boardlens.cdm.api_v1 import Part, PartUsage
from boardlens.cdm.cdm_v1 import Design

#: 포장·수량 단위처럼 부품 자체와 무관한 접미사. 제조사마다 다르므로 데이터로 둔다.
SUFFIXES = ("-TR", "-T", "-REEL", "-CT", "-TE", "-2K", "-10K", "#PBF", "-ND")

_NOISE = re.compile(r"[\s_/]+")


def normalize_mpn(mpn: str) -> str:
    """비교용 정규형. 표시는 언제나 원본으로 한다."""
    out = _NOISE.sub("", mpn).upper()
    for suffix in SUFFIXES:
        if out.endswith(suffix):
            out = out[: -len(suffix)]
            break
    return out.replace("-", "")


@dataclass
class _Accum:
    display: str
    manufacturer: str | None = None
    lifecycle: str | None = None
    boards: set[str] = field(default_factory=set)
    quantity: int = 0
    usages: list[PartUsage] = field(default_factory=list)


class PartRegistry:
    """리비전들을 훑어 부품 마스터와 사용처를 쌓는다."""

    def __init__(self) -> None:
        self._parts: dict[str, _Accum] = {}

    def add_revision(
        self,
        design: Design,
        *,
        revision_id: str,
        revision_label: str,
        board_key: str,
        board_name: str,
        status: str | None = None,
        lifecycle: dict[str, str] | None = None,
    ) -> None:
        by_part: dict[str, list[str]] = defaultdict(list)
        display: dict[str, str] = {}
        maker: dict[str, str | None] = {}

        for c in design.components:
            if not c.part_number:
                continue
            key = normalize_mpn(c.part_number)
            by_part[key].append(c.refdes)
            display.setdefault(key, c.part_number)
            maker.setdefault(key, c.manufacturer)

        for key, refdes in by_part.items():
            acc = self._parts.setdefault(key, _Accum(display=display[key], manufacturer=maker[key]))
            acc.boards.add(board_key)
            acc.quantity += len(refdes)
            if lifecycle and key in lifecycle:
                acc.lifecycle = lifecycle[key]
            acc.usages.append(
                PartUsage(
                    board_key=board_key,
                    board_name=board_name,
                    revision_label=revision_label,
                    revision_id=revision_id,
                    status=status,
                    quantity=len(refdes),
                    # RefDes 를 순서대로 담아 두면 화면에서 바로 뷰어로 보낼 수 있다
                    refdes_list=sorted(refdes, key=lambda r: (len(r), r)),
                )
            )

    def parts(self) -> list[Part]:
        out = [
            Part(
                id=key,
                manufacturer=acc.manufacturer,
                mpn_normalized=key,
                mpn_display=acc.display,
                lifecycle=acc.lifecycle,
                board_count=len(acc.boards),
                total_quantity=acc.quantity,
            )
            for key, acc in self._parts.items()
        ]
        # 여러 보드에 걸친 부품이 먼저 — 단종 영향이 큰 순서이기도 하다
        out.sort(key=lambda p: (-p.board_count, -p.total_quantity, p.mpn_normalized))
        return out

    def usages(self, part_id: str) -> list[PartUsage]:
        acc = self._parts.get(part_id)
        if not acc:
            return []
        return sorted(acc.usages, key=lambda u: (u.board_key, u.revision_label))

    def reuse_ratio(self) -> tuple[int, int, float]:
        """(고유 부품 수, 2개 이상 보드에 쓰인 부품 수, 비율)."""
        total = len(self._parts)
        reused = sum(1 for acc in self._parts.values() if len(acc.boards) > 1)
        return total, reused, round(reused / total, 4) if total else 0.0
