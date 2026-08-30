/**
 * 단위 규약 — backend/boardlens/units.py 와 짝을 이룬다.
 *
 * API가 주는 길이는 전부 정수 나노미터다. 화면에 찍기 직전에만 mm/mil 로 바꾸고,
 * 정렬·필터·비교에는 나노미터 원값을 그대로 쓴다.
 */

export const NM_PER_UM = 1_000;
export const NM_PER_MM = 1_000_000;
export const NM_PER_MIL = 25_400;

export const MDEG_PER_DEG = 1_000;

export type DisplayUnit = "mm" | "mil";

export const toMm = (nm: number) => nm / NM_PER_MM;
export const toMil = (nm: number) => nm / NM_PER_MIL;
export const toUm = (nm: number) => nm / NM_PER_UM;
export const toDeg = (mdeg: number) => mdeg / MDEG_PER_DEG;

/** 길이 표시. mm 는 소수 3자리(µm 해상도), mil 은 1자리. */
export function formatLength(nm: number, unit: DisplayUnit = "mm"): string {
  return unit === "mil" ? `${toMil(nm).toFixed(1)} mil` : `${toMm(nm).toFixed(3)} mm`;
}

/** 선폭·간격처럼 아주 작은 값. mm 로는 0.075 라 읽기 나쁘므로 µm 를 기본으로 쓴다. */
export function formatFine(nm: number, unit: DisplayUnit = "mm"): string {
  return unit === "mil" ? `${toMil(nm).toFixed(2)} mil` : `${Math.round(toUm(nm))} µm`;
}

/** 보드 치수처럼 큰 값. 소수 1자리면 충분하고 표가 훨씬 읽힌다. */
export function formatCoarse(nm: number, unit: DisplayUnit = "mm"): string {
  return unit === "mil" ? `${toMil(nm).toFixed(0)} mil` : `${toMm(nm).toFixed(1)} mm`;
}

/** 배선 길이. mm 단위가 수천이 되면 m 로 접는다. */
export function formatRouteLength(nm: number): string {
  const mm = toMm(nm);
  return mm >= 1000 ? `${(mm / 1000).toFixed(2)} m` : `${mm.toFixed(1)} mm`;
}

/** "88.0 × 62.5 mm" — 단위는 한 번만 붙인다. */
export function formatDimensions(widthNm: number, heightNm: number, unit: DisplayUnit = "mm"): string {
  const n = (nm: number) => (unit === "mil" ? toMil(nm).toFixed(0) : toMm(nm).toFixed(1));
  return `${n(widthNm)} × ${n(heightNm)} ${unit}`;
}

export const formatArea = (mm2: number) => `${mm2.toFixed(1)} mm²`;
export const formatAngle = (mdeg: number) => `${toDeg(mdeg).toFixed(0)}°`;

/** 천 단위 구분. 표 안에서 tabular-nums 와 함께 쓴다. */
export const formatCount = (n: number) => n.toLocaleString("en-US");

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
