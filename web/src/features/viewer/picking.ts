import type { LayerBuffers } from "./blg";
import { NO_NET } from "./blg";

/**
 * 클릭·호버 히트 테스트.
 *
 * 설계 문서는 Flatbush R-tree 를 적었지만, 현재 규모(보드당 2만 객체 안팎)에서는 선형
 * 주사가 인덱스를 만드는 것보다 빠르다 — 전 객체를 한 번 훑어도 1 ms 를 넘지 않는다.
 * 문서의 20만 객체 목표에 실제로 도달하면 그때 균등 격자나 R-tree 를 넣는다.
 * 지금 쓰지도 않을 인덱스를 만들어 두는 쪽이 더 나쁜 선택이다.
 */

export type HitKind = "pad" | "via" | "trace" | "plane";

export interface Hit {
  layerIndex: number;
  kind: HitKind;
  netId: number | null;
  x: number;
  y: number;
  /** 배선일 때의 폭 (nm). */
  width?: number;
}

const distanceToSegment = (px: number, py: number, x0: number, y0: number, x1: number, y1: number): number => {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2));
  const qx = x0 + t * dx;
  const qy = y0 + t * dy;
  return Math.hypot(px - qx, py - qy);
};

const netOrNull = (raw: number | undefined) => (raw === undefined || raw === NO_NET ? null : raw);

/**
 * 보드 좌표 (x, y) 에서 `tolerance` nm 안에 있는 것 중 가장 가까운 하나.
 * 위에 그려지는 것(비아 > 패드 > 배선 > 플레인)을 먼저 집는다.
 */
export function pick(
  layers: { index: number; buffers: LayerBuffers }[],
  x: number,
  y: number,
  tolerance: number,
): Hit | null {
  let best: Hit | null = null;
  let bestScore = Infinity;

  const consider = (hit: Hit, distance: number, priority: number) => {
    const score = distance + priority * tolerance;
    if (score < bestScore) {
      bestScore = score;
      best = hit;
    }
  };

  for (const { index, buffers } of layers) {
    const { vias, viaNets, pads, padNets, traces, traceWidths, traceNets } = buffers;

    for (let i = 0; i < vias.length / 3; i += 1) {
      const cx = vias[i * 3]!;
      const cy = vias[i * 3 + 1]!;
      const r = vias[i * 3 + 2]! / 2;
      const d = Math.hypot(x - cx, y - cy);
      if (d <= r + tolerance) {
        consider({ layerIndex: index, kind: "via", netId: netOrNull(viaNets[i]), x: cx, y: cy }, d, 0);
      }
    }

    for (let i = 0; i < pads.length / 4; i += 1) {
      const cx = pads[i * 4]!;
      const cy = pads[i * 4 + 1]!;
      const hw = pads[i * 4 + 2]! / 2;
      const hh = pads[i * 4 + 3]! / 2;
      const dx = Math.max(Math.abs(x - cx) - hw, 0);
      const dy = Math.max(Math.abs(y - cy) - hh, 0);
      const d = Math.hypot(dx, dy);
      if (d <= tolerance) {
        consider({ layerIndex: index, kind: "pad", netId: netOrNull(padNets[i]), x: cx, y: cy }, d, 1);
      }
    }

    for (let i = 0; i < traces.length / 4; i += 1) {
      const x0 = traces[i * 4]!;
      const y0 = traces[i * 4 + 1]!;
      const x1 = traces[i * 4 + 2]!;
      const y1 = traces[i * 4 + 3]!;
      const half = (traceWidths[i] ?? 0) / 2;
      const d = distanceToSegment(x, y, x0, y0, x1, y1) - half;
      if (d <= tolerance) {
        consider(
          {
            layerIndex: index,
            kind: "trace",
            netId: netOrNull(traceNets[i]),
            x: (x0 + x1) / 2,
            y: (y0 + y1) / 2,
            width: traceWidths[i],
          },
          Math.max(d, 0),
          2,
        );
      }
    }
  }

  return best;
}

export interface ComponentPoint {
  refdes: string;
  x: number;
  y: number;
  side: string;
  package: string;
  partNumber?: string | null;
  /** 회전을 반영한 몸통 크기. 있으면 몸통 안쪽을 눌렀는지로 판정한다. */
  w?: number;
  h?: number;
}

/** 클릭 지점에서 가장 가까운 부품. 뷰어와 부품 표가 같은 좌표를 쓰므로 그대로 맞물린다. */
export function pickComponent(components: ComponentPoint[], x: number, y: number, tolerance: number): ComponentPoint | null {
  let best: ComponentPoint | null = null;
  let bestDistance = tolerance;
  for (const c of components) {
    const d = Math.hypot(x - c.x, y - c.y);
    if (d < bestDistance) {
      bestDistance = d;
      best = c;
    }
  }
  return best;
}

/**
 * 몸통 안쪽을 눌렀는지로 고른다. 배치도에서는 이쪽이 맞다 — 큰 BGA 위를 눌렀는데
 * 중심이 더 가깝다는 이유로 옆의 0402 가 잡히면 쓸 수 없다.
 * 겹치는 것이 있으면 작은 쪽을 집는다. 큰 부품 위에 얹힌 작은 것을 고를 수 있어야 한다.
 */
export function pickComponentBody(
  components: ComponentPoint[],
  x: number,
  y: number,
  slack: number,
): ComponentPoint | null {
  let best: ComponentPoint | null = null;
  let bestArea = Infinity;
  for (const c of components) {
    const hw = (c.w ?? 0) / 2 + slack;
    const hh = (c.h ?? 0) / 2 + slack;
    if (hw <= slack && hh <= slack) continue;
    if (Math.abs(x - c.x) > hw || Math.abs(y - c.y) > hh) continue;
    const area = hw * hh;
    if (area < bestArea) {
      bestArea = area;
      best = c;
    }
  }
  return best;
}
