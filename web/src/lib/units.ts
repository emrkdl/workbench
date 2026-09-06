/**
 * 단위 규약 — backend/boardlens/units.py 와 짝을 이룬다.
 *
 * API가 주는 길이는 전부 정수 나노미터다. 화면에 찍기 직전에만 사람이 읽는 단위로
 * 바꾸고, 정렬·필터·비교에는 나노미터 원값을 그대로 쓴다.
 *
 * 화면에 찍는 길이는 **전부 mm 하나**다. 크기에 따라 µm 과 m 로 눈금을 옮기던 것도
 * 그만뒀다 — 같은 화면에서 75 µm 과 1.6 mm 와 83.70 m 가 섞여 있으면, 셋을 견주기
 * 전에 머릿속에서 자릿수를 맞추는 일이 먼저 필요하다. 그 환산을 사람에게 시키지 않는다.
 *
 * mil 도 걷어냈다. 한 화면에서 두 자를 오가면 숫자를 볼 때마다 어느 자로 잰 것인지
 * 확인해야 하고, 그 확인을 빠뜨린 비교가 조용히 틀린다.
 */

export const NM_PER_UM = 1_000;
export const NM_PER_MM = 1_000_000;

export const MDEG_PER_DEG = 1_000;


export const toMm = (nm: number) => nm / NM_PER_MM;
export const toUm = (nm: number) => nm / NM_PER_UM;
export const toDeg = (mdeg: number) => mdeg / MDEG_PER_DEG;

/** 길이 표시. 소수 3자리면 µm 해상도까지 담긴다. */
export function formatLength(nm: number): string {
  return `${toMm(nm).toFixed(3)} mm`;
}

/** 선폭·간격·피치처럼 작은 값. 소수 셋째 자리까지 두면 µm 해상도가 그대로 남는다. */
export function formatFine(nm: number): string {
  return `${toMm(nm).toFixed(3)} mm`;
}

/** 보드 치수처럼 큰 값. 소수 1자리면 충분하고 표가 훨씬 읽힌다. */
export function formatCoarse(nm: number): string {
  return `${toMm(nm).toFixed(1)} mm`;
}

/**
 * 배선 길이. 수만 mm 가 되어도 m 로 접지 않는다 — 접으면 옆줄의 mm 값과 자릿수를
 * 맞춰 보는 일이 생긴다. 대신 천 단위를 끊어 읽기를 돕는다.
 */
export function formatRouteLength(nm: number): string {
  return `${toMm(nm).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mm`;
}

/** "88.0 × 62.5 mm" — 단위는 한 번만 붙인다. */
export function formatDimensions(widthNm: number, heightNm: number): string {
  const n = (nm: number) => toMm(nm).toFixed(1);
  return `${n(widthNm)} × ${n(heightNm)} mm`;
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
