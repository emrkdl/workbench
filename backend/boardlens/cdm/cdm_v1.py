"""Canonical Design Model v1

생성된 파일이다 — 직접 고치지 말 것.
원본: cdm/schema/cdm.v1.json
재생성: python cdm/codegen/generate.py
"""
from __future__ import annotations
from enum import Enum
from pydantic import BaseModel, ConfigDict, Field

class LayerRole(str, Enum):
    """
    적층 내 각 층의 물리적 역할.
    """

    SIGNAL = "signal"
    PLANE_POWER = "plane_power"
    PLANE_GND = "plane_gnd"
    MIXED = "mixed"
    DIELECTRIC = "dielectric"
    MASK = "mask"
    SILK = "silk"
    PASTE = "paste"


class Side(str, Enum):
    """
    부품이 실장된 면.
    """

    TOP = "top"
    BOTTOM = "bottom"


class ViaKind(str, Enum):
    """
    비아 종류. 블라인드/베리드/마이크로 유무가 제조 난이도와 단가를 크게 좌우한다.
    """

    THROUGH = "through"
    BLIND = "blind"
    BURIED = "buried"
    MICRO = "micro"


class DrillKind(str, Enum):
    """
    홀 용도.
    """

    VIA = "via"
    MOUNTING = "mounting"
    TOOLING = "tooling"
    COMPONENT = "component"


class Severity(str, Enum):
    """
    DRC 위반 및 인제스트 경고의 심각도.
    """

    ERROR = "error"
    WARNING = "warning"
    INFO = "info"


class SourceUnits(str, Enum):
    """
    원본 파일이 사용하던 단위. 변환 이력 추적 목적으로만 보존하며 연산에는 쓰지 않는다.
    """

    NM = "nm"
    UM = "um"
    MM = "mm"
    MIL = "mil"
    INCH = "inch"


class GeometryKind(str, Enum):
    """
    .blg 버퍼 안에서 종류별로 연속 배치되는 기하 객체의 분류.
    """

    TRACE = "trace"
    PAD = "pad"
    VIA = "via"
    PLANE = "plane"
    TEXT = "text"
    OUTLINE = "outline"


class Polygon(BaseModel):
    """
    닫힌 폴리곤. 보드 외형과 컷아웃 표현에 쓴다.
    """

    model_config = ConfigDict(extra="forbid")

    points_nm: list[int] = Field(description="평탄화된 좌표 배열 [x0, y0, x1, y1, ...]. 첫 점과 끝 점은 중복하지 않으며 암묵적으로 닫힌다.")
    is_cutout: bool = Field(description="true면 보드 내부에 뚫린 영역(컷아웃).")


class BBox(BaseModel):
    """
    축 정렬 경계 상자.
    """

    model_config = ConfigDict(extra="forbid")

    x0_nm: int
    y0_nm: int
    x1_nm: int
    y1_nm: int


class DesignHeader(BaseModel):
    """
    설계의 신원과 물리적 외형. 카탈로그 목록에 보이는 대부분의 값이 여기서 나온다.
    """

    model_config = ConfigDict(extra="forbid")

    board_key: str = Field(description="설계 계보 식별자. 리비전이 바뀌어도 유지된다. 파일명이 아니라 파일 헤더에서 추출한다.")
    board_name: str = Field(description="사람이 읽는 보드 이름.")
    revision_label: str = Field(description="Rev A, 1.2 등 원본 표기 그대로.")
    source_tool: str = Field(description="원본 CAD 툴 이름.")
    source_version: str = Field(description="원본 CAD 툴 버전. 파싱 분기와 이슈 추적에 쓴다.")
    units_source: SourceUnits
    outline: list[Polygon] = Field(description="보드 외형. 이형 보드와 내부 컷아웃을 위해 다중 폴리곤.")
    board_thickness_nm: int = Field(description="보드 총 두께.")
    part_number: str | None = Field(default=None, description="보드 자체의 사내 파트넘버.")
    project_key: str | None = Field(default=None, description="소속 프로젝트. 권한 경계이기도 하다.")
    product_family: str | None = Field(default=None, description="제품군. 카탈로그 파셋.")
    author: str | None = Field(default=None, description="설계자.")
    designed_at: str | None = Field(default=None, description="설계 시점 ISO-8601 날짜. 업로드 시점과 구분된다.")
    surface_finish: str | None = Field(default=None, description="ENIG, HASL, OSP 등 표면 처리.")
    special_processes: list[str] | None = Field(default=None, description="리지드플렉스, 후동박, 임베디드 부품 등 특수 공정 태그.")


