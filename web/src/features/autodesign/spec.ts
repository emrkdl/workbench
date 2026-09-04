/**
 * 자동 레이아웃 요청서.
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

/**
 * 대략적 위치 — 보드 외곽선 위에 찍은 한 점(정수 나노미터).
 *
 * 3×3 칸으로 고르던 것을 실제 판 위의 점으로 바꿨다. "좌상"이 어디인지는 이형 보드에서
 * 사람마다 다르게 읽히지만 판 그림 위의 점은 다르게 읽힐 여지가 없다. 정확한 좌표를
 * 요구하는 것이 아니다 — 엔진은 이 점 근처에서 자리를 찾는다.
 */
export interface Position {
  x: number;
  y: number;
}

export interface ComponentRule {
  side: PlaceSide;
  rotation: PlaceRotation;
  /** null 이면 자리를 엔진에 맡긴다. */
  position: Position | null;
  /** 지금 자리에서 움직이지 말 것. 커넥터·안테나처럼 기구가 정한 자리에 쓴다. */
  lock: boolean;
}

export const DEFAULT_RULE: ComponentRule = { side: "keep", rotation: "keep", position: null, lock: false };

export interface SourceFile {
  name: string;
  byteSize: number;
}

/**
 * 무엇을 맡길 것인가.
 *
 * 파일은 여러 개 올릴 수 있다. 판 하나가 파일 하나로 끝나는 경우는 드물고 — 배치본과
 * 넷리스트, 세대별 파일이 따로 오는 일이 흔하다 — 하나만 받으면 사람이 어느 것을 올려야
 * 할지 고르다가 잘못 고른다.
 *
 * 모델명은 파일 안에 적혀 있다. 파일 이름은 사람이 바꿔 붙이지만 파일 속의 모델명은
 * 그렇지 않으므로, 정말로 무엇을 맡기는지는 그쪽이 말한다. 파서가 붙기 전까지는 자리만
 * 잡아 두고 임시 값을 채운다.
 */
export interface Source {
  files: SourceFile[];
  model: string | null;
}

export const EMPTY_SOURCE: Source = { files: [], model: null };

/** 파서가 붙기 전까지 쓰는 임시 모델명. 파일을 열어 읽는 순간 이 상수는 사라진다. */
export const PLACEHOLDER_MODEL = "TTN-MAIN-A3";

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
  maxViasPerNet: number | null;
  keepRouted: boolean;
  diffPairs: boolean;
  lengthMatch: boolean;
  order: RoutingOrder;
  effort: RoutingEffort;
}

export interface AutoDesignSpec {
  source: Source;
  reference: ReferenceSpec;
  modes: { place: boolean; route: boolean };
  placement: PlacementSpec;
  routing: RoutingSpec;
  /** 파서가 붙기 전까지 부품 목록을 대신 읽어 올 리비전. 임시 발판이다. */
  previewRevisionId: string | null;
}

export const EMPTY_SPEC: AutoDesignSpec = {
  source: EMPTY_SOURCE,
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
    source: source.files.length
      ? { model: source.model, files: source.files.map((f) => ({ name: f.name, bytes: f.byteSize })) }
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
                (r.side !== "keep" || r.rotation !== "keep" || r.position !== null || r.lock),
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
