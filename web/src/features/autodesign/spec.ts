/**
 * 자동 설계 요청서.
 *
 * 이 화면이 실제로 만들어 내는 것은 그림이 아니라 **엔진에 넘길 요청서**다. 배치·배선
 * 엔진은 따로 돌아가는 물건이고(사내 라우팅 엔진), 이 시스템이 할 일은 "무엇을, 어떤
 * 조건으로 맡길 것인가"를 사람이 빠뜨림 없이 적게 하는 것이다.
 *
 * 그래서 화면 상태를 그대로 이 형태로 두고, 마지막에 사람이 눈으로 확인할 수 있게
 * 보여준다. 나중에 엔진이 붙으면 이 값을 그대로 던지면 된다.
 */

export type PlaceSide = "keep" | "top" | "bottom";
export type PlaceRotation = "keep" | "free" | 0 | 90 | 180 | 270;

/** 대략적 위치 — 기판을 3×3 으로 나눈 칸. 좌표를 요구하면 사람이 답할 수 없다. */
export const REGIONS = [
  ["tl", "좌상"], ["tc", "상"], ["tr", "우상"],
  ["ml", "좌"], ["mc", "중앙"], ["mr", "우"],
  ["bl", "좌하"], ["bc", "하"], ["br", "우하"],
] as const;

export type RegionKey = (typeof REGIONS)[number][0];

export interface ComponentRule {
  side: PlaceSide;
  rotation: PlaceRotation;
  /** null 이면 자리를 엔진에 맡긴다. */
  region: RegionKey | null;
  /** 지금 자리에서 움직이지 말 것. 커넥터·안테나처럼 기구가 정한 자리에 쓴다. */
  lock: boolean;
}

export const DEFAULT_RULE: ComponentRule = { side: "keep", rotation: "keep", region: null, lock: false };

export type SourceKind = "upload" | "revision";

export interface Source {
  kind: SourceKind;
  /** 업로드일 때 파일 이름과 크기. */
  fileName?: string;
  byteSize?: number;
  /** 카탈로그에서 골랐을 때. */
  revisionId?: string;
  boardKey?: string;
  boardName?: string;
}

/**
 * 밀도 등급.
 *
 * 부품 간 간격을 µm 로 물으면 답할 수 있는 사람이 몇 없다 — 그 숫자는 설계자가 정하는
 * 값이 아니라 **어떤 제품인가**에서 따라 나온다. 그래서 제품의 성격을 고르게 하고 간격은
 * 엔진이 그 등급에서 끌어낸다. 옆에 적은 µm 는 참고값이지 입력이 아니다.
 */
export const DENSITIES = [
  ["normal", "노멀", "일반 기기. 검사와 리워크에 손이 들어갈 만큼 띄운다", "≈200 µm"],
  ["hdi", "초고밀도", "스마트폰급. 마이크로비아를 전제로 붙여 놓는다", "≈130 µm"],
  ["extreme", "극밀도", "빈 자리를 남기지 않는다. 리워크는 사실상 포기", "≈80 µm"],
  ["wearable", "웨어러블", "판이 작고 양면을 다 쓴다. 두께와 굽힘을 함께 본다", "≈100 µm"],
] as const;

export type Density = (typeof DENSITIES)[number][0];

export interface PlacementSpec {
  /** 전체를 다시 배치할지, 고른 것만 손댈지. */
  scope: "all" | "selected";
  refdes: string[];
  rules: Record<string, ComponentRule>;
  /** 이미 배치된 부품은 그대로 두고 빈 것만 채운다. */
  keepPlaced: boolean;
  /** 밀도 등급. 부품 간 간격은 엔진이 이 등급에서 끌어낸다. */
  density: Density;
}

/**
 * 과거 설계 참조.
 *
 * 배치에만 걸리는 조건이 아니라 작업 전체에 걸린다 — 배선도 "이 보드에서 쓰던 층 배분과
 * 비아 규격을 따라가라"를 참고할 수 있다. 그래서 배치 조건 안이 아니라 대상 옆에 둔다.
 */
export interface ReferenceSpec {
  enabled: boolean;
  revisionIds: string[];
}

