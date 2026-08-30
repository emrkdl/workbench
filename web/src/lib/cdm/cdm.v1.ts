/**
 * Canonical Design Model v1
 *
 * 생성된 파일이다 — 직접 고치지 말 것.
 * 원본: cdm/schema/cdm.v1.json
 * 재생성: python cdm/codegen/generate.py
 */

/**
 * 적층 내 각 층의 물리적 역할.
 */
export type LayerRole = "signal" | "plane_power" | "plane_gnd" | "mixed" | "dielectric" | "mask" | "silk" | "paste";

export const LAYER_ROLE_VALUES = ["signal", "plane_power", "plane_gnd", "mixed", "dielectric", "mask", "silk", "paste"] as const;

/**
 * 부품이 실장된 면.
 */
export type Side = "top" | "bottom";

export const SIDE_VALUES = ["top", "bottom"] as const;

/**
 * 비아 종류. 블라인드/베리드/마이크로 유무가 제조 난이도와 단가를 크게 좌우한다.
 */
export type ViaKind = "through" | "blind" | "buried" | "micro";

export const VIA_KIND_VALUES = ["through", "blind", "buried", "micro"] as const;

/**
 * 홀 용도.
 */
export type DrillKind = "via" | "mounting" | "tooling" | "component";

export const DRILL_KIND_VALUES = ["via", "mounting", "tooling", "component"] as const;

/**
 * DRC 위반 및 인제스트 경고의 심각도.
 */
export type Severity = "error" | "warning" | "info";

export const SEVERITY_VALUES = ["error", "warning", "info"] as const;

/**
 * 원본 파일이 사용하던 단위. 변환 이력 추적 목적으로만 보존하며 연산에는 쓰지 않는다.
 */
export type SourceUnits = "nm" | "um" | "mm" | "mil" | "inch";

export const SOURCE_UNITS_VALUES = ["nm", "um", "mm", "mil", "inch"] as const;

/**
 * .blg 버퍼 안에서 종류별로 연속 배치되는 기하 객체의 분류.
 */
export type GeometryKind = "trace" | "pad" | "via" | "plane" | "text" | "outline";

export const GEOMETRY_KIND_VALUES = ["trace", "pad", "via", "plane", "text", "outline"] as const;

/**
 * 닫힌 폴리곤. 보드 외형과 컷아웃 표현에 쓴다.
 */
export interface Polygon {
  /** 평탄화된 좌표 배열 [x0, y0, x1, y1, ...]. 첫 점과 끝 점은 중복하지 않으며 암묵적으로 닫힌다. */
  points_nm: number[];
  /** true면 보드 내부에 뚫린 영역(컷아웃). */
  is_cutout: boolean;
}

/**
 * 축 정렬 경계 상자.
 */
export interface BBox {
  x0_nm: number;
  y0_nm: number;
  x1_nm: number;
  y1_nm: number;
}

/**
 * 설계의 신원과 물리적 외형. 카탈로그 목록에 보이는 대부분의 값이 여기서 나온다.
 */
export interface DesignHeader {
  /** 설계 계보 식별자. 리비전이 바뀌어도 유지된다. 파일명이 아니라 파일 헤더에서 추출한다. */
  board_key: string;
  /** 사람이 읽는 보드 이름. */
  board_name: string;
  /** Rev A, 1.2 등 원본 표기 그대로. */
  revision_label: string;
  /** 보드 자체의 사내 파트넘버. */
  part_number?: string | null;
  /** 소속 프로젝트. 권한 경계이기도 하다. */
  project_key?: string | null;
  /** 제품군. 카탈로그 파셋. */
  product_family?: string | null;
  /** 설계자. */
  author?: string | null;
  /** 설계 시점 ISO-8601 날짜. 업로드 시점과 구분된다. */
  designed_at?: string | null;
  /** 원본 CAD 툴 이름. */
  source_tool: string;
  /** 원본 CAD 툴 버전. 파싱 분기와 이슈 추적에 쓴다. */
  source_version: string;
  units_source: SourceUnits;
  /** 보드 외형. 이형 보드와 내부 컷아웃을 위해 다중 폴리곤. */
  outline: Polygon[];
  /** 보드 총 두께. */
  board_thickness_nm: number;
  /** ENIG, HASL, OSP 등 표면 처리. */
  surface_finish?: string | null;
  /** 리지드플렉스, 후동박, 임베디드 부품 등 특수 공정 태그. */
  special_processes?: string[] | null;
}

