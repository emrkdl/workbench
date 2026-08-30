/**
 * BoardLens API v1
 *
 * 생성된 파일이다 — 직접 고치지 말 것.
 * 원본: cdm/schema/api.v1.json
 * 재생성: python cdm/codegen/generate.py
 */

import type { DesignRules, DrcFinding, DrillEntry, IngestWarning, LayerGeometryRef, Polygon, StackupLayer, ViaSpec } from "./cdm.v1";

/**
 * 리비전의 승인 단계. 보드의 상태는 최신 리비전의 상태로 파생된다.
 */
export type LifecycleStatus = "draft" | "review" | "released" | "obsolete";

export const LIFECYCLE_STATUS_VALUES = ["draft", "review", "released", "obsolete"] as const;

/**
 * 인제스트 상태 머신의 현재 위치. ready가 아니면 열람할 수 없다.
 */
export type IngestState = "uploaded" | "parsing" | "normalizing" | "indexing" | "ready" | "failed";

export const INGEST_STATE_VALUES = ["uploaded", "parsing", "normalizing", "indexing", "ready", "failed"] as const;

/**
 * 프로젝트 보안 등급. 다운로드 허용 여부와 워터마크 강도를 좌우한다.
 */
export type SecurityLevel = "internal" | "confidential" | "restricted";

export const SECURITY_LEVEL_VALUES = ["internal", "confidential", "restricted"] as const;

/**
 * 보드 외형 분류. 이형 보드는 제조 단가와 패널화 효율이 달라진다.
 */
export type OutlineKind = "rectangular" | "shaped";

export const OUTLINE_KIND_VALUES = ["rectangular", "shaped"] as const;

/**
 * 권한 부여의 기본 경계.
 */
export interface Project {
  id: string;
  /** URL과 필터에 쓰는 짧은 식별자. */
  key: string;
  name: string;
  security_level: SecurityLevel;
}

/**
 * 업로드된 원본 파일. 불변이며 sha256으로 주소 지정한다.
 */
export interface DesignFileRef {
  id: string;
  filename: string;
  sha256: string;
  byte_size: number;
  /** ISO-8601. */
  uploaded_at: string;
  uploaded_by: string;
  storage_key: string;
  /** design, gerber, bom, assembly, drc_report 등. */
  kind?: string | null;
}

/**
 * 인제스트 시점에 계산해 리비전 행에 박아두는 사전 집계. 카탈로그 파셋과 Overview 화면은 전부 여기만 읽는다 — 사용자가 슬라이더를 움직일 때마다 2,000만
 * 행을 집계하지 않기 위해서다.
 */
export interface RevisionSummary {
  /** 총 도체층 수. */
  layer_count: number;
  signal_layer_count: number;
  plane_layer_count: number;
  /** 외형 경계 상자 폭. */
  width_nm: number;
  /** 외형 경계 상자 높이. */
  height_nm: number;
  /** 실제 폴리곤 면적(컷아웃 제외). 경계 상자 면적과 다르다. */
  area_mm2: number;
  outline_kind: OutlineKind;
  cutout_count: number;
  board_thickness_nm: number;
  component_count: number;
  component_top_count: number;
  component_bottom_count: number;
  pin_count: number;
  bga_count: number;
  /** BGA가 없으면 null. */
  min_bga_pitch_nm?: number | null;
  /** 패키지 타입별 부품 수. */
  package_counts: Record<string, number>;
  /** 부품 배치 밀도. */
  density_per_cm2: number;
  net_count: number;
  total_route_length_nm: number;
  diff_pair_count: number;
  unrouted_count: number;
  power_net_count: number;
  via_total: number;
  /** 비아 종류별 수. 키는 CDM의 ViaKind 값. */
  via_by_kind: Record<string, number>;
  /** 드릴 총 수. */
  hole_count: number;
  min_trace_width_nm: number;
  min_clearance_nm: number;
  min_drill_nm: number;
  max_aspect_ratio?: number | null;
  drc_error_count: number;
  drc_warning_count: number;
  /** 인제스트 무결성 경고 건수. */
  warning_count: number;
  /** 밀도·층수·핀 수·최소 선폭을 합성한 0~100 지표. 보드 간 난이도 비교용. */
  complexity_score: number;
}

/**
 * 리비전 계보 트리와 비교 대상 선택에 쓰는 가벼운 참조.
 */
export interface RevisionRef {
  id: string;
  label: string;
  status: LifecycleStatus;
  created_at: string;
  parent_revision_id?: string | null;
  author?: string | null;
  /** 변경 사유 한 줄. */
  note?: string | null;
}