class StackupLayer(BaseModel):
    """
    적층의 한 층. 도체층과 유전체층을 모두 포함하며 index 순서가 곧 물리 적층 순서다.
    """

    model_config = ConfigDict(extra="forbid")

    index: int = Field(description="1부터 시작하는 물리 적층 순서. 1이 Top.")
    name: str = Field(description="정규화된 층 이름.")
    source_name: str = Field(description="원본 CAD의 층 이름. 원본 대조용으로 절대 버리지 않는다.")
    role: LayerRole
    thickness_nm: int = Field(description="층 두께.")
    material: str | None = Field(default=None, description="재질명. FR-4, Megtron6 등.")
    dk: float | None = Field(default=None, description="유전 상수. 임피던스 검토에 필요.")
    df: float | None = Field(default=None, description="손실 계수.")
    copper_weight_um: float | None = Field(default=None, description="동박 두께(µm). 후동박 여부 판별.")
    copper_area_ratio: float | None = Field(default=None, description="동박 면적률 0~1. 휨·열 검토와 제조사 문의에 자주 요구된다.")
    impedance_single_ohm: float | None = Field(default=None, description="설계 단일단 임피던스.")
    impedance_diff_ohm: float | None = Field(default=None, description="설계 차동 임피던스.")
    routed_net_count: int | None = Field(default=None, description="이 층에 배선된 넷 수. 파생값이지만 층별 밀도 파악에 자주 쓰여 보관한다.")


class Pin(BaseModel):
    """
    부품의 핀 하나. 연결 정보는 여기 두지 않는다 — 회로 연결은 Net.pins 한 곳에서만 선언된다.
    """

    model_config = ConfigDict(extra="forbid")

    name: str = Field(description="핀 이름 또는 번호. 부품 내에서 유일.")
    x_nm: int = Field(description="보드 좌표계 기준 절대 X.")
    y_nm: int = Field(description="보드 좌표계 기준 절대 Y.")
    layer_index: int | None = Field(default=None, description="패드가 놓인 층. 관통 핀은 null.")
    pad_width_nm: int | None = Field(default=None, description="패드 폭.")
    pad_height_nm: int | None = Field(default=None, description="패드 높이.")


class Component(BaseModel):
    """
    배치된 부품 하나. refdes가 리비전 간 비교의 1차 매칭 키다.
    """

    model_config = ConfigDict(extra="forbid")

    refdes: str = Field(description="R12, U3 등. 리비전 내에서 유일해야 하며 중복 시 적재를 거부한다.")
    package: str = Field(description="0402, QFN48, BGA256 등 패키지 타입.")
    x_nm: int = Field(description="부품 원점 X.")
    y_nm: int = Field(description="부품 원점 Y.")
    rotation_mdeg: int = Field(description="1/1000도 단위 반시계 회전. 0 이상 360000 미만.")
    side: Side
    pins: list[Pin] = Field(description="이 부품의 핀 목록.")
    part_number: str | None = Field(default=None, description="제조사 파트넘버(MPN). 부품 역검색과 EOL 영향 분석의 핵심 필드.")
    manufacturer: str | None = Field(default=None, description="제조사.")
    value: str | None = Field(default=None, description="100nF, 10k 등 수동 소자 값.")
    height_nm: int | None = Field(default=None, description="부품 높이. 기구 간섭 검토에 쓴다.")
    pin_pitch_nm: int | None = Field(default=None, description="핀 피치. BGA 최소 피치 집계에 쓴다.")


class NetPinRef(BaseModel):
    """
    넷에 연결된 핀 하나. 회로 연결의 원자 단위이며 넷리스트 Diff는 이 집합의 차집합이다.
    """

    model_config = ConfigDict(extra="forbid")

    refdes: str
    pin_name: str


class LayerLength(BaseModel):
    """
    층별 배선 길이 내역.
    """

    model_config = ConfigDict(extra="forbid")

    layer_index: int
    length_nm: int


class Net(BaseModel):
    """
    하나의 전기적 넷. name은 리비전 사이에서 바뀔 수 있으므로 signature가 실질적 동일성 판정을 맡는다.
    """

    model_config = ConfigDict(extra="forbid")

    name: str = Field(description="넷 이름. Diff의 1차 매칭 키.")
    pins: list[NetPinRef] = Field(description="연결된 핀 목록. 회로 연결이 선언되는 유일한 자리.")
    length_nm: int = Field(description="총 배선 길이.")
    via_count: int = Field(description="이 넷이 사용하는 비아 수.")
    unrouted: bool = Field(description="미배선 여부.")
    signature: str | None = Field(default=None, description="정렬된 refdes.pin 집합의 해시. 이름이 바뀐 넷과 실제로 회로가 바뀐 넷을 구분하는 열쇠. 파서가 아니라 정규화 단계에서 채운다.")
    net_class: str | None = Field(default=None, description="전원, 차동, 고속 등 설계자가 부여한 분류.")
    diff_partner: str | None = Field(default=None, description="차동쌍 상대 넷 이름.")
    length_by_layer: list[LayerLength] | None = Field(default=None, description="층별 배선 길이 내역.")
    width_nm: int | None = Field(default=None, description="공칭 선폭.")


