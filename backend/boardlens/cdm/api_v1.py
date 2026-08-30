"""BoardLens API v1

생성된 파일이다 — 직접 고치지 말 것.
원본: cdm/schema/api.v1.json
재생성: python cdm/codegen/generate.py
"""
from __future__ import annotations
from enum import Enum
from pydantic import BaseModel, ConfigDict, Field

from boardlens.cdm.cdm_v1 import DesignRules, DrcFinding, DrillEntry, IngestWarning, LayerGeometryRef, Polygon, StackupLayer, ViaSpec

class LifecycleStatus(str, Enum):
    """
    리비전의 승인 단계. 보드의 상태는 최신 리비전의 상태로 파생된다.
    """

    DRAFT = "draft"
    REVIEW = "review"
    RELEASED = "released"
    OBSOLETE = "obsolete"


class IngestState(str, Enum):
    """
    인제스트 상태 머신의 현재 위치. ready가 아니면 열람할 수 없다.
    """

    UPLOADED = "uploaded"
    PARSING = "parsing"
    NORMALIZING = "normalizing"
    INDEXING = "indexing"
    READY = "ready"
    FAILED = "failed"


class SecurityLevel(str, Enum):
    """
    프로젝트 보안 등급. 다운로드 허용 여부와 워터마크 강도를 좌우한다.
    """

    INTERNAL = "internal"
    CONFIDENTIAL = "confidential"
    RESTRICTED = "restricted"


class OutlineKind(str, Enum):
    """
    보드 외형 분류. 이형 보드는 제조 단가와 패널화 효율이 달라진다.
    """

    RECTANGULAR = "rectangular"
    SHAPED = "shaped"


class Project(BaseModel):
    """
    권한 부여의 기본 경계.
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    key: str = Field(description="URL과 필터에 쓰는 짧은 식별자.")
    name: str
    security_level: SecurityLevel


class DesignFileRef(BaseModel):
    """
    업로드된 원본 파일. 불변이며 sha256으로 주소 지정한다.
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    filename: str
    sha256: str
    byte_size: int
    uploaded_at: str = Field(description="ISO-8601.")
    uploaded_by: str
    storage_key: str
    kind: str | None = Field(default=None, description="design, gerber, bom, assembly, drc_report 등.")


class RevisionSummary(BaseModel):
    """
    인제스트 시점에 계산해 리비전 행에 박아두는 사전 집계. 카탈로그 파셋과 Overview 화면은 전부 여기만 읽는다 — 사용자가 슬라이더를 움직일 때마다
    2,000만 행을 집계하지 않기 위해서다.
    """

    model_config = ConfigDict(extra="forbid")

    layer_count: int = Field(description="총 도체층 수.")
    signal_layer_count: int
    plane_layer_count: int
    width_nm: int = Field(description="외형 경계 상자 폭.")
    height_nm: int = Field(description="외형 경계 상자 높이.")
    area_mm2: float = Field(description="실제 폴리곤 면적(컷아웃 제외). 경계 상자 면적과 다르다.")
    outline_kind: OutlineKind
    cutout_count: int
    board_thickness_nm: int
    component_count: int
    component_top_count: int
    component_bottom_count: int
    pin_count: int
    bga_count: int
    package_counts: dict[str, int] = Field(description="패키지 타입별 부품 수.")
    density_per_cm2: float = Field(description="부품 배치 밀도.")
    net_count: int
    total_route_length_nm: int
    diff_pair_count: int
    unrouted_count: int
    power_net_count: int
    via_total: int
    via_by_kind: dict[str, int] = Field(description="비아 종류별 수. 키는 CDM의 ViaKind 값.")
    hole_count: int = Field(description="드릴 총 수.")
    min_trace_width_nm: int
    min_clearance_nm: int
    min_drill_nm: int
    drc_error_count: int
    drc_warning_count: int
    warning_count: int = Field(description="인제스트 무결성 경고 건수.")
    complexity_score: float = Field(description="밀도·층수·핀 수·최소 선폭을 합성한 0~100 지표. 보드 간 난이도 비교용.")
    min_bga_pitch_nm: int | None = Field(default=None, description="BGA가 없으면 null.")
    max_aspect_ratio: float | None = None