/**
 * 특정 시점의 설계 스냅샷. 열람과 비교의 단위이며 실제 데이터는 전부 여기 매달린다.
 */
export interface Revision {
  id: string;
  board_id: string;
  board_key: string;
  /** 보드의 사람이 읽는 이름. 계보 전체에 공통이지만 상세 화면이 매번 보드를 따로 조회하지 않도록 함께 싣는다. */
  board_name: string;
  label: string;
  parent_revision_id?: string | null;
  status: LifecycleStatus;
  ingest_state: IngestState;
  /** failed 상태일 때의 원인과 원본 라인 번호. */
  ingest_error?: string | null;
  author?: string | null;
  designed_at?: string | null;
  /** 업로드 시점. */
  created_at: string;
  note?: string | null;
  source_tool: string;
  source_version: string;
  parser_version?: string | null;
  thumbnail_url?: string | null;
  summary: RevisionSummary;
}

/**
 * 부품 테이블의 한 행. CDM Component에서 핀 배열을 뺀 형태로, 2,000행 가상 스크롤에 맞춰 가볍게 유지한다.
 */
export interface ComponentRow {
  refdes: string;
  part_number?: string | null;
  manufacturer?: string | null;
  value?: string | null;
  package: string;
  x_nm: number;
  y_nm: number;
  rotation_mdeg: number;
  /** top 또는 bottom. */
  side: string;
  pin_count: number;
  pin_pitch_nm?: number | null;
  /** 몸통 가로. 배치도가 그리는 사각형의 크기. */
  body_w_nm?: number | null;
  /** 몸통 세로. */
  body_h_nm?: number | null;
}

/**
 * 설계 계보. 리비전이 바뀌어도 유지되는 논리적 정체성.
 */
export interface Board {
  id: string;
  project_key: string;
  /** URL 식별자. */
  board_key: string;
  name: string;
  part_number?: string | null;
  product_family?: string | null;
  owner?: string | null;
  status: LifecycleStatus;
  /** 최신 리비전의 CAD 툴. 카탈로그 파셋이라 보드 행에 비정규화해 둔다. */
  source_tool: string;
  tags: string[];
  revision_count: number;
  latest_revision_id: string;
  latest_revision_label: string;
  created_at: string;
  updated_at: string;
  thumbnail_url?: string | null;
  /**
   * 최신 리비전의 외형 폴리곤. 카탈로그 카드가 보드 생김새를 바로 보여줄 수 있게 목록 응답에 함께 싣는다 — 폴리곤 하나에 좌표 몇 개뿐이라 비용이 거의
   * 없다.
   */
  outline?: Polygon[] | null;
  /**
   * 카드 그림에 쓰는 대표 부품 — 몸통이 큰 순으로 몇십 개. 부품 전체를 목록 응답에 실으면 보드 30장에 4 MB 가 넘고, 카드 크기(86px)에서는
   * 어차피 큰 IC 와 커넥터만 형태로 읽힌다. 전체 배치는 뷰어에서 본다.
   */
  landmarks?: ComponentRow[] | null;
  /** 최신 리비전의 요약. 카탈로그 목록과 파셋 필터가 읽는 값. */
  summary: RevisionSummary;
}

/**
 * 숫자 파셋의 현재 데이터 범위. 슬라이더 경계를 서버가 알려준다.
 */
export interface RangeFacet {
  min: number;
  max: number;
}

/**
 * 현재 필터 조건에서 가능한 선택지와 각 선택지의 결과 수. 값이 0인 선택지는 UI에서 비활성으로 보인다.
 */
export interface CatalogFacets {
  product_family: Record<string, number>;
  status: Record<string, number>;
  owner: Record<string, number>;
  source_tool: Record<string, number>;
  tags: Record<string, number>;
  layer_count: RangeFacet;
  area_mm2: RangeFacet;
  component_count: RangeFacet;
  min_trace_width_nm: RangeFacet;
}

/**
 * 카탈로그 한 페이지.
 */
export interface BoardPage {
  items: Board[];
  total: number;
  offset: number;
  limit: number;
  facets: CatalogFacets;
}

/**
 * 넷 테이블의 한 행.
 */
export interface NetRow {
  name: string;
  net_class?: string | null;
  diff_partner?: string | null;
  pin_count: number;
  length_nm: number;
  via_count: number;
  width_nm?: number | null;
  unrouted: boolean;
  /** 이 넷이 지나는 층 인덱스 목록. */
  layer_span?: number[] | null;
}

/**
 * 리비전 상세 화면 한 벌. 적층·설계룰·비아·드릴 같은 설계 내용은 CDM 타입을 그대로 쓴다 — 표현만을 위해 같은 모양을 다시 정의하면 두 정의가 어긋나기
 * 시작한다.
 */