/**
 * 폼팩터 — 보드 코드 가운데 토막이 그대로 판의 종류다(TTN-**MAIN**-A1).
 *
 * 메인보드와 플렉스는 같은 회사에서 나와도 다른 물건이다 — 크기도 층수도 배치 규칙도
 * 다르다. 참조할 판을 고를 때 서른 장을 한 줄로 늘어놓는 대신 먼저 종류로 좁히는 이유다.
 */
export const FORM_FACTORS: Record<string, string> = {
  MAIN: "메인 보드",
  PWR: "전원 보드",
  RF: "무선 모듈",
  IF: "인터페이스",
  SNS: "센서",
  DSP: "신호 처리",
  FLX: "플렉스",
};

export const formFactorOf = (boardKey: string) => boardKey.split("-")[1] ?? "";

export type RoutingEffort = "fast" | "balanced" | "thorough";
export type RoutingOrder = "auto" | "power_first" | "critical_first";

export interface RoutingSpec {
  scope: "all" | "classes";
  netClasses: string[];
  /** 배선에 쓸 도체층 번호. 비우면 엔진이 정한다. */
  layers: number[];
  viaKinds: string[];
  maxViasPerNet: number | null;
  keepRouted: boolean;
  diffPairs: boolean;
  lengthMatch: boolean;
  order: RoutingOrder;
  effort: RoutingEffort;
}

export interface AutoDesignSpec {
  source: Source | null;
  reference: ReferenceSpec;
  modes: { place: boolean; route: boolean };
  placement: PlacementSpec;
  routing: RoutingSpec;
  /** 파서가 붙기 전까지 부품 목록을 대신 읽어 올 리비전. 임시 발판이다. */
  previewRevisionId: string | null;
}

export const EMPTY_SPEC: AutoDesignSpec = {
  source: null,
  reference: { enabled: false, revisionIds: [] },
  previewRevisionId: null,
  // 둘 다 켠 상태가 기본이다. 배치와 배선을 따로 돌리는 것은 한쪽이 이미 끝났을 때뿐이고,
  // 새 판을 맡길 때는 둘 다 맡긴다.
  modes: { place: true, route: true },
  placement: {
    scope: "all",
    refdes: [],
    rules: {},
    keepPlaced: false,
    density: "normal",
  },
  routing: {
    scope: "all",
    netClasses: [],
    layers: [],
    viaKinds: ["through"],
    maxViasPerNet: null,
    keepRouted: true,
    diffPairs: true,
    lengthMatch: false,
    order: "auto",
    effort: "balanced",
  },
};

/** 엔진에 넘길 형태. 화면 상태에서 지금 모드에 해당하지 않는 부분을 덜어낸다. */
export function toRequest(spec: AutoDesignSpec) {
  const { source, reference, modes, placement, routing } = spec;
  return {
    source: source
      ? source.kind === "upload"
        ? { kind: "upload", file: source.fileName, bytes: source.byteSize }
        : { kind: "revision", revision_id: source.revisionId, board_key: source.boardKey }
      : null,
    tasks: [modes.place && "place", modes.route && "route"].filter(Boolean),
    reference: reference.enabled ? reference.revisionIds : null,
    placement: modes.place
      ? {
          scope: placement.scope,
          targets: placement.scope === "selected" ? placement.refdes : "all",
          rules: Object.fromEntries(
            Object.entries(placement.rules).filter(
              ([refdes, r]) =>
                (placement.scope === "all" || placement.refdes.includes(refdes)) &&
                (r.side !== "keep" || r.rotation !== "keep" || r.region !== null || r.lock),
            ),
          ),
          keep_placed: placement.keepPlaced,
          density: placement.density,
        }
      : null,
    routing: modes.route
      ? {
          scope: routing.scope,
          net_classes: routing.scope === "classes" ? routing.netClasses : "all",
          layers: routing.layers.length ? routing.layers : "auto",
          via_kinds: routing.viaKinds,
          max_vias_per_net: routing.maxViasPerNet,
          keep_routed: routing.keepRouted,
          diff_pairs: routing.diffPairs,
          length_match: routing.lengthMatch,
          order: routing.order,
          effort: routing.effort,
        }
      : null,
  };
}