class RevisionRef(BaseModel):
    """
    리비전 계보 트리와 비교 대상 선택에 쓰는 가벼운 참조.
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    label: str
    status: LifecycleStatus
    created_at: str
    parent_revision_id: str | None = None
    author: str | None = None
    note: str | None = Field(default=None, description="변경 사유 한 줄.")


class Revision(BaseModel):
    """
    특정 시점의 설계 스냅샷. 열람과 비교의 단위이며 실제 데이터는 전부 여기 매달린다.
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    board_id: str
    board_key: str
    board_name: str = Field(description="보드의 사람이 읽는 이름. 계보 전체에 공통이지만 상세 화면이 매번 보드를 따로 조회하지 않도록 함께 싣는다.")
    label: str
    status: LifecycleStatus
    ingest_state: IngestState
    created_at: str = Field(description="업로드 시점.")
    source_tool: str
    source_version: str
    summary: RevisionSummary
    parent_revision_id: str | None = None
    ingest_error: str | None = Field(default=None, description="failed 상태일 때의 원인과 원본 라인 번호.")
    author: str | None = None
    designed_at: str | None = None
    note: str | None = None
    parser_version: str | None = None
    thumbnail_url: str | None = None


class Board(BaseModel):
    """
    설계 계보. 리비전이 바뀌어도 유지되는 논리적 정체성.
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    project_key: str
    board_key: str = Field(description="URL 식별자.")
    name: str
    status: LifecycleStatus
    source_tool: str = Field(description="최신 리비전의 CAD 툴. 카탈로그 파셋이라 보드 행에 비정규화해 둔다.")
    tags: list[str]
    revision_count: int
    latest_revision_id: str
    latest_revision_label: str
    created_at: str
    updated_at: str
    summary: RevisionSummary = Field(description="최신 리비전의 요약. 카탈로그 목록과 파셋 필터가 읽는 값.")
    part_number: str | None = None
    product_family: str | None = None
    owner: str | None = None
    thumbnail_url: str | None = None
    outline: list[Polygon] | None = Field(default=None, description="최신 리비전의 외형 폴리곤. 카탈로그 카드가 보드 생김새를 바로 보여줄 수 있게 목록 응답에 함께 싣는다 — 폴리곤 하나에 좌표 몇 개뿐이라 비용이 거의 없다.")


class RangeFacet(BaseModel):
    """
    숫자 파셋의 현재 데이터 범위. 슬라이더 경계를 서버가 알려준다.
    """

    model_config = ConfigDict(extra="forbid")

    min: float
    max: float


class CatalogFacets(BaseModel):
    """
    현재 필터 조건에서 가능한 선택지와 각 선택지의 결과 수. 값이 0인 선택지는 UI에서 비활성으로 보인다.
    """

    model_config = ConfigDict(extra="forbid")

    product_family: dict[str, int]
    status: dict[str, int]
    owner: dict[str, int]
    source_tool: dict[str, int]
    tags: dict[str, int]
    layer_count: RangeFacet
    area_mm2: RangeFacet
    component_count: RangeFacet
    min_trace_width_nm: RangeFacet


class BoardPage(BaseModel):
    """
    카탈로그 한 페이지.
    """

    model_config = ConfigDict(extra="forbid")

    items: list[Board]
    total: int
    offset: int
    limit: int
    facets: CatalogFacets


class ComponentRow(BaseModel):
    """
    부품 테이블의 한 행. CDM Component에서 핀 배열을 뺀 형태로, 2,000행 가상 스크롤에 맞춰 가볍게 유지한다.
    """

    model_config = ConfigDict(extra="forbid")

    refdes: str
    package: str
    x_nm: int
    y_nm: int
    rotation_mdeg: int
    side: str = Field(description="top 또는 bottom.")
    pin_count: int
    part_number: str | None = None
    manufacturer: str | None = None
    value: str | None = None
    pin_pitch_nm: int | None = None
    body_w_nm: int | None = Field(default=None, description="몸통 가로. 배치도가 그리는 사각형의 크기.")
    body_h_nm: int | None = Field(default=None, description="몸통 세로.")


class NetRow(BaseModel):
    """
    넷 테이블의 한 행.
    """

    model_config = ConfigDict(extra="forbid")

    name: str
    pin_count: int
    length_nm: int
    via_count: int
    unrouted: bool
    net_class: str | None = None
    diff_partner: str | None = None
    width_nm: int | None = None
    layer_span: list[int] | None = Field(default=None, description="이 넷이 지나는 층 인덱스 목록.")


class RevisionDetail(BaseModel):
    """
    리비전 상세 화면 한 벌. 적층·설계룰·비아·드릴 같은 설계 내용은 CDM 타입을 그대로 쓴다 — 표현만을 위해 같은 모양을 다시 정의하면 두 정의가 어긋나기
    시작한다.
    """

    model_config = ConfigDict(extra="forbid")

    revision: Revision
    special_processes: list[str]
    outline: list[Polygon] = Field(description="보드 외형 폴리곤. Overview의 형상 미리보기와 뷰어 초기 뷰포트가 쓴다.")
    stackup: list[StackupLayer]
    design_rules: DesignRules
    vias: list[ViaSpec]
    drills: list[DrillEntry]
    components: list[ComponentRow]
    nets: list[NetRow]
    files: list[DesignFileRef]
    lineage: list[RevisionRef] = Field(description="같은 보드의 전체 리비전 목록. 계보 트리와 비교 대상 선택에 쓴다.")
    part_number: str | None = None
    project_key: str | None = None
    product_family: str | None = None
    surface_finish: str | None = None
    drc_findings: list[DrcFinding] | None = None
    warnings: list[IngestWarning] | None = None
    layer_geometry: list[LayerGeometryRef] | None = None


class ChangeKind(str, Enum):
    """
    Diff 판정 결과. renamed는 넷 이름만 바뀐 경우로 rewired(실제 회로 변경)와 구분된다.
    """

    ADDED = "added"
    REMOVED = "removed"
    MOVED = "moved"
    ROTATED = "rotated"
    FLIPPED = "flipped"
    REPLACED = "replaced"
    RENAMED = "renamed"
    REWIRED = "rewired"
    SPEC_CHANGED = "spec_changed"
    INSERTED = "inserted"


class ComponentSnapshot(BaseModel):
    """
    부품 변경 전후 상태. 몸통 크기를 함께 담는다 — 패키지가 바뀌면 차지하는 면적도 바뀌고, 그것이 리뷰에서 실제로 봐야 하는 변화다.
    """

    model_config = ConfigDict(extra="forbid")

    x_nm: int
    y_nm: int
    rotation_mdeg: int
    side: str
    package: str
    part_number: str | None = None
    body_w_nm: int | None = None
    body_h_nm: int | None = None


class ComponentChange(BaseModel):
    """
    부품 하나의 변경. RefDes로 매칭한 뒤 무엇이 달라졌는지 판정한다.
    """

    model_config = ConfigDict(extra="forbid")

    refdes: str
    kind: ChangeKind
    before: ComponentSnapshot | None = None
    after: ComponentSnapshot | None = None
    distance_nm: int | None = Field(default=None, description="이동 거리. 임계값(기본 10µm) 미만은 변경으로 보지 않는다.")
    rotation_delta_mdeg: int | None = None


class NetChange(BaseModel):
    """
    넷 하나의 변경. 이름이 아니라 핀 집합 해시로 매칭하므로, 이름만 바뀐 넷과 회로가 바뀐 넷이 분리된다.
    """

    model_config = ConfigDict(extra="forbid")

    kind: ChangeKind
    name_a: str | None = None
    name_b: str | None = None
    pins_added: list[str] | None = Field(default=None, description="refdes.pin 표기.")
    pins_removed: list[str] | None = None
    length_delta_nm: int | None = None


class FieldChange(BaseModel):
    """
    헤더·설계룰·스택업의 단일 값 변경. 값은 표시용 문자열로 정규화해 담는다.
    """

    model_config = ConfigDict(extra="forbid")

    path: str = Field(description="header.board_thickness_nm 등.")
    label: str = Field(description="사람이 읽는 항목명.")
    before: str
    after: str


class StackupChange(BaseModel):
    """
    적층 구조 변경.
    """

    model_config = ConfigDict(extra="forbid")

    index: int
    kind: ChangeKind
    layer_name: str | None = None
    fields: list[FieldChange] | None = None


class GeometryRegion(BaseModel):
    """
    기하가 실제로 달라진 영역. 층을 격자로 나눠 셀 해시를 비교해 얻는다. 결과가 좌표라서 뷰어가 바로 그 위치로 이동할 수 있다.
    """

    model_config = ConfigDict(extra="forbid")

    layer_index: int
    x0_nm: int
    y0_nm: int
    x1_nm: int
    y1_nm: int
    changed_object_count: int


class ChangeStats(BaseModel):
    """
    변경 요약 수치. 비교 화면 상단과 내보내기 리포트 첫 장에 쓴다.
    """

    model_config = ConfigDict(extra="forbid")

    components_added: int
    components_removed: int
    components_moved: int
    components_replaced: int
    nets_added: int
    nets_removed: int
    nets_renamed: int
    nets_rewired: int
    pins_added: int
    pins_removed: int
    layers_changed: int
    geometry_regions: int


class ChangeSet(BaseModel):
    """
    두 리비전 비교 결과. (rev_a, rev_b, parser_version) 키로 캐시하며 파서가 갱신되면 자동 무효화된다.
    """

    model_config = ConfigDict(extra="forbid")

    revision_a_id: str
    revision_b_id: str
    generated_at: str
    move_threshold_nm: int = Field(description="이 값 미만의 이동은 변경으로 판정하지 않는다. CAD 재저장만으로도 하위 자릿수는 흔들리기 때문이다.")
    stats: ChangeStats
    parser_version: str | None = None
    header_changes: list[FieldChange] | None = None
    rule_changes: list[FieldChange] | None = None
    component_changes: list[ComponentChange] | None = None
    net_changes: list[NetChange] | None = None
    stackup_changes: list[StackupChange] | None = None
    geometry_regions: list[GeometryRegion] | None = None


class ChangeSetKind(str, Enum):
    """
    비교의 성격. revision 은 같은 보드의 리비전 간, generation 은 같은 계열의 다음 세대 보드와의 벤치마킹.
    """

    REVISION = "revision"
    GENERATION = "generation"


class ChangeSetRef(BaseModel):
    """
    미리 계산되어 캐시된 ChangeSet 하나. 목록에서 변경 규모를 먼저 보여주고 실제 상세는 눌렀을 때 받는다.
    """

    model_config = ConfigDict(extra="forbid")

    revision_a_id: str
    revision_b_id: str
    board_key: str
    board_name: str
    label_a: str
    label_b: str
    kind: ChangeSetKind
    generated_at: str
    stats: ChangeStats
    board_key_b: str | None = Field(default=None, description="generation 비교에서 B 쪽 보드가 다를 때만 채운다.")


class ChangeSetIndex(BaseModel):
    """
    캐시되어 있는 비교 목록. 실제 API에서는 임의의 두 리비전을 요청 시점에 계산하고 그 결과를 캐시하므로, 이 목록은 '이미 계산된 것'을 뜻한다.
    """

    model_config = ConfigDict(extra="forbid")

    pairs: list[ChangeSetRef]
    move_threshold_nm: int = Field(description="이 목록을 계산할 때 쓴 이동 임계값. 화면에서는 이 값 이상으로만 올려 거를 수 있다.")


class PartUsage(BaseModel):
    """
    부품 역검색 결과의 한 행. 단종 공지가 뜰 때마다 설계팀이 수작업으로 하던 일을 조인 한 번으로 대체한다.
    """

    model_config = ConfigDict(extra="forbid")

    board_key: str
    board_name: str
    revision_label: str
    revision_id: str
    quantity: int
    refdes_list: list[str]
    status: str | None = None


class YearCount(BaseModel):
    """
    연도별 등록 건수.
    """

    model_config = ConfigDict(extra="forbid")

    year: int
    revisions: int
    boards: int = Field(description="그 해에 처음 등록된 보드 수.")


class Bucket(BaseModel):
    """
    히스토그램 한 칸.
    """

    model_config = ConfigDict(extra="forbid")

    label: str
    count: int


class RuleTrendPoint(BaseModel):
    """
    설계 룰의 연도별 중앙값. 세대가 지나며 얼마나 미세화됐는지를 본다.
    """

    model_config = ConfigDict(extra="forbid")

    year: int
    samples: int = Field(description="그 해 리비전 수. 표본이 적은 해는 화면에서 흐리게 둔다.")
    min_trace_width_nm: int
    min_drill_nm: int
    min_bga_pitch_nm: int | None = None


class Part(BaseModel):
    """
    리비전과 무관한 부품 마스터. 정규화된 MPN이 축이며, 정규화 실패는 곧 역검색 누락이다.
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    mpn_normalized: str = Field(description="공백·하이픈·포장 접미사를 제거한 정규형.")
    mpn_display: str = Field(description="원본 표기.")
    board_count: int = Field(description="이 부품을 쓰는 보드 수.")
    total_quantity: int
    manufacturer: str | None = None
    description: str | None = None
    lifecycle: str | None = Field(default=None, description="active, nrnd, eol 등.")