export interface RevisionDetail {
  revision: Revision;
  part_number?: string | null;
  project_key?: string | null;
  product_family?: string | null;
  surface_finish?: string | null;
  special_processes: string[];
  /** 보드 외형 폴리곤. Overview의 형상 미리보기와 뷰어 초기 뷰포트가 쓴다. */
  outline: Polygon[];
  stackup: StackupLayer[];
  design_rules: DesignRules;
  vias: ViaSpec[];
  drills: DrillEntry[];
  drc_findings?: DrcFinding[] | null;
  warnings?: IngestWarning[] | null;
  layer_geometry?: LayerGeometryRef[] | null;
  components: ComponentRow[];
  nets: NetRow[];
  files: DesignFileRef[];
  /** 같은 보드의 전체 리비전 목록. 계보 트리와 비교 대상 선택에 쓴다. */
  lineage: RevisionRef[];
}

/**
 * Diff 판정 결과. renamed는 넷 이름만 바뀐 경우로 rewired(실제 회로 변경)와 구분된다.
 */
export type ChangeKind = "added" | "removed" | "moved" | "rotated" | "flipped" | "replaced" | "renamed" | "rewired" | "spec_changed" | "inserted";

export const CHANGE_KIND_VALUES = ["added", "removed", "moved", "rotated", "flipped", "replaced", "renamed", "rewired", "spec_changed", "inserted"] as const;

/**
 * 부품 변경 전후 상태. 몸통 크기를 함께 담는다 — 패키지가 바뀌면 차지하는 면적도 바뀌고, 그것이 리뷰에서 실제로 봐야 하는 변화다.
 */
export interface ComponentSnapshot {
  x_nm: number;
  y_nm: number;
  rotation_mdeg: number;
  side: string;
  package: string;
  part_number?: string | null;
  body_w_nm?: number | null;
  body_h_nm?: number | null;
}

/**
 * 부품 하나의 변경. RefDes로 매칭한 뒤 무엇이 달라졌는지 판정한다.
 */
export interface ComponentChange {
  refdes: string;
  kind: ChangeKind;
  before?: ComponentSnapshot | null;
  after?: ComponentSnapshot | null;
  /** 이동 거리. 임계값(기본 10µm) 미만은 변경으로 보지 않는다. */
  distance_nm?: number | null;
  rotation_delta_mdeg?: number | null;
}

/**
 * 넷 하나의 변경. 이름이 아니라 핀 집합 해시로 매칭하므로, 이름만 바뀐 넷과 회로가 바뀐 넷이 분리된다.
 */
export interface NetChange {
  kind: ChangeKind;
  name_a?: string | null;
  name_b?: string | null;
  /** refdes.pin 표기. */
  pins_added?: string[] | null;
  pins_removed?: string[] | null;
  length_delta_nm?: number | null;
}

/**
 * 헤더·설계룰·스택업의 단일 값 변경. 값은 표시용 문자열로 정규화해 담는다.
 */
export interface FieldChange {
  /** header.board_thickness_nm 등. */
  path: string;
  /** 사람이 읽는 항목명. */
  label: string;
  before: string;
  after: string;
}

/**
 * 적층 구조 변경.
 */
export interface StackupChange {
  index: number;
  kind: ChangeKind;
  layer_name?: string | null;
  fields?: FieldChange[] | null;
}

/**
 * 기하가 실제로 달라진 영역. 층을 격자로 나눠 셀 해시를 비교해 얻는다. 결과가 좌표라서 뷰어가 바로 그 위치로 이동할 수 있다.
 */
export interface GeometryRegion {
  layer_index: number;
  x0_nm: number;
  y0_nm: number;
  x1_nm: number;
  y1_nm: number;
  changed_object_count: number;
}

/**
 * 변경 요약 수치. 비교 화면 상단과 내보내기 리포트 첫 장에 쓴다.
 */
export interface ChangeStats {
  components_added: number;
  components_removed: number;
  components_moved: number;
  components_replaced: number;
  nets_added: number;
  nets_removed: number;
  nets_renamed: number;
  nets_rewired: number;
  pins_added: number;
  pins_removed: number;
  layers_changed: number;
  geometry_regions: number;
}

/**
 * 두 리비전 비교 결과. (rev_a, rev_b, parser_version) 키로 캐시하며 파서가 갱신되면 자동 무효화된다.
 */
