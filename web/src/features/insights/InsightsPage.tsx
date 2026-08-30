import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchCatalog, fetchInsights } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { ErrorState, Loading, Panel, Stat, StatGrid, StatusPill } from "@/components/ui";
import { formatCount, toUm } from "@/lib/units";
import { revisionPath } from "@/lib/routes";
import { BarChart, LineChart, type Series } from "./charts";
import { AXES, DEFAULT_WEIGHTS, findSimilar, type Weights } from "./similar";
import s from "./insights.module.css";

const S1 = "var(--series-1)";
const S2 = "var(--series-2)";

export function InsightsPage() {
  const stats = useAsync(fetchInsights, []);
  const catalog = useAsync(fetchCatalog, []);
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [targetId, setTargetId] = useState<string | null>(null);

  const boards = catalog.data?.items ?? [];
  const target = useMemo(
    () => boards.find((b) => b.id === targetId) ?? boards[0] ?? null,
    [boards, targetId],
  );
  const similar = useMemo(
    () => (target ? findSimilar(boards, target, weights) : []),
    [boards, target, weights],
  );

  if (stats.loading || catalog.loading) return <Loading label="포트폴리오를 집계하는 중" />;
  if (stats.error) return <ErrorState error={stats.error} />;
  if (!stats.data) return null;
  const d = stats.data;

  const years = d.by_year.map((y) => String(y.year));
  const layerLabels = Object.keys(d.layer_histogram);

  const ruleYears = d.rule_trend.map((t) => String(t.year));
  const traceSeries: Series[] = [
    { key: "trace", label: "최소 선폭", color: S1, values: d.rule_trend.map((t) => toUm(t.min_trace_width_nm)), format: (v) => `${v.toFixed(0)} µm` },
    { key: "drill", label: "최소 드릴", color: S2, values: d.rule_trend.map((t) => toUm(t.min_drill_nm)), format: (v) => `${v.toFixed(0)} µm` },
  ];
  const pitchPoints = d.rule_trend.filter((t) => t.min_bga_pitch_nm);
  const pitchSeries: Series[] = [
    {
      key: "pitch",
      label: "BGA 최소 피치",
      color: S1,
      values: pitchPoints.map((t) => toUm(t.min_bga_pitch_nm!)),
      format: (v) => `${v.toFixed(0)} µm`,
    },
  ];

  return (
    <div className={s.page}>
      <header className={s.head}>
        <h1 className={s.title}>인사이트</h1>
        <span className={s.sub}>
          보드 하나를 볼 때는 안 보이고 수십 장이 쌓여야 보이는 것들. 집계 {d.generated_at.slice(0, 10)}
        </span>
      </header>

      <div className={s.body}>
        <Panel title="포트폴리오">
          <StatGrid cols={4}>
            <Stat label="보드" value={formatCount(d.board_count)} hint={`리비전 ${formatCount(d.revision_count)}`} />
            <Stat label="고유 부품" value={formatCount(d.part_count)} hint="MPN 정규화 후" />
            <Stat
              label="부품 재사용률"
              value={`${Math.round(d.reuse_ratio * 100)}`}
              unit="%"
              tone="accent"
              hint={`${formatCount(d.reused_part_count)}종이 2개 이상 보드에`}
            />
            <Stat label="누적 부품" value={formatCount(d.component_total)} hint={`넷 ${formatCount(d.net_total)}`} />
          </StatGrid>
          <p className={s.note}>
            재사용률은 설계 표준화 수준의 대리 지표입니다. 낮으면 같은 기능을 보드마다 다른 부품으로 풀고 있다는
            뜻이고, 그만큼 구매·재고·단종 대응 비용이 늘어납니다.
          </p>
        </Panel>

        <div className={s.grid2}>
          <Panel title="연도별 등록">
            <BarChart
              labels={years}
              caption="연도별 리비전 등록 수와 신규 보드 수"
              series={[
                { key: "rev", label: "리비전", color: S1, values: d.by_year.map((y) => y.revisions) },
                { key: "board", label: "신규 보드", color: S2, values: d.by_year.map((y) => y.boards) },
              ]}
            />
          </Panel>
          <Panel title="층수 분포">
            <BarChart
              labels={layerLabels.map((l) => `${l}층`)}
              caption="도체층 수별 리비전 분포"
              series={[{ key: "n", label: "리비전", color: S1, values: layerLabels.map((l) => d.layer_histogram[l] ?? 0) }]}
            />
          </Panel>
        </div>

        <div className={s.grid2}>
          <Panel title="면적 분포">
            <BarChart
              labels={d.area_buckets.map((b) => b.label)}
              caption="보드 면적 구간별 리비전 분포"
              series={[{ key: "n", label: "리비전", color: S1, values: d.area_buckets.map((b) => b.count) }]}
            />
          </Panel>
          <Panel title="복잡도 분포">
            <BarChart
              labels={d.complexity_buckets.map((b) => b.label)}
              caption="복잡도 점수 구간별 리비전 분포"
              series={[{ key: "n", label: "리비전", color: S1, values: d.complexity_buckets.map((b) => b.count) }]}
            />
          </Panel>
        </div>

        <div className={s.grid2}>
          <Panel title="설계 룰 추세">
            <LineChart labels={ruleYears} series={traceSeries} caption="연도별 최소 선폭과 최소 드릴의 중앙값" />
            <p className={s.note}>
              연도별 <b>중앙값</b>입니다. 평균으로 보면 전원 보드 한 장이 섞였을 때 추세가 통째로 끌려갑니다.
            </p>
          </Panel>
          <Panel title="BGA 최소 피치 추세">
            {pitchPoints.length ? (
              <LineChart
                labels={pitchPoints.map((t) => String(t.year))}
                series={pitchSeries}
                caption="연도별 BGA 최소 피치 중앙값"
              />
            ) : (
              <p className={s.note}>BGA 를 쓴 리비전이 없습니다.</p>
            )}
            <p className={s.note}>
              선폭·드릴과 크기가 한 자릿수 달라 차트를 나눴습니다. 축 하나에 겹쳐 그리면 둘 중 하나는 바닥에 붙어
              추세가 보이지 않습니다.
            </p>
          </Panel>
        </div>

        <Panel title="가장 많이 쓰는 부품" flush>
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
                {boards.map((b) => (
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

          <p className={s.note}>
            무엇을 &lsquo;비슷하다&rsquo;고 볼지는 설계자마다 다릅니다. 학습 모델이 아니라 가중 거리로 둔 이유이고,
            그래서 가중치를 직접 만질 수 있습니다.
          </p>

          <div className={s.similarList}>
            {similar.map((x) => (
              <Link key={x.board.id} to={revisionPath(x.board.id, x.board.latest_revision_id)} className={s.similarRow}>
                <span className={s.score}>{x.score.toFixed(0)}</span>
                <span className={s.similarName}>
                  <b>{x.board.board_key}</b> {x.board.name}
                </span>
                <StatusPill status={x.board.status} />
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
      </div>
    </div>
  );
}
