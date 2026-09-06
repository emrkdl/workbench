"""포트폴리오 통계.

보드 하나를 볼 때는 안 보이고 수백 장이 쌓여야 보이는 것들 — 세대가 지나며 설계 룰이
얼마나 미세화됐는지, 부품 표준화가 되고 있는지, 판이 얼마나 빽빽해졌는지.

리비전 요약(RevisionSummary)만 읽는다. 원본 테이블을 건드리지 않으므로 보드가 수천 장이
되어도 이 집계는 값싸게 유지된다.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime
from statistics import median

from boardlens.cdm.api_v1 import (
    Bucket,
    Part,
    PortfolioStats,
    Revision,
    RuleTrendPoint,
    YearCount,
)

AREA_BUCKETS: list[tuple[str, float, float]] = [
    ("~10 cm²", 0, 1_000),
    ("10–50 cm²", 1_000, 5_000),
    ("50–100 cm²", 5_000, 10_000),
    ("100–200 cm²", 10_000, 20_000),
    ("200 cm² 이상", 20_000, float("inf")),
]

# 실장률 — 부품 몸통이 기판을 덮은 비율. 구간은 10%씩 고르게 자른다. 몰린 구간만
# 잘게 쪼개면 막대 높이가 구간 너비를 반영하지 않아 분포가 실제보다 평평해 보인다.
MOUNT_BUCKETS: list[tuple[str, float, float]] = [
    ("~30%", 0, 30),
    ("30–40%", 30, 40),
    ("40–50%", 40, 50),
    ("50–60%", 50, 60),
    ("60% 이상", 60, float("inf")),
]


def _bucketize(values: list[float], spec: list[tuple[str, float, float]]) -> list[Bucket]:
    counts = Counter[str]()
    for v in values:
        for label, lo, hi in spec:
            if lo <= v < hi:
                counts[label] += 1
                break
    return [Bucket(label=label, count=counts.get(label, 0)) for label, _, _ in spec]


def build(
    revisions: list[Revision],
    *,
    first_seen_year: dict[str, int],
    part_count: int,
    reused_part_count: int,
    reuse_ratio: float,
    top_parts: list[Part],
) -> PortfolioStats:
    years: dict[int, int] = defaultdict(int)
    for r in revisions:
        years[int(r.created_at[:4])] += 1
    new_boards: dict[int, int] = defaultdict(int)
    for year in first_seen_year.values():
        new_boards[year] += 1

    by_year = [
        YearCount(year=y, revisions=years.get(y, 0), boards=new_boards.get(y, 0))
        for y in sorted(set(years) | set(new_boards))
    ]

    # 설계 룰은 평균이 아니라 중앙값으로 본다. 한 해에 전원 보드 한 장이 섞이면
    # 최소 선폭 평균이 통째로 끌려가 추세가 사라진다.
    by_year_rules: dict[int, list[Revision]] = defaultdict(list)
    for r in revisions:
        by_year_rules[int(r.created_at[:4])].append(r)

    rule_trend: list[RuleTrendPoint] = []
    for year in sorted(by_year_rules):
        group = by_year_rules[year]
        pitches = [r.summary.min_bga_pitch_nm for r in group if r.summary.min_bga_pitch_nm]
        rule_trend.append(
            RuleTrendPoint(
                year=year,
                samples=len(group),
                min_trace_width_nm=int(median(r.summary.min_trace_width_nm for r in group)),
                min_drill_nm=int(median(r.summary.min_drill_nm for r in group)),
                min_bga_pitch_nm=int(median(pitches)) if pitches else None,
            )
        )

    return PortfolioStats(
        generated_at=datetime.now().isoformat(timespec="seconds"),
        board_count=len(first_seen_year),
        revision_count=len(revisions),
        component_total=sum(r.summary.component_count for r in revisions),
        net_total=sum(r.summary.net_count for r in revisions),
        part_count=part_count,
        reused_part_count=reused_part_count,
        reuse_ratio=reuse_ratio,
        by_year=by_year,
        layer_histogram=dict(sorted(Counter(str(r.summary.layer_count) for r in revisions).items(), key=lambda kv: int(kv[0]))),
        area_buckets=_bucketize([r.summary.area_mm2 for r in revisions], AREA_BUCKETS),
        mount_buckets=_bucketize([r.summary.mount_ratio_pct for r in revisions], MOUNT_BUCKETS),
        rule_trend=rule_trend,
        top_parts=top_parts,
    )