export interface ChangeSet {
  revision_a_id: string;
  revision_b_id: string;
  generated_at: string;
  parser_version?: string | null;
  /** 이 값 미만의 이동은 변경으로 판정하지 않는다. CAD 재저장만으로도 하위 자릿수는 흔들리기 때문이다. */
  move_threshold_nm: number;
  stats: ChangeStats;
  header_changes?: FieldChange[] | null;
  rule_changes?: FieldChange[] | null;
  component_changes?: ComponentChange[] | null;
  net_changes?: NetChange[] | null;
  stackup_changes?: StackupChange[] | null;
  geometry_regions?: GeometryRegion[] | null;
}

/**
 * 비교의 성격. revision 은 같은 보드의 리비전 간, generation 은 같은 계열의 다음 세대 보드와의 벤치마킹.
 */
export type ChangeSetKind = "revision" | "generation";

export const CHANGE_SET_KIND_VALUES = ["revision", "generation"] as const;

/**
 * 미리 계산되어 캐시된 ChangeSet 하나. 목록에서 변경 규모를 먼저 보여주고 실제 상세는 눌렀을 때 받는다.
 */
export interface ChangeSetRef {
  revision_a_id: string;
  revision_b_id: string;
  board_key: string;
  board_name: string;
  /** generation 비교에서 B 쪽 보드가 다를 때만 채운다. */
  board_key_b?: string | null;
  label_a: string;
  label_b: string;
  kind: ChangeSetKind;
  generated_at: string;
  stats: ChangeStats;
}

/**
 * 캐시되어 있는 비교 목록. 실제 API에서는 임의의 두 리비전을 요청 시점에 계산하고 그 결과를 캐시하므로, 이 목록은 '이미 계산된 것'을 뜻한다.
 */
export interface ChangeSetIndex {
  pairs: ChangeSetRef[];
  /** 이 목록을 계산할 때 쓴 이동 임계값. 화면에서는 이 값 이상으로만 올려 거를 수 있다. */
  move_threshold_nm: number;
}

/**
 * 부품 역검색 결과의 한 행. 단종 공지가 뜰 때마다 설계팀이 수작업으로 하던 일을 조인 한 번으로 대체한다.
 */
export interface PartUsage {
  board_key: string;
  board_name: string;
  revision_label: string;
  revision_id: string;
  status?: string | null;
  quantity: number;
  refdes_list: string[];
}

/**
 * 연도별 등록 건수.
 */
export interface YearCount {
  year: number;
  revisions: number;
  /** 그 해에 처음 등록된 보드 수. */
  boards: number;
}

/**
 * 히스토그램 한 칸.
 */
export interface Bucket {
  label: string;
  count: number;
}

/**
 * 설계 룰의 연도별 중앙값. 세대가 지나며 얼마나 미세화됐는지를 본다.
 */
export interface RuleTrendPoint {
  year: number;
  /** 그 해 리비전 수. 표본이 적은 해는 화면에서 흐리게 둔다. */
  samples: number;
  min_trace_width_nm: number;
  min_drill_nm: number;
  min_bga_pitch_nm?: number | null;
}

/**
 * 리비전과 무관한 부품 마스터. 정규화된 MPN이 축이며, 정규화 실패는 곧 역검색 누락이다.
 */
export interface Part {
  id: string;
  manufacturer?: string | null;
  /** 공백·하이픈·포장 접미사를 제거한 정규형. */
  mpn_normalized: string;
  /** 원본 표기. */
  mpn_display: string;
  description?: string | null;
  /** active, nrnd, eol 등. */
  lifecycle?: string | null;
  /** 이 부품을 쓰는 보드 수. */
  board_count: number;
  total_quantity: number;
}

/**
 * 포트폴리오 전체 통계. 보드가 쌓일수록 의미가 생기는 값들이라 인제스트 때가 아니라 조회 시점에 집계한다.
 */
export interface PortfolioStats {
  generated_at: string;
  board_count: number;
  revision_count: number;
  component_total: number;
  net_total: number;
  /** 정규화된 고유 부품 수. */
  part_count: number;
  /** 두 개 이상의 보드에 쓰인 부품 수. */
  reused_part_count: number;
  /** 재사용 부품 비율 0~1. 설계 표준화 수준의 대리 지표. */
  reuse_ratio: number;
  by_year: YearCount[];
  layer_histogram: Record<string, number>;
  area_buckets: Bucket[];
  complexity_buckets: Bucket[];
  rule_trend: RuleTrendPoint[];
  top_parts: Part[];
}

/**
 * 부품 마스터 전체. 역검색 화면이 먼저 받는 목록이다.
 */
export interface PartIndex {
  generated_at: string;
  parts: Part[];
}

/**
 * 부품 하나와 그 사용처 전부. 단종 공지가 떴을 때 보는 화면.
 */
export interface PartDetail {
  part: Part;
  usages: PartUsage[];
}

