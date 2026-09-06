import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchCatalog, fetchInsights } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import type { Board } from "@/lib/cdm";
import { EmptyState, ErrorState, Loading, Panel, Stat, StatGrid } from "@/components/ui";
import { formatCount, toMm } from "@/lib/units";
import { revisionPath } from "@/lib/routes";
import { FacetPanel } from "@/features/catalog/FacetPanel";
import {
  applyFilters,
  liveFacets,
  yearOf,
  EMPTY_FILTERS,
  type CatalogFilters,
} from "@/features/catalog/filters";
import { BarChart } from "./charts";
import { AXES, DEFAULT_WEIGHTS, findSimilar, type Weights } from "./similar";
import s from "./insights.module.css";

const S1 = "var(--series-1)";
const S2 = "var(--series-2)";

/**
 * 인사이트.
 *
 * 카탈로그와 같은 필터를 옆에 세운다. 포트폴리오 전체의 평균은 대개 아무 말도 하지
 * 않는다 — 2층 플렉스와 12층 메인보드를 같은 통에 넣고 낸 중앙값이 어느 쪽도 닮지
 * 않기 때문이다. "6층 이상, 100 cm² 넘는 것들만" 처럼 좁혀 놓고 봐야 분포가 말을
 * 하기 시작한다.
 *
 * 그래서 집계는 걸러낸 보드에서 그 자리에서 낸다. 보드가 수천 장이 되면 같은 필터가
 * 그대로 질의 파라미터가 되어 서버로 넘어가고, 이 화면은 받은 것을 그리기만 하면 된다.
 * 지금 서버가 내려주는 사전 집계(PortfolioStats)와 구간 정의를 맞춰 둔 이유다.
 *
 * 부품 마스터 쪽(고유 부품·재사용률·많이 쓰는 부품)만은 걸러낼 수 없다. 어느 부품이
 * 어느 보드에 쓰였는지는 보드 목록이 아니라 부품 색인에 있고, 그것까지 받아 오면
 * 화면 하나 여는 값이 너무 비싸진다. 그 패널만 전체 기준이라고 적어 둔다.
 */

/* 구간 정의는 백엔드(analytics/portfolio.py)와 같은 값을 쓴다. 한쪽만 고치면 서버가
   집계한 화면과 여기서 집계한 화면이 다른 그림을 그린다. */
const AREA_BUCKETS: [string, number, number][] = [
  ["~10 cm²", 0, 1_000],
  ["10–50 cm²", 1_000, 5_000],
  ["50–100 cm²", 5_000, 10_000],
  ["100–200 cm²", 10_000, 20_000],
  ["200 cm² 이상", 20_000, Infinity],
];

const MOUNT_BUCKETS: [string, number, number][] = [
  ["~30%", 0, 30],
  ["30–40%", 30, 40],
  ["40–50%", 40, 50],
  ["50–60%", 50, 60],
  ["60% 이상", 60, Infinity],
];

function bucketize(values: number[], spec: [string, number, number][]) {
  return spec.map(([label, lo, hi]) => ({
    label,
    count: values.filter((v) => v >= lo && v < hi).length,
  }));
}

const median = (values: number[]) => {
  if (!values.length) return 0;
  const v = [...values].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
};

function aggregate(boards: Board[]) {
  const sum = (pick: (b: Board) => number) => boards.reduce((n, b) => n + pick(b), 0);

  const years = [...new Set(boards.flatMap((b) => [yearOf(b), Number(b.updated_at.slice(0, 4))]))].sort();
  const layers = [...new Set(boards.map((b) => b.summary.layer_count))].sort((a, b) => a - b);

  return {
    revisions: sum((b) => b.revision_count),
    components: sum((b) => b.summary.component_count),
    nets: sum((b) => b.summary.net_count),
    mountMedian: median(boards.map((b) => b.summary.mount_ratio_pct)),
    traceMedian: median(boards.map((b) => b.summary.min_trace_width_nm)),
    years: years.map(String),
    registered: years.map((y) => boards.filter((b) => yearOf(b) === y).length),
    updated: years.map((y) => boards.filter((b) => Number(b.updated_at.slice(0, 4)) === y).length),
    layers: layers.map(String),
    layerCounts: layers.map((n) => boards.filter((b) => b.summary.layer_count === n).length),
    area: bucketize(boards.map((b) => b.summary.area_mm2), AREA_BUCKETS),
    mount: bucketize(boards.map((b) => b.summary.mount_ratio_pct), MOUNT_BUCKETS),
  };
}

