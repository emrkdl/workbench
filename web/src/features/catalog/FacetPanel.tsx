import { activeFilterCount, EMPTY_FILTERS, type CatalogFilters, type LiveFacets } from "./filters";
import s from "./catalog.module.css";

interface Props {
  filters: CatalogFilters;
  facets: LiveFacets;
  onChange: (next: CatalogFilters) => void;
}

/** 다중 선택 목록 하나. 결과가 0건인 선택지는 눌러도 소용없으므로 비활성으로 둔다. */
function CheckGroup({
  label,
  counts,
  selected,
  onToggle,
  format,
}: {
  label: string;
  counts: Record<string, number>;
  selected: string[];
  onToggle: (value: string) => void;
  format?: (value: string) => string;
}) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const all = [...new Set([...entries.map(([k]) => k), ...selected])];
  if (!all.length) return null;

  return (
    <div className={s.group}>
      <span className={s.groupLabel}>{label}</span>
      {all.map((key) => {
        const count = counts[key] ?? 0;
        const checked = selected.includes(key);
        const disabled = count === 0 && !checked;
        return (
          <label key={key} className={`${s.option} ${disabled ? s.optionDisabled : ""}`}>
            <input type="checkbox" checked={checked} disabled={disabled} onChange={() => onToggle(key)} />
            <span className={s.optionLabel}>{format ? format(key) : key}</span>
            <span className={s.optionCount}>{count}</span>
          </label>
        );
      })}
    </div>
  );
}

function RangeGroup({
  label,
  unit,
  min,
  max,
  onChange,
}: {
  label: string;
  unit: string;
  min: number | null;
  max: number | null;
  onChange: (min: number | null, max: number | null) => void;
}) {
  const parse = (v: string) => (v.trim() === "" ? null : Number(v));
  return (
    <div className={s.group}>
      {/* 단위는 제목 옆에 붙인다. 입력칸 아래에 홀로 두면 무엇의 단위인지 한 번 더
          짚어야 하고, 줄도 하나 더 먹는다. */}
      <span className={s.groupLabel}>
        {label}
        <span className={s.groupUnit}>{unit}</span>
      </span>
      <div className={s.range}>
        <input
          className={s.rangeInput}
          type="number"
          inputMode="numeric"
          placeholder="최소"
          aria-label={`${label} 최소`}
          value={min ?? ""}
          onChange={(e) => onChange(parse(e.target.value), max)}
        />
        <span className={s.rangeSep}>–</span>
        <input
          className={s.rangeInput}
          type="number"
          inputMode="numeric"
          placeholder="최대"
          aria-label={`${label} 최대`}
          value={max ?? ""}
          onChange={(e) => onChange(min, parse(e.target.value))}
        />
      </div>
    </div>
  );
}

/**
 * 등록 연도 — 한 해씩 누르면 그 해만, 두 해를 누르면 그 사이가 잡힌다.
 *
 * 자료가 해마다 쌓이므로 연도는 언젠가 스무 개가 넘는다. 그래서 체크박스 목록이 아니라
 * 막대로 둔다 — 어느 해에 몇 장이 있는지가 같이 보여야 "그 무렵 것"을 짚을 수 있다.
 */
