import type { LifecycleStatus } from "@/lib/cdm";
import { statusLabel } from "@/components/ui";
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
      <span className={s.groupLabel}>{label}</span>
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
      <span className={s.rangeHint}>{unit}</span>
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

      <CheckGroup
        label="상태"
        counts={facets.statuses}
        selected={filters.statuses}
        onToggle={(v) => toggle("statuses", v)}
        format={(v) => statusLabel(v as LifecycleStatus)}
      />
      <CheckGroup label="제품군" counts={facets.families} selected={filters.families} onToggle={(v) => toggle("families", v)} />
      <CheckGroup label="설계자" counts={facets.owners} selected={filters.owners} onToggle={(v) => toggle("owners", v)} />
      <CheckGroup label="CAD 툴" counts={facets.tools} selected={filters.tools} onToggle={(v) => toggle("tools", v)} />
      <CheckGroup label="태그" counts={facets.tags} selected={filters.tags} onToggle={(v) => toggle("tags", v)} />

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
        <span className={s.rangeHint}>선폭이 좁을수록 제조 난이도가 올라간다</span>
      </div>
    </aside>
  );
}
