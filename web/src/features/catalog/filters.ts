import type { Board } from "@/lib/cdm";
import { NM_PER_UM } from "@/lib/units";

/**
 * 카탈로그 필터.
 *
 * **거를 수 있는 것은 설계 파일에서 나온 값뿐이다.** 상태·설계자·CAD 툴·태그는 사람이
 * 손으로 유지해야 하는 값이라 시간이 지나면 틀리고, 틀린 값으로 거른 목록은 없는 보드를
 * 없다고 하고 있는 보드를 못 찾게 한다. 그래서 필터에서 뺐다.
 *
 * 값이 있어도 필터가 못 되는 것이 또 있다 — 여기 올라오는 것은 전부 **완성된 설계**라
 * 양면 실장·차동쌍은 사실상 전부 예이고 미배선·DRC 지적은 전부 아니오다. 30장을 세어
 * 보면 100% / 97% 한쪽으로 몰린다. 모두가 걸리는 조건은 필터가 아니다.
 *
 * 지금은 클라이언트가 보드를 전부 들고 걸러낸다. Phase 5에서는 같은 필드가 그대로 질의
 * 파라미터가 되어 서버로 넘어가고, 화면 쪽 코드는 바뀌지 않는다. 필터가 읽는 값은 전부
 * revision.summary 의 사전 집계라 원본 테이블을 건드리지 않는다.
 */
export interface CatalogFilters {
  q: string;
  families: string[];
  layers: number[];
  /** 등록 연도 범위. 쌓이는 자료라 "요즘 것"과 "옛날 것"을 가르는 축이 필요하다. */
  yearMin: number | null;
  yearMax: number | null;
  areaMin: number | null;
  areaMax: number | null;
  compMin: number | null;
  compMax: number | null;
  /** 이 값(µm) 이하의 최소 선폭을 가진 보드만. "미세 배선 보드 찾기"에 쓴다. */
  traceMaxUm: number | null;
}

export const EMPTY_FILTERS: CatalogFilters = {
  q: "",
  families: [],
  layers: [],
  yearMin: null,
  yearMax: null,
  areaMin: null,
  areaMax: null,
  compMin: null,
  compMax: null,
  traceMaxUm: null,
};

export type FacetKey = "families" | "layers" | "years";

export function activeFilterCount(f: CatalogFilters): number {
  return (
    (f.q ? 1 : 0) +
    f.families.length +
    f.layers.length +
    (f.yearMin !== null || f.yearMax !== null ? 1 : 0) +
    (f.areaMin !== null || f.areaMax !== null ? 1 : 0) +
    (f.compMin !== null || f.compMax !== null ? 1 : 0) +
    (f.traceMaxUm !== null ? 1 : 0)
  );
}

const inRange = (v: number, min: number | null, max: number | null) =>
  (min === null || v >= min) && (max === null || v <= max);

/** 등록 연도. 보드가 처음 들어온 시점이다. */
export const yearOf = (b: Board) => Number(b.created_at.slice(0, 4));

/**
 * `skip` 을 주면 그 차원의 조건만 빼고 판정한다. 파셋별 결과 수를 셀 때 쓴다 —
 * 이미 4층을 고른 상태에서도 8층이 몇 건인지 보여야 선택을 바꿀 수 있다.
 */
export function matches(b: Board, f: CatalogFilters, skip?: FacetKey): boolean {
  if (f.q) {
    const q = f.q.trim().toLowerCase();
    const hay = `${b.board_key} ${b.name} ${b.part_number ?? ""} ${b.product_family ?? ""}`;
    if (!hay.toLowerCase().includes(q)) return false;
  }
  if (skip !== "families" && f.families.length && !f.families.includes(b.product_family ?? "")) return false;
  if (skip !== "layers" && f.layers.length && !f.layers.includes(b.summary.layer_count)) return false;
  if (skip !== "years" && !inRange(yearOf(b), f.yearMin, f.yearMax)) return false;

  if (!inRange(b.summary.area_mm2, f.areaMin, f.areaMax)) return false;
  if (!inRange(b.summary.component_count, f.compMin, f.compMax)) return false;
  if (f.traceMaxUm !== null && b.summary.min_trace_width_nm > f.traceMaxUm * NM_PER_UM) return false;
  return true;
}

export const applyFilters = (boards: Board[], f: CatalogFilters) => boards.filter((b) => matches(b, f));

function tally(boards: Board[], pick: (b: Board) => string | string[] | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of boards) {
    const v = pick(b);
    for (const key of Array.isArray(v) ? v : [v]) {
      if (key) out[key] = (out[key] ?? 0) + 1;
    }
  }
  return out;
}

export interface LiveFacets {
  families: Record<string, number>;
  layers: Record<string, number>;
  /** 연도별 건수. 범위를 고를 때 어느 해가 비었는지 보여준다. */
  years: Record<string, number>;
}

/** 각 파셋의 현재 결과 수. 0인 선택지는 화면에서 비활성으로 보인다. */
export function liveFacets(boards: Board[], f: CatalogFilters): LiveFacets {
  const within = (skip: FacetKey) => boards.filter((b) => matches(b, f, skip));
  return {
    families: tally(within("families"), (b) => b.product_family ?? undefined),
    layers: tally(within("layers"), (b) => String(b.summary.layer_count)),
    years: tally(within("years"), (b) => String(yearOf(b))),
  };
}

/* ── 정렬 ─────────────────────────────────── */

export type SortKey = "updated" | "name" | "components" | "area" | "layers";

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "updated", label: "최근 갱신순" },
  { value: "name", label: "보드 코드순" },
  { value: "components", label: "부품 수순" },
  { value: "area", label: "면적순" },
  { value: "layers", label: "층수순" },
];

const COMPARATORS: Record<SortKey, (a: Board, b: Board) => number> = {
  updated: (a, b) => b.updated_at.localeCompare(a.updated_at),
  name: (a, b) => a.board_key.localeCompare(b.board_key),
  components: (a, b) => b.summary.component_count - a.summary.component_count,
  area: (a, b) => b.summary.area_mm2 - a.summary.area_mm2,
  layers: (a, b) => b.summary.layer_count - a.summary.layer_count,
};

export const sortBoards = (boards: Board[], key: SortKey) => [...boards].sort(COMPARATORS[key]);