function YearGroup({
  counts,
  min,
  max,
  onChange,
}: {
  counts: Record<string, number>;
  min: number | null;
  max: number | null;
  onChange: (min: number | null, max: number | null) => void;
}) {
  const years = Object.keys(counts).map(Number).sort((a, b) => a - b);
  if (years.length < 2) return null;
  const peak = Math.max(...Object.values(counts), 1);
  const lo = years[0]!;
  const hi = years[years.length - 1]!;

  const click = (y: number) => {
    // 한 번 누르면 그 해만. 이미 고른 것이 있으면 그 사이를 잡는다.
    if (min === y && max === y) onChange(null, null);
    else if (min !== null && max !== null && min === max) onChange(Math.min(min, y), Math.max(min, y));
    else onChange(y, y);
  };

  return (
    <div className={s.group}>
      <span className={s.groupLabel}>등록 시기</span>
      <div className={s.years}>
        {Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).map((y) => {
          const n = counts[String(y)] ?? 0;
          const on = min !== null && max !== null && y >= min && y <= max;
          return (
            <button
              key={y}
              type="button"
              className={`${s.year} ${on ? s.yearOn : ""}`}
              aria-pressed={on}
              title={`${y}년 ${n}건`}
              onClick={() => click(y)}
            >
              <i className={s.yearBar} style={{ height: `${Math.max((n / peak) * 26, 2)}px` }} />
              <span className={s.yearLabel}>{String(y).slice(2)}</span>
            </button>
          );
        })}
      </div>
      {/* 고른 기간만 적는다. 고르기 전의 안내("연도를 눌러 고르세요")는 뺐다 — 막대
          위에 마우스를 올려 보면 알게 되는 것을 늘 한 줄로 붙들고 있을 이유가 없다. */}
      {min !== null && max !== null && <span className={s.rangeHint}>{`${min}–${max}년`}</span>}
    </div>
  );
}

export function FacetPanel({ filters, facets, onChange }: Props) {
  const toggle = <K extends keyof CatalogFilters>(key: K, value: string) => {
    const current = filters[key] as unknown as string[];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    onChange({ ...filters, [key]: next });
  };

  const layerOptions = Object.keys(facets.layers)
    .map(Number)
    .sort((a, b) => a - b);
  const allLayers = [...new Set([...layerOptions, ...filters.layers])].sort((a, b) => a - b);

  const active = activeFilterCount(filters);

  return (
    <aside className={s.facets} aria-label="필터">
      <div className={s.facetHead}>
        <span className={s.facetHeadLabel}>필터 {active > 0 && `· ${active}`}</span>
        <button type="button" className={s.reset} disabled={active === 0} onClick={() => onChange(EMPTY_FILTERS)}>
          모두 해제
        </button>
      </div>

      <div className={s.group}>
        <span className={s.groupLabel}>층수</span>
        <div className={s.chips}>
          {allLayers.map((n) => {
            const count = facets.layers[String(n)] ?? 0;
            const on = filters.layers.includes(n);
            return (
              <button
                key={n}
                type="button"
                className={`${s.chip} ${on ? s.chipOn : ""}`}
                disabled={count === 0 && !on}
                aria-pressed={on}
                title={`${count}건`}
                onClick={() =>
                  onChange({
                    ...filters,
                    layers: on ? filters.layers.filter((v) => v !== n) : [...filters.layers, n],
                  })
                }
              >
                {n}층
              </button>
            );
          })}
        </div>
      </div>

      <CheckGroup label="제품군" counts={facets.families} selected={filters.families} onToggle={(v) => toggle("families", v)} />

      <YearGroup
        counts={facets.years}
        min={filters.yearMin}
        max={filters.yearMax}
        onChange={(yearMin, yearMax) => onChange({ ...filters, yearMin, yearMax })}
      />

      <RangeGroup
        label="보드 면적"
        unit="mm²"
        min={filters.areaMin}
        max={filters.areaMax}
        onChange={(areaMin, areaMax) => onChange({ ...filters, areaMin, areaMax })}
      />
      <RangeGroup
        label="부품 수"
        unit="개"
        min={filters.compMin}
        max={filters.compMax}
        onChange={(compMin, compMax) => onChange({ ...filters, compMin, compMax })}
      />

      <div className={s.group}>
        <span className={s.groupLabel}>최소 선폭</span>
        <div className={s.chips}>
          {[60, 75, 90, 120].map((um) => {
            const on = filters.traceMaxUm === um;
            return (
              <button
                key={um}
                type="button"
                className={`${s.chip} ${on ? s.chipOn : ""}`}
                aria-pressed={on}
                onClick={() => onChange({ ...filters, traceMaxUm: on ? null : um })}
              >
                ≤ {um} µm
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
