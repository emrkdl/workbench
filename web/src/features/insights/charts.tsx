import { useId, useMemo, useState } from "react";
import s from "./charts.module.css";

/**
 * 차트.
 *
 * 라이브러리를 쓰지 않는다. 필요한 형태가 막대와 꺾은선 둘뿐이고, 폐쇄망 번들에 넣을
 * 의존성을 하나라도 줄이는 편이 낫다. 색은 토큰(--series-1/2)에서만 오고, 그 값은
 * 눈으로 고른 것이 아니라 CVD 분리·채도·대비 검증을 통과한 값이다.
 *
 * 규칙 몇 가지를 코드로 못박아 둔다:
 * - 축은 하나. 크기가 다른 두 값은 차트를 나눈다 (선폭·드릴 vs BGA 피치)
 * - 계열이 둘 이상이면 범례가 항상 있다. 색만으로 구분하게 두지 않는다
 * - 막대 사이에 2px 틈을 둔다. 붙여 놓으면 경계가 사라진다
 * - 표로도 볼 수 있어야 한다. 색을 못 읽는 경우의 대비책이다
 */

export interface Series {
  key: string;
  label: string;
  color: string;
  values: number[];
  /** 표시용 서식. 없으면 천 단위 구분만 한다. */
  format?: (v: number) => string;
}

const fmt = (series: Series, v: number) => (series.format ? series.format(v) : v.toLocaleString("en-US"));

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / mag) * mag;
}

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <div className={s.legend}>
      {series.map((x) => (
        <span key={x.key}>
          <i className={s.legendDot} style={{ background: x.color }} />
          {x.label}
        </span>
      ))}
    </div>
  );
}

function TableView({ labels, series, caption }: { labels: string[]; series: Series[]; caption: string }) {
  return (
    <details className={s.tableView}>
      <summary>표로 보기</summary>
      <div className={s.tableWrap}>
        <table>
          <caption className="srOnly">{caption}</caption>
          <thead>
            <tr>
              <th scope="col">구간</th>
              {series.map((x) => (
                <th key={x.key} scope="col">
                  {x.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {labels.map((label, i) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                {series.map((x) => (
                  <td key={x.key}>{fmt(x, x.values[i] ?? 0)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function Tooltip({
  index,
  labels,
  series,
  left,
}: {
  index: number;
  labels: string[];
  series: Series[];
  left: number;
}) {
  return (
    <div className={s.tooltip} style={{ left: `${left}%` }} role="status">
      <span className={s.tooltipLabel}>{labels[index]}</span>
      {series.map((x) => (
        <span key={x.key} className={s.tooltipRow}>
          <i className={s.legendDot} style={{ background: x.color }} />
          {x.label}
          <b>{fmt(x, x.values[index] ?? 0)}</b>
        </span>
      ))}
    </div>
  );
}

/* ── 막대 ──────────────────────────────────── */

export function BarChart({
  labels,
  series,
  height = 168,
  caption,
}: {
  labels: string[];
  series: Series[];
  height?: number;
  caption: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const max = useMemo(() => niceMax(Math.max(...series.flatMap((x) => x.values), 1)), [series]);

  return (
    <figure className={s.figure}>
      {/* 막대는 SVG 가 아니라 HTML 로 그린다. viewBox 를 늘여 쓰면 모서리 둥글기가
          가로로 찌그러지는데, 데이터 끝의 4px 둥글기는 눈에 띄는 표시라 지킬 값이다. */}
      <div className={s.plot} style={{ height }} onPointerLeave={() => setHover(null)} aria-describedby={`${id}-desc`}>
        <div className={s.gridLines} aria-hidden="true">
          {[0, 1, 2, 3, 4].map((t) => (
            <i key={t} />
          ))}
        </div>
        <div className={s.bars}>
          {labels.map((label, i) => (
            <div
              key={label}
              className={s.group}
              onPointerEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              tabIndex={0}
              role="img"
              aria-label={`${label}: ${series.map((x) => `${x.label} ${fmt(x, x.values[i] ?? 0)}`).join(", ")}`}
            >
              {series.map((x) => {
                const v = x.values[i] ?? 0;
                return (
                  <span
                    key={x.key}
                    className={s.bar}
                    style={{
                      // 값이 0 이면 아예 그리지 않는다 — 빈칸과 0 은 다른 정보다
                      height: v > 0 ? `max(3px, ${(v / max) * 100}%)` : "0",
                      background: x.color,
                      opacity: hover === null || hover === i ? 1 : 0.32,
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
        {hover !== null && (
          <Tooltip index={hover} labels={labels} series={series} left={((hover + 0.5) / labels.length) * 100} />
        )}
      </div>

      <div className={s.axis}>
        {labels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <Legend series={series} />
      <figcaption id={`${id}-desc`} className="srOnly">
        {caption}
      </figcaption>
      <TableView labels={labels} series={series} caption={caption} />
    </figure>
  );
}

/* ── 꺾은선 ────────────────────────────────── */

export function LineChart({
  labels,
  series,
  height = 168,
  caption,
}: {
  labels: string[];
  series: Series[];
  height?: number;
  caption: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const values = series.flatMap((x) => x.values).filter((v) => Number.isFinite(v));
  const max = niceMax(Math.max(...values, 1));
  const inner = height - 18;
  const xAt = (i: number) => (labels.length === 1 ? 50 : (i / (labels.length - 1)) * 100);
  const yAt = (v: number) => height - (v / max) * inner;

  return (
    <figure className={s.figure}>
      <div className={s.plot} style={{ height }} onPointerLeave={() => setHover(null)}>
        <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className={s.svg} role="img" aria-label={caption}>
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <line
              key={t}
              x1="0"
              x2="100"
              y1={height - t * inner}
              y2={height - t * inner}
              className={s.grid}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {hover !== null && (
            <line
              x1={xAt(hover)}
              x2={xAt(hover)}
              y1="0"
              y2={height}
              className={s.crosshair}
              vectorEffect="non-scaling-stroke"
            />
          )}
          {series.map((x) => (
            <polyline
              key={x.key}
              className={s.line}
              points={x.values.map((v, i) => `${xAt(i)},${yAt(v)}`).join(" ")}
              stroke={x.color}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
        {/* 점은 종횡비가 왜곡되지 않도록 SVG 밖에서 그린다 */}
        {series.map((x) =>
          x.values.map((v, i) => (
            <span
              key={`${x.key}-${i}`}
              className={s.dot}
              style={{
                left: `${xAt(i)}%`,
                top: `${(yAt(v) / height) * 100}%`,
                background: x.color,
                opacity: hover === null || hover === i ? 1 : 0.4,
              }}
            />
          )),
        )}
        <div className={s.hits}>
          {labels.map((label, i) => (
            <button
              key={label}
              type="button"
              className={s.hit}
              aria-label={`${label}: ${series.map((x) => `${x.label} ${fmt(x, x.values[i] ?? 0)}`).join(", ")}`}
              onPointerEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
            />
          ))}
        </div>
        {hover !== null && (
          <Tooltip index={hover} labels={labels} series={series} left={((hover + 0.5) / labels.length) * 100} />
        )}
      </div>
      <div className={s.axis}>
        {labels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <Legend series={series} />
      <figcaption id={`${id}-desc`} className="srOnly">
        {caption}
      </figcaption>
      <TableView labels={labels} series={series} caption={caption} />
    </figure>
  );
}
