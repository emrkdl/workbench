import type { Board } from "@/lib/cdm";

/**
 * 유사 보드 찾기.
 *
 * "신규 설계를 시작하는데 비슷한 걸 전에 만든 적 있나"에 답한다. 축은 전부
 * revision.summary 의 사전 집계라 클라이언트에서 즉시 계산된다 — 그래서 가중치를
 * 슬라이더로 만질 수 있고, 설계자마다 무엇을 '비슷하다'고 볼지 다른 문제를 사람에게
 * 넘길 수 있다. 학습 모델이 아니라 가중 거리인 이유다.
 *
 * 각 축은 포트폴리오 안에서 0~1 로 정규화한다. 층수(2~12)와 부품 수(40~2600)를 그대로
 * 빼면 부품 수 하나가 점수를 통째로 삼킨다.
 */

export interface Axis {
  key: string;
  label: string;
  get: (b: Board) => number | null;
  /** 값이 몇 배씩 벌어지는 축은 로그로 본다. 100 → 200 과 2000 → 2100 은 다른 차이다. */
  log?: boolean;
}

export const AXES: Axis[] = [
  { key: "layers", label: "층수", get: (b) => b.summary.layer_count },
  { key: "area", label: "면적", get: (b) => b.summary.area_mm2, log: true },
  { key: "components", label: "부품 수", get: (b) => b.summary.component_count, log: true },
  { key: "density", label: "배치 밀도", get: (b) => b.summary.density_per_cm2 },
  { key: "trace", label: "최소 선폭", get: (b) => b.summary.min_trace_width_nm, log: true },
  { key: "pitch", label: "BGA 피치", get: (b) => b.summary.min_bga_pitch_nm ?? null },
];

export type Weights = Record<string, number>;

export const DEFAULT_WEIGHTS: Weights = {
  layers: 1,
  area: 1,
  components: 1,
  density: 0.6,
  trace: 0.8,
  pitch: 0.4,
};

export interface SimilarBoard {
  board: Board;
  score: number;
  /** 축별 차이 0~1. 무엇 때문에 비슷하고 무엇이 다른지 화면에서 보여준다. */
  gaps: { key: string; label: string; gap: number | null }[];
}

interface Range {
  min: number;
  max: number;
}

function ranges(boards: Board[]): Record<string, Range> {
  const out: Record<string, Range> = {};
  for (const axis of AXES) {
    const values = boards
      .map((b) => axis.get(b))
      .filter((v): v is number => v != null && Number.isFinite(v) && (!axis.log || v > 0))
      .map((v) => (axis.log ? Math.log10(v) : v));
    out[axis.key] = values.length ? { min: Math.min(...values), max: Math.max(...values) } : { min: 0, max: 1 };
  }
  return out;
}

export function findSimilar(boards: Board[], target: Board, weights: Weights, limit = 8): SimilarBoard[] {
  const span = ranges(boards);

  const normalized = (axis: Axis, b: Board): number | null => {
    const raw = axis.get(b);
    if (raw == null || !Number.isFinite(raw) || (axis.log && raw <= 0)) return null;
    const v = axis.log ? Math.log10(raw) : raw;
    const { min, max } = span[axis.key]!;
    return max > min ? (v - min) / (max - min) : 0;
  };

  const scored = boards
    .filter((b) => b.id !== target.id)
    .map((b) => {
      let sum = 0;
      let total = 0;
      const gaps = AXES.map((axis) => {
        const a = normalized(axis, target);
        const c = normalized(axis, b);
        const w = weights[axis.key] ?? 0;
        if (a == null || c == null || w === 0) return { key: axis.key, label: axis.label, gap: null };
        const gap = Math.abs(a - c);
        sum += gap * w;
        total += w;
        return { key: axis.key, label: axis.label, gap };
      });
      // 거리 0 이 100점. 축이 하나도 비교되지 않으면 순위에서 뺀다.
      const score = total > 0 ? Math.round((1 - sum / total) * 1000) / 10 : -1;
      return { board: b, score, gaps };
    })
    .filter((x) => x.score >= 0);

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