/**
 * 적층의 한 층. 도체층과 유전체층을 모두 포함하며 index 순서가 곧 물리 적층 순서다.
 */
export interface StackupLayer {
  /** 1부터 시작하는 물리 적층 순서. 1이 Top. */
  index: number;
  /** 정규화된 층 이름. */
  name: string;
  /** 원본 CAD의 층 이름. 원본 대조용으로 절대 버리지 않는다. */
  source_name: string;
  role: LayerRole;
  /** 층 두께. */
  thickness_nm: number;
  /** 재질명. FR-4, Megtron6 등. */
  material?: string | null;
  /** 유전 상수. 임피던스 검토에 필요. */
  dk?: number | null;
  /** 손실 계수. */
  df?: number | null;
  /** 동박 두께(µm). 후동박 여부 판별. */
  copper_weight_um?: number | null;
  /** 동박 면적률 0~1. 휨·열 검토와 제조사 문의에 자주 요구된다. */
  copper_area_ratio?: number | null;
  /** 설계 단일단 임피던스. */
  impedance_single_ohm?: number | null;
  /** 설계 차동 임피던스. */
  impedance_diff_ohm?: number | null;
  /** 이 층에 배선된 넷 수. 파생값이지만 층별 밀도 파악에 자주 쓰여 보관한다. */
  routed_net_count?: number | null;
}

/**
 * 부품의 핀 하나. 연결 정보는 여기 두지 않는다 — 회로 연결은 Net.pins 한 곳에서만 선언된다.
 */
export interface Pin {
  /** 핀 이름 또는 번호. 부품 내에서 유일. */
  name: string;
  /** 보드 좌표계 기준 절대 X. */
  x_nm: number;
  /** 보드 좌표계 기준 절대 Y. */
  y_nm: number;
  /** 패드가 놓인 층. 관통 핀은 null. */
  layer_index?: number | null;
  /** 패드 폭. */
  pad_width_nm?: number | null;
  /** 패드 높이. */
  pad_height_nm?: number | null;
}

/**
 * 배치된 부품 하나. refdes가 리비전 간 비교의 1차 매칭 키다.
 */
export interface Component {
  /** R12, U3 등. 리비전 내에서 유일해야 하며 중복 시 적재를 거부한다. */
  refdes: string;
  /** 제조사 파트넘버(MPN). 부품 역검색과 EOL 영향 분석의 핵심 필드. */
  part_number?: string | null;
  /** 제조사. */
  manufacturer?: string | null;
  /** 100nF, 10k 등 수동 소자 값. */
  value?: string | null;
  /** 0402, QFN48, BGA256 등 패키지 타입. */
  package: string;
  /** 부품 원점 X. */
  x_nm: number;
  /** 부품 원점 Y. */
  y_nm: number;
  /** 1/1000도 단위 반시계 회전. 0 이상 360000 미만. */
  rotation_mdeg: number;
  side: Side;
  /** 부품 높이. 기구 간섭 검토에 쓴다. */
  height_nm?: number | null;
  /** 핀 피치. BGA 최소 피치 집계에 쓴다. */
  pin_pitch_nm?: number | null;
  /** 이 부품의 핀 목록. */
  pins: Pin[];
}

/**
 * 넷에 연결된 핀 하나. 회로 연결의 원자 단위이며 넷리스트 Diff는 이 집합의 차집합이다.
 */
export interface NetPinRef {
  refdes: string;
  pin_name: string;
}

/**
 * 층별 배선 길이 내역.
 */
export interface LayerLength {
  layer_index: number;
  length_nm: number;
}

/**
 * 하나의 전기적 넷. name은 리비전 사이에서 바뀔 수 있으므로 signature가 실질적 동일성 판정을 맡는다.
 */
export interface Net {
  /** 넷 이름. Diff의 1차 매칭 키. */
  name: string;
  /** 정렬된 refdes.pin 집합의 해시. 이름이 바뀐 넷과 실제로 회로가 바뀐 넷을 구분하는 열쇠. 파서가 아니라 정규화 단계에서 채운다. */
  signature?: string | null;
  /** 전원, 차동, 고속 등 설계자가 부여한 분류. */
  net_class?: string | null;
  /** 차동쌍 상대 넷 이름. */
  diff_partner?: string | null;
  /** 연결된 핀 목록. 회로 연결이 선언되는 유일한 자리. */
  pins: NetPinRef[];
  /** 총 배선 길이. */
  length_nm: number;
  /** 층별 배선 길이 내역. */
  length_by_layer?: LayerLength[] | null;
  /** 이 넷이 사용하는 비아 수. */
  via_count: number;
  /** 공칭 선폭. */
  width_nm?: number | null;
  /** 미배선 여부. */
  unrouted: boolean;
}

