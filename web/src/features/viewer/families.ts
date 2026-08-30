import type { ComponentRow } from "@/lib/cdm";
import { NM_PER_MM } from "@/lib/units";

/**
 * 패키지 외형 분류.
 *
 * 색을 "무엇으로 만들어졌는가"가 아니라 **"실장·검사에서 서로 다른 물건인가"** 로 가른다.
 * BGA 와 QFN 과 칩 수동은 배치도를 볼 때 눈이 먼저 찾는 구분이고, 사내 배치 도구
 * (auto_place)가 쓰는 기준과 같다 — 두 화면을 오가는 사람이 색을 다시 배우지 않아도 된다.
 *
 * 분류 수가 12 개라 색만으로는 구분이 완전하지 않다. 그래서 부품 위에 RefDes 를 직접
 * 쓰고, 범례에 개수를 함께 두고, 호버 시 이름을 띄운다 — 색은 훑어볼 때의 단서이고
 * 정확한 식별은 라벨이 맡는다.
 */

export type FamilyKey =
  | "bga"
  | "qfn"
  | "qfp"
  | "conn"
  | "xtal"
  | "ind"
  | "cap"
  | "res"
  | "diode"
  | "tr"
  | "test"
  | "other";

export interface Family {
  key: FamilyKey;
  label: string;
  /** 0~1 RGB. WebGL 로 바로 넘긴다. */
  rgb: [number, number, number];
}

export const FAMILIES: Family[] = [
  { key: "bga", label: "BGA / CSP", rgb: [0.39, 0.4, 0.95] },
  { key: "qfn", label: "QFN / LGA", rgb: [0.55, 0.36, 0.96] },
  { key: "qfp", label: "QFP / SOIC", rgb: [0.66, 0.55, 0.98] },
  { key: "conn", label: "커넥터", rgb: [0.93, 0.28, 0.6] },
  { key: "xtal", label: "크리스털", rgb: [0.98, 0.57, 0.24] },
  { key: "ind", label: "L / 페라이트", rgb: [0.98, 0.75, 0.14] },
  { key: "cap", label: "C 커패시터", rgb: [0.22, 0.74, 0.97] },
  { key: "res", label: "R 저항", rgb: [0.8, 0.83, 0.88] },
  { key: "diode", label: "D / LED", rgb: [0.96, 0.45, 0.71] },
  { key: "tr", label: "Q 트랜지스터", rgb: [0.64, 0.9, 0.21] },
  { key: "test", label: "테스트 포인트", rgb: [0.39, 0.45, 0.55] },
  { key: "other", label: "기타", rgb: [0.58, 0.64, 0.72] },
];

export const FAMILY_BY_KEY = new Map(FAMILIES.map((f) => [f.key, f]));

export const css = (rgb: [number, number, number]) =>
  `rgb(${Math.round(rgb[0] * 255)},${Math.round(rgb[1] * 255)},${Math.round(rgb[2] * 255)})`;

const REFDES_PREFIX = /^([A-Za-z]+)/;

export function familyOf(c: ComponentRow): FamilyKey {
  const pkg = c.package.toUpperCase();
  if (pkg.startsWith("CONN")) return "conn";
  if (pkg.includes("BGA") || pkg.includes("CSP")) return "bga";
  if (pkg.startsWith("QFN") || pkg.startsWith("DFN") || pkg.startsWith("LGA")) return "qfn";
  if (pkg.startsWith("LQFP") || pkg.startsWith("TQFP") || pkg.startsWith("SOIC") || pkg.startsWith("TSSOP")) {
    return "qfp";
  }
  if (pkg.startsWith("XTAL") || pkg.startsWith("OSC")) return "xtal";
  if (pkg.startsWith("TP-")) return "test";

  // 칩 부품은 패키지(0402 등)만으로는 C/R/L 이 갈리지 않는다. RefDes 접두어가 답이다.
  const prefix = (REFDES_PREFIX.exec(c.refdes)?.[1] ?? "").toUpperCase();
  switch (prefix) {
    case "C":
      return "cap";
    case "R":
      return "res";
    case "L":
    case "FB":
      return "ind";
    case "D":
    case "LED":
      return "diode";
    case "Q":
      return "tr";
    case "Y":
      return "xtal";
    case "J":
      return "conn";
    case "TP":
      return "test";
    case "U":
      return "qfp";
    default:
      return "other";
  }
}

/**
 * 회전을 반영한 몸통 크기.
 *
 * 파일에 몸통 크기가 없으면(파서가 아직 못 채우는 경우) 핀 피치와 핀 수로 어림한다.
 * 어림값이라는 것을 화면에서 구분할 방법은 없지만, 배치도가 통째로 비는 것보다는 낫다.
 */
export function bodySize(c: ComponentRow): [number, number] {
  let w = c.body_w_nm ?? 0;
  let h = c.body_h_nm ?? 0;
  if (!w || !h) {
    const pitch = c.pin_pitch_nm ?? 0;
    if (pitch && c.pin_count > 4) {
      const side = Math.ceil(Math.sqrt(c.pin_count));
      w = h = Math.round(side * pitch * 1.15);
    } else {
      w = NM_PER_MM;
      h = NM_PER_MM / 2;
    }
  }
  const quarter = Math.round(c.rotation_mdeg / 90_000) % 2;
  return quarter ? [h, w] : [w, h];
}
