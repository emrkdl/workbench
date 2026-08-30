import type { LayerRole, StackupLayer } from "@/lib/cdm";

/**
 * 층 역할별 색과 라벨.
 *
 * 도체층(신호/전원/GND)만 강한 색을 갖고 유전체·마스크·실크는 배경에 가깝게 둔다.
 * 단면도에서 "전기적으로 의미 있는 층"이 먼저 눈에 들어와야 하기 때문이다.
 */
export const ROLE_LABEL: Record<LayerRole, string> = {
  signal: "신호",
  plane_power: "전원 플레인",
  plane_gnd: "GND 플레인",
  mixed: "혼합",
  dielectric: "유전체",
  mask: "솔더마스크",
  silk: "실크",
  paste: "솔더페이스트",
};

export const ROLE_COLOR: Record<LayerRole, string> = {
  signal: "var(--info)",
  plane_power: "var(--accent)",
  plane_gnd: "var(--ink-3)",
  mixed: "var(--warn)",
  dielectric: "var(--surface-3)",
  mask: "var(--ok)",
  silk: "var(--line-2)",
  paste: "var(--line-2)",
};

/** 배경이 진한 층 위에는 흰 글씨가 필요하다. */
export const ROLE_ON_DARK: Record<LayerRole, boolean> = {
  signal: true,
  plane_power: true,
  plane_gnd: true,
  mixed: true,
  dielectric: false,
  mask: true,
  silk: false,
  paste: false,
};

export const CONDUCTOR_ROLES: LayerRole[] = ["signal", "plane_power", "plane_gnd", "mixed"];

export const isConductor = (l: StackupLayer) => CONDUCTOR_ROLES.includes(l.role);

/** 도체층에만 L1, L2… 번호를 매긴다. 사용자가 "3층"이라고 할 때 뜻하는 것이 이쪽이다. */
export function conductorNumbers(stackup: StackupLayer[]): Map<number, number> {
  const map = new Map<number, number>();
  let n = 0;
  for (const l of stackup) {
    if (isConductor(l)) map.set(l.index, ++n);
  }
  return map;
}