class ViaSpec(BaseModel):
    """
    동일 사양 비아의 집계. 개별 비아 위치는 기하 버퍼에 있고 여기에는 통계만 둔다.
    """

    model_config = ConfigDict(extra="forbid")

    kind: ViaKind
    from_layer: int
    to_layer: int
    drill_nm: int = Field(description="드릴 직경.")
    pad_nm: int = Field(description="패드 직경.")
    count: int


class DrillEntry(BaseModel):
    """
    드릴 표의 한 행. 제조 발주 시 그대로 쓰이는 정보.
    """

    model_config = ConfigDict(extra="forbid")

    diameter_nm: int
    plated: bool = Field(description="도금 홀(PTH) 여부.")
    kind: DrillKind
    count: int


class DesignRules(BaseModel):
    """
    설계에 실제로 적용된 최소값들. 제조 가능성과 단가를 결정하며 카탈로그 파셋으로도 쓴다.
    """

    model_config = ConfigDict(extra="forbid")

    min_trace_width_nm: int = Field(description="최소 선폭.")
    min_clearance_nm: int = Field(description="최소 간격.")
    min_drill_nm: int = Field(description="최소 드릴 직경.")
    min_annular_ring_nm: int | None = Field(default=None, description="최소 애뉼러 링.")
    max_aspect_ratio: float | None = Field(default=None, description="최대 종횡비(보드 두께 / 최소 드릴).")
    min_bga_pitch_nm: int | None = Field(default=None, description="BGA 최소 피치. 조립 난이도의 대표 지표.")


class DrcFinding(BaseModel):
    """
    CAD 툴이 낸 DRC 결과 한 건. BoardLens는 DRC를 재실행하지 않고 결과를 표시만 한다.
    """

    model_config = ConfigDict(extra="forbid")

    rule: str = Field(description="위반한 룰 이름.")
    severity: Severity
    message: str
    x_nm: int | None = None
    y_nm: int | None = None
    layer_index: int | None = None
    net_name: str | None = None
    refdes: str | None = None


class LayerGeometryRef(BaseModel):
    """
    층 하나의 기하 버퍼(.blg)를 가리키는 포인터. 실제 좌표 데이터는 DB에 들어가지 않고 blob 스토어에 있으며, 브라우저가 API를 거치지 않고 직접
    받는다.
    """

    model_config = ConfigDict(extra="forbid")

    layer_index: int
    storage_key: str = Field(description="blob 스토어 내 경로.")
    object_count: int
    byte_size: int = Field(description="gzip 압축 후 바이트 크기.")
    bbox: BBox
    kind_counts: dict[str, int] = Field(description="기하 종류별 객체 수. 키는 GeometryKind 값.")


class IngestWarning(BaseModel):
    """
    인제스트 무결성 검사에서 나온 경고. 실패가 아니라 기록이며 리비전 상세에 표시된다. 실제 설계 데이터는 원래 조금씩 지저분하고, 그걸 이유로 적재를 거부하면
    아무도 시스템을 쓰지 않는다.
    """

    model_config = ConfigDict(extra="forbid")

    code: str = Field(description="component_outside_outline, orphan_net 등 기계 판독 가능한 코드.")
    severity: Severity
    message: str
    count: int = Field(description="동일 코드가 합쳐진 건수.")


class Design(BaseModel):
    """
    CDM 문서 루트. 입력 어댑터 하나가 파일 하나를 읽어 정확히 이 형태를 내놓는다.
    """

    model_config = ConfigDict(extra="forbid")

    cdm_version: str = Field(description="이 문서가 따르는 CDM 버전. 재파싱 판정에 쓴다.")
    header: DesignHeader
    stackup: list[StackupLayer]
    components: list[Component]
    nets: list[Net]
    vias: list[ViaSpec]
    drills: list[DrillEntry]
    design_rules: DesignRules
    parser_name: str | None = Field(default=None, description="생성한 어댑터 이름. hkp, mockgen 등.")
    parser_version: str | None = Field(default=None, description="어댑터 버전. 상승하면 전체 재파싱 대상이 된다.")
    drc_findings: list[DrcFinding] | None = None
    layer_geometry: list[LayerGeometryRef] | None = None
    warnings: list[IngestWarning] | None = None


__all__ = [
    "LayerRole",
    "Side",
    "ViaKind",
    "DrillKind",
    "Severity",
    "SourceUnits",
    "GeometryKind",
    "Polygon",
    "BBox",
    "DesignHeader",
    "StackupLayer",
    "Pin",
    "Component",
    "NetPinRef",
    "LayerLength",
    "Net",
    "ViaSpec",
    "DrillEntry",
    "DesignRules",
    "DrcFinding",
    "LayerGeometryRef",
    "IngestWarning",
    "Design",
]