class PortfolioStats(BaseModel):
    """
    포트폴리오 전체 통계. 보드가 쌓일수록 의미가 생기는 값들이라 인제스트 때가 아니라 조회 시점에 집계한다.
    """

    model_config = ConfigDict(extra="forbid")

    generated_at: str
    board_count: int
    revision_count: int
    component_total: int
    net_total: int
    part_count: int = Field(description="정규화된 고유 부품 수.")
    reused_part_count: int = Field(description="두 개 이상의 보드에 쓰인 부품 수.")
    reuse_ratio: float = Field(description="재사용 부품 비율 0~1. 설계 표준화 수준의 대리 지표.")
    by_year: list[YearCount]
    layer_histogram: dict[str, int]
    area_buckets: list[Bucket]
    complexity_buckets: list[Bucket]
    rule_trend: list[RuleTrendPoint]
    top_parts: list[Part]


class PartIndex(BaseModel):
    """
    부품 마스터 전체. 역검색 화면이 먼저 받는 목록이다.
    """

    model_config = ConfigDict(extra="forbid")

    generated_at: str
    parts: list[Part]


class PartDetail(BaseModel):
    """
    부품 하나와 그 사용처 전부. 단종 공지가 떴을 때 보는 화면.
    """

    model_config = ConfigDict(extra="forbid")

    part: Part
    usages: list[PartUsage]


__all__ = [
    "LifecycleStatus",
    "IngestState",
    "SecurityLevel",
    "OutlineKind",
    "Project",
    "DesignFileRef",
    "RevisionSummary",
    "RevisionRef",
    "Revision",
    "Board",
    "RangeFacet",
    "CatalogFacets",
    "BoardPage",
    "ComponentRow",
    "NetRow",
    "RevisionDetail",
    "ChangeKind",
    "ComponentSnapshot",
    "ComponentChange",
    "NetChange",
    "FieldChange",
    "StackupChange",
    "GeometryRegion",
    "ChangeStats",
    "ChangeSet",
    "ChangeSetKind",
    "ChangeSetRef",
    "ChangeSetIndex",
    "PartUsage",
    "YearCount",
    "Bucket",
    "RuleTrendPoint",
    "Part",
    "PortfolioStats",
    "PartIndex",
    "PartDetail",
]