/**
 * 동일 사양 비아의 집계. 개별 비아 위치는 기하 버퍼에 있고 여기에는 통계만 둔다.
 */
export interface ViaSpec {
  kind: ViaKind;
  from_layer: number;
  to_layer: number;
  /** 드릴 직경. */
  drill_nm: number;
  /** 패드 직경. */
  pad_nm: number;
  count: number;
}

/**
 * 드릴 표의 한 행. 제조 발주 시 그대로 쓰이는 정보.
 */
export interface DrillEntry {
  diameter_nm: number;
  /** 도금 홀(PTH) 여부. */
  plated: boolean;
  kind: DrillKind;
  count: number;
}

/**
 * 설계에 실제로 적용된 최소값들. 제조 가능성과 단가를 결정하며 카탈로그 파셋으로도 쓴다.
 */
export interface DesignRules {
  /** 최소 선폭. */
  min_trace_width_nm: number;
  /** 최소 간격. */
  min_clearance_nm: number;
  /** 최소 드릴 직경. */
  min_drill_nm: number;
  /** 최소 애뉼러 링. */
  min_annular_ring_nm?: number | null;
  /** 최대 종횡비(보드 두께 / 최소 드릴). */
  max_aspect_ratio?: number | null;
  /** BGA 최소 피치. 조립 난이도의 대표 지표. */
  min_bga_pitch_nm?: number | null;
}

/**
 * CAD 툴이 낸 DRC 결과 한 건. BoardLens는 DRC를 재실행하지 않고 결과를 표시만 한다.
 */
export interface DrcFinding {
  /** 위반한 룰 이름. */
  rule: string;
  severity: Severity;
  message: string;
  x_nm?: number | null;
  y_nm?: number | null;
  layer_index?: number | null;
  net_name?: string | null;
  refdes?: string | null;
}

/**
 * 층 하나의 기하 버퍼(.blg)를 가리키는 포인터. 실제 좌표 데이터는 DB에 들어가지 않고 blob 스토어에 있으며, 브라우저가 API를 거치지 않고 직접 받는다.
 */
export interface LayerGeometryRef {
  layer_index: number;
  /** blob 스토어 내 경로. */
  storage_key: string;
  object_count: number;
  /** gzip 압축 후 바이트 크기. */
  byte_size: number;
  bbox: BBox;
  /** 기하 종류별 객체 수. 키는 GeometryKind 값. */
  kind_counts: Record<string, number>;
}

/**
 * 인제스트 무결성 검사에서 나온 경고. 실패가 아니라 기록이며 리비전 상세에 표시된다. 실제 설계 데이터는 원래 조금씩 지저분하고, 그걸 이유로 적재를 거부하면 아무도
 * 시스템을 쓰지 않는다.
 */
export interface IngestWarning {
  /** component_outside_outline, orphan_net 등 기계 판독 가능한 코드. */
  code: string;
  severity: Severity;
  message: string;
  /** 동일 코드가 합쳐진 건수. */
  count: number;
}

/**
 * CDM 문서 루트. 입력 어댑터 하나가 파일 하나를 읽어 정확히 이 형태를 내놓는다.
 */
export interface Design {
  /** 이 문서가 따르는 CDM 버전. 재파싱 판정에 쓴다. */
  cdm_version: string;
  /** 생성한 어댑터 이름. hkp, mockgen 등. */
  parser_name?: string | null;
  /** 어댑터 버전. 상승하면 전체 재파싱 대상이 된다. */
  parser_version?: string | null;
  header: DesignHeader;
  stackup: StackupLayer[];
  components: Component[];
  nets: Net[];
  vias: ViaSpec[];
  drills: DrillEntry[];
  design_rules: DesignRules;
  drc_findings?: DrcFinding[] | null;
  layer_geometry?: LayerGeometryRef[] | null;
  warnings?: IngestWarning[] | null;
}