export function InsightsPage() {
  const stats = useAsync(fetchInsights, []);
  const catalog = useAsync(fetchCatalog, []);
  const [filters, setFilters] = useState<CatalogFilters>(EMPTY_FILTERS);
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [targetId, setTargetId] = useState<string | null>(null);

  const boards = catalog.data?.items ?? [];
  const facets = useMemo(() => liveFacets(boards, filters), [boards, filters]);
  const shown = useMemo(() => applyFilters(boards, filters), [boards, filters]);
  const agg = useMemo(() => aggregate(shown), [shown]);

  /* 기준 보드는 걸러낸 목록 안에서 고른다. 필터를 좁히면 후보도 같이 좁아진다 —
     "우리 제품군 안에서 가장 닮은 판"을 찾는 것이 실제로 하는 일이다. */
  const target = useMemo(
    () => shown.find((b) => b.id === targetId) ?? shown[0] ?? null,
    [shown, targetId],
  );
  const similar = useMemo(
    () => (target ? findSimilar(shown, target, weights) : []),
    [shown, target, weights],
  );

  if (stats.loading || catalog.loading) return <Loading label="포트폴리오를 집계하는 중" />;
  if (stats.error) return <ErrorState error={stats.error} />;
  if (catalog.error) return <ErrorState error={catalog.error} />;
  if (!stats.data) return null;
  const d = stats.data;

  return (
    <div className={s.page}>
      <header className={s.head}>
        <h1 className={s.title}>인사이트</h1>
        <span className={s.resultCount}>
          <b>{shown.length}</b> / {boards.length}개 보드
        </span>
        <span className={s.headSpacer} />
        <input
          className={s.search}
          type="search"
          placeholder="보드 코드 · 이름 · 파트넘버"
          aria-label="보드 검색"
          value={filters.q}
          onChange={(e) => setFilters({ ...filters, q: e.target.value })}
        />
      </header>

      <FacetPanel filters={filters} facets={facets} onChange={setFilters} />

      <div className={s.body}>
        {shown.length === 0 ? (
          <EmptyState
            title="조건에 맞는 보드가 없습니다"
            body="필터를 하나씩 해제하거나 검색어를 지워 보세요. 각 선택지 옆 숫자는 그 조건을 골랐을 때의 결과 수입니다."
          />
        ) : (
          <>
            <Panel title="포트폴리오">
              <StatGrid cols={4}>
                <Stat
                  label="보드"
                  value={formatCount(shown.length)}
                  hint={`리비전 ${formatCount(agg.revisions)}`}
                />
                <Stat
                  label="부품"
                  value={formatCount(agg.components)}
                  hint={`넷 ${formatCount(agg.nets)}`}
                />
                <Stat
                  label="실장률 중앙값"
                  value={agg.mountMedian.toFixed(1)}
                  unit="%"
                  tone="accent"
                  hint="부품 몸통이 덮은 면적"
                />
                <Stat
                  label="최소 선폭 중앙값"
                  value={toMm(agg.traceMedian).toFixed(3)}
                  unit="mm"
                  hint="좁을수록 까다로운 공정"
                />
              </StatGrid>
            </Panel>

            <div className={s.grid2}>
              <Panel title="연도별 등록">
                <BarChart
                  labels={agg.years}
                  caption="보드가 처음 올라온 해와 마지막으로 갱신된 해"
                  series={[
                    { key: "new", label: "신규", color: S1, values: agg.registered },
                    { key: "upd", label: "갱신", color: S2, values: agg.updated },
                  ]}
                />
              </Panel>
              <Panel title="층수 분포">
                {/* 층수는 필터의 첫 칸이라 한 가지만 남는 일이 흔하다. 그때 막대 하나가
                    패널을 가득 채우면 분포를 그린 것처럼 보이지만 아무것도 말하지 않는다. */}
                {agg.layers.length > 1 ? (
                  <BarChart
                    labels={agg.layers.map((l) => `${l}층`)}
                    caption="도체층 수별 보드 분포"
                    series={[{ key: "n", label: "보드", color: S1, values: agg.layerCounts }]}
                  />
                ) : (
                  <p className={s.note}>고른 보드가 전부 {agg.layers[0]}층입니다.</p>
                )}
              </Panel>
            </div>

            <div className={s.grid2}>
              <Panel title="면적 분포">
                <BarChart
                  labels={agg.area.map((b) => b.label)}
                  caption="보드 면적 구간별 보드 분포"
                  series={[{ key: "n", label: "보드", color: S1, values: agg.area.map((b) => b.count) }]}
                />
              </Panel>
              <Panel title="실장률 분포">
                <BarChart
                  labels={agg.mount.map((b) => b.label)}
                  caption="실장률 구간별 보드 분포"
                  series={[{ key: "n", label: "보드", color: S1, values: agg.mount.map((b) => b.count) }]}
                />
              </Panel>
            </div>

            <Panel
              title="가장 많이 쓰는 부품"
              action={<span className={s.scope}>전체 {formatCount(d.board_count)}개 보드 기준</span>}
              flush
            >
              <div className={s.topParts}>
                {d.top_parts.map((p, i) => (
                  <Link key={p.id} to={`/parts?part=${encodeURIComponent(p.id)}`} className={s.topPart}>
                    <span className={s.rank}>{i + 1}</span>
                    <span className={s.mpn}>{p.mpn_display}</span>
                    <span className={s.maker}>{p.manufacturer ?? "—"}</span>
                    <span className={s.bar} aria-hidden="true">
                      <i style={{ width: `${(p.board_count / (d.top_parts[0]?.board_count || 1)) * 100}%` }} />
                    </span>
                    <span className={s.num}>{p.board_count} 보드</span>
                    <span className={s.num}>{formatCount(p.total_quantity)} 개</span>
                  </Link>
                ))}
              </div>
            </Panel>

            <Panel
              title="유사 보드 찾기"
              action={
                <button type="button" className={s.reset} onClick={() => setWeights(DEFAULT_WEIGHTS)}>
                  가중치 초기화
                </button>
              }
            >
              <div className={s.similarHead}>
                <label className={s.pick}>
                  기준 보드
                  <select value={target?.id ?? ""} onChange={(e) => setTargetId(e.target.value)}>
                    {shown.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.board_key} · {b.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className={s.weights}>
                  {AXES.map((axis) => (
                    <label key={axis.key} className={s.weight}>
                      <span>{axis.label}</span>
                      <input
                        type="range"
                        min={0}
                        max={2}
                        step={0.2}
                        value={weights[axis.key] ?? 0}
                        onChange={(e) => setWeights({ ...weights, [axis.key]: Number(e.target.value) })}
                        aria-label={`${axis.label} 가중치`}
                      />
                      <b>{(weights[axis.key] ?? 0).toFixed(1)}</b>
                    </label>
                  ))}
                </div>
              </div>

              <div className={s.similarList}>
                {similar.map((x) => (
                  <Link key={x.board.id} to={revisionPath(x.board.id, x.board.latest_revision_id)} className={s.similarRow}>
                    <span className={s.score}>{x.score.toFixed(0)}</span>
                    <span className={s.similarName}>
                      <b>{x.board.board_key}</b> {x.board.name}
                    </span>
                    <span className={s.gaps}>
                      {x.gaps
                        .filter((g) => g.gap != null)
                        .map((g) => (
                          <span key={g.key} title={`${g.label} 차이 ${(g.gap! * 100).toFixed(0)}%`}>
                            <i style={{ opacity: 1 - Math.min(g.gap!, 1) }} />
                            {g.label}
                          </span>
                        ))}
                    </span>
                  </Link>
                ))}
              </div>
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}
