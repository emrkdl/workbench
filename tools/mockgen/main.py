#!/usr/bin/env python3
"""목데이터 생성기.

HKP 실물이 없는 동안 Phase 1~4를 진행하기 위한 장치다. 핵심은 이것이 화면용 가짜
JSON을 바로 찍어내지 않는다는 점이다 — 먼저 CDM Design 문서를 만들고, 그것을 실제
인제스트 집계 코드(boardlens.ingest.summarize)에 통과시켜 API 응답을 얻는다. 실제
파서가 붙는 날 이 파일만 빠지고 나머지 경로는 그대로 남는다.

부품 MPN은 전역 레지스트리에서 재사용된다. 여러 보드가 같은 부품을 실제로 공유해야
부품 역검색과 EOL 영향 분석을 목데이터로도 확인할 수 있기 때문이다.

제조사명과 부품번호는 전부 가상이다. 형식만 실제와 비슷하게 맞췄다.

사용:  python tools/mockgen/main.py [--seed 20260830] [--out web/public/mock]
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from boardlens.cdm.api_v1 import (  # noqa: E402
    Board,
    BoardPage,
    CatalogFacets,
    ChangeSetIndex,
    ChangeSetKind,
    ChangeSetRef,
    DesignFileRef,
    IngestState,
    LifecycleStatus,
    RangeFacet,
    Revision,
    RevisionDetail,
    RevisionRef,
)
from boardlens.analytics import portfolio  # noqa: E402
from boardlens.analytics.parts import PartRegistry, normalize_mpn  # noqa: E402
from boardlens.cdm.api_v1 import ChangeSet, PartDetail, PartIndex  # noqa: E402
from boardlens.cdm.cdm_v1 import (  # noqa: E402
    Component,
    Design,
    DesignHeader,
    DesignRules,
    DrcFinding,
    DrillEntry,
    DrillKind,
    GeometryKind,
    IngestWarning,
    LayerGeometryRef,
    LayerLength,
    LayerRole,
    Net,
    NetPinRef,
    Pin,
    Polygon,
    Severity,
    Side,
    SourceUnits,
    StackupLayer,
    ViaKind,
    ViaSpec,
    BBox,
)
from boardlens.diff.engine import diff  # noqa: E402
from boardlens.geometry import blg  # noqa: E402
from boardlens.ingest.summarize import (  # noqa: E402
    fill_signatures,
    pick_landmarks,
    summarize,
    to_component_rows,
    to_net_rows,
)
from boardlens.units import DEFAULT_MOVE_THRESHOLD_NM, NM_PER_MM, NM_PER_UM  # noqa: E402

from geometry import synthesize  # noqa: E402
from placement import Occupancy, body_size, jitter_into, rotated  # noqa: E402

CDM_VERSION = "1.0.0"
PARSER_NAME = "mockgen"
PARSER_VERSION = "0.1.0"


# ── 부품 카탈로그 ──────────────────────────────────────────────────


@dataclass(frozen=True)
class PartSpec:
    prefix: str
    package: str
    pins: int
    pitch_um: int | None = None
    series: str = ""
    values: tuple[str, ...] = ()
    maker: str = ""



PASSIVES = [
    PartSpec("C", "0201", 2, series="DC021", values=("100nF", "10nF", "1nF"), maker="Delta Passives"),
    PartSpec("C", "0402", 2, series="DC042", values=("100nF", "1uF", "10nF", "22pF", "4.7uF"), maker="Delta Passives"),
    PartSpec("C", "0603", 2, series="DC063", values=("10uF", "1uF", "22uF", "100nF"), maker="Delta Passives"),
    PartSpec("C", "0805", 2, series="DC085", values=("47uF", "22uF"), maker="Delta Passives"),
    PartSpec("R", "0402", 2, series="DR042", values=("10k", "1k", "100k", "0R", "4.7k", "49R9", "22R"), maker="Delta Passives"),
    PartSpec("R", "0603", 2, series="DR063", values=("10k", "100R", "1M", "0R"), maker="Delta Passives"),
    PartSpec("L", "0805", 2, series="SL085", values=("2u2H", "4u7H", "10uH"), maker="Sable Electronics"),
    PartSpec("FB", "0603", 2, series="SB063", values=("600R", "120R"), maker="Sable Electronics"),
]

DISCRETES = [
    PartSpec("D", "SOD-123", 2, series="KD123", values=("SCHOTTKY", "TVS"), maker="Kestrel Components"),
    PartSpec("D", "SOD-323", 2, series="KD323", values=("ESD",), maker="Kestrel Components"),
    PartSpec("Q", "SOT-23", 3, series="KQ023", values=("NMOS", "PMOS"), maker="Kestrel Components"),
    PartSpec("Q", "SOT-223", 4, series="KQ223", values=("NMOS-PWR",), maker="Kestrel Components"),
    PartSpec("LED", "0603", 2, series="KL063", values=("GREEN", "RED"), maker="Kestrel Components"),
]

SMALL_ICS = [
    PartSpec("U", "SOIC-8", 8, 1270, series="AS08", maker="Arcadia Semi"),
    PartSpec("U", "TSSOP-20", 20, 650, series="AS20", maker="Arcadia Semi"),
    PartSpec("U", "QFN-24", 24, 500, series="AQ24", maker="Arcadia Semi"),
    PartSpec("U", "QFN-32", 32, 500, series="AQ32", maker="Arcadia Semi"),
    PartSpec("U", "QFN-48", 48, 400, series="AQ48", maker="Arcadia Semi"),
    PartSpec("U", "LQFP-64", 64, 500, series="AL64", maker="Arcadia Semi"),
    PartSpec("U", "LQFP-100", 100, 500, series="AL10", maker="Arcadia Semi"),
]
#: 실제 보드의 IC 구성은 작은 쪽으로 크게 치우친다. 균등하게 뽑으면 14mm 짜리 LQFP 가
#: 보드 면적을 먼저 다 먹고 수동 소자가 들어갈 자리가 없어진다.
SMALL_IC_WEIGHTS = [20, 18, 20, 16, 12, 8, 6]

BIG_ICS = [
    PartSpec("U", "WLCSP-36", 36, 400, series="NW36", maker="Norsk Micro"),
    PartSpec("U", "LFBGA-196", 196, 650, series="NB19", maker="Norsk Micro"),
    PartSpec("U", "BGA-256", 256, 800, series="NB25", maker="Norsk Micro"),
    PartSpec("U", "BGA-484", 484, 800, series="NB48", maker="Norsk Micro"),
    PartSpec("U", "BGA-676", 676, 650, series="NB67", maker="Norsk Micro"),
]

CONNECTORS = [
    PartSpec("J", "CONN-FPC-40", 40, 500, series="HC40", maker="Hyperion Devices"),
    PartSpec("J", "CONN-B2B-60", 60, 400, series="HC60", maker="Hyperion Devices"),
    PartSpec("J", "CONN-USB-C", 24, 800, series="HCUC", maker="Hyperion Devices"),
    PartSpec("J", "CONN-HDR-10", 10, 2540, series="HC10", maker="Hyperion Devices"),
]

MISC = [
    PartSpec("Y", "XTAL-3225", 4, series="SX32", values=("25M", "24M", "40M"), maker="Sable Electronics"),
    PartSpec("TP", "TP-1", 1, series="", maker=""),
]

#: (series, value) -> MPN. 여러 보드가 같은 부품을 실제로 공유하게 만드는 장치.
_MPN_REGISTRY: dict[tuple[str, str], str] = {}

#: 수명 상태. 전부 active 면 EOL 영향 분석 화면에 볼 것이 없으므로 일부를 단종·비권장으로 둔다.
LIFECYCLE_WEIGHTS = [("active", 78), ("nrnd", 14), ("eol", 8)]


def mpn_for(spec: PartSpec, value: str, rng: random.Random) -> str | None:
    if not spec.series:
        return None
    key = (spec.series, value)
    if key not in _MPN_REGISTRY:
        code = "".join(rng.choice("0123456789") for _ in range(4))
        suffix = rng.choice(["KA", "FR", "TR", "NL", "GB"])
        _MPN_REGISTRY[key] = f"{spec.series}-{code}{suffix}"
    return _MPN_REGISTRY[key]


# ── 아키타입 ──────────────────────────────────────────────────────


@dataclass(frozen=True)
class Archetype:
    key: str
    label: str
    layers: tuple[int, int]
    width_mm: tuple[float, float]
    height_mm: tuple[float, float]
    thickness_mm: float
    components: tuple[int, int]
    min_trace_um: tuple[int, int]
    min_drill_um: int
    big_ics: tuple[int, int]
    connectors: tuple[int, int]
    advanced_via: bool
    heavy_copper: bool
    shaped: bool
    special: tuple[str, ...] = ()


ARCHETYPES = {
    "main_logic": Archetype(
        "main_logic", "메인 로직", (8, 12), (95, 155), (70, 115), 1.6,
        (2600, 5200), (60, 90), 100, (2, 5), (4, 9), True, False, False,
    ),
    "power": Archetype(
        "power", "전원", (4, 6), (60, 120), (50, 95), 2.0,
        (300, 900), (150, 300), 300, (0, 1), (2, 5), False, True, False,
        ("후동박 2oz",),
    ),
    "sensor": Archetype(
        "sensor", "센서", (2, 4), (18, 45), (14, 38), 1.0,
        (90, 340), (100, 150), 200, (0, 1), (1, 2), False, False, True,
    ),
    "rf": Archetype(
        "rf", "RF", (4, 8), (40, 85), (30, 62), 1.0,
        (340, 1100), (75, 120), 150, (0, 2), (2, 4), True, False, False,
        ("임피던스 관리", "저손실 기판",),
    ),
    "interface": Archetype(
        "interface", "인터페이스", (4, 8), (70, 130), (45, 85), 1.6,
        (800, 2200), (90, 130), 200, (1, 2), (6, 14), False, False, False,
    ),
    "flex": Archetype(
        "flex", "플렉스", (2, 4), (90, 210), (16, 34), 0.4,
        (70, 260), (100, 160), 150, (0, 1), (2, 4), False, False, True,
        ("리지드플렉스",),
    ),
    "display": Archetype(
        "display", "디스플레이 드라이버", (6, 8), (55, 105), (35, 70), 1.2,
        (600, 1800), (50, 80), 100, (1, 3), (3, 6), True, False, False,
        ("미세피치 조립",),
    ),
}

STACKUP_PATTERNS = {
    2: "SS",
    4: "SGPS",
    6: "SGSSPS",
    8: "SGSPGSGS",
    10: "SGSSGPSSGS",
    12: "SGSSGPPGSSGS",
}
ROLE_OF = {"S": LayerRole.SIGNAL, "G": LayerRole.PLANE_GND, "P": LayerRole.PLANE_POWER}

MATERIALS = ["FR-4 Std", "FR-4 High-Tg", "Megaflex-6", "Nelco-4000", "Isola-370HR"]
FINISHES = ["ENIG", "OSP", "HASL(무연)", "ENEPIG", "침지 은"]
TOOLS = [("Allegro", "17.4"), ("Allegro", "22.1"), ("CR-8000", "2022"), ("CR-8000", "2024"), ("Xpedition", "VX.2.12")]

AUTHORS = ["김도현", "이서준", "박민지", "최수빈", "정하윤", "윤지호", "장서연", "임태경", "한가온", "오세림"]

BUS_NAMES = [
    "DDR_DQ", "DDR_DQS", "DDR_ADDR", "SPI_MOSI", "SPI_MISO", "SPI_CLK", "I2C_SDA", "I2C_SCL",
    "UART_TX", "UART_RX", "USB_DP", "USB_DM", "LVDS_TX", "MIPI_D", "PCIE_TX", "PCIE_RX",
    "GPIO", "ADC_IN", "PWM", "CLK", "RESET_N", "IRQ_N", "SDIO_D", "ETH_TXD", "ETH_RXD", "CAN_H",
]
POWER_RAILS = ["VDD_3V3", "VDD_1V8", "VDD_1V2", "VDD_CORE", "VDD_5V", "AVDD_3V3", "VDD_DDR", "VBAT"]

DRC_RULES = [
    ("Minimum Clearance", Severity.WARNING, "트레이스 간 간격이 룰보다 {v} µm 부족"),
    ("Silkscreen Over Pad", Severity.WARNING, "실크가 패드를 덮음"),
    ("Acid Trap", Severity.INFO, "예각 배선으로 산 고임 가능"),
    ("Unrouted Net", Severity.ERROR, "미배선 넷"),
    ("Annular Ring", Severity.WARNING, "애뉼러 링 부족"),
    ("Component Courtyard Overlap", Severity.ERROR, "부품 외곽 간섭"),
    ("Via Under Pad", Severity.INFO, "패드 하부 비아 — 조립 검토 필요"),
]


# ── 보드 대장 ─────────────────────────────────────────────────────


@dataclass
class BoardSpec:
    board_key: str
    name: str
    project: str
    family: str
    archetype: str
    owner: str
    tags: tuple[str, ...]
    revisions: int
    status: LifecycleStatus
    first_year: int


BOARD_SPECS = [
    BoardSpec("TTN-MAIN-A1", "Titan 메인 보드", "TITAN", "Titan", "main_logic", "김도현", ("양산", "핵심"), 4, LifecycleStatus.RELEASED, 2023),
    BoardSpec("TTN-MAIN-A2", "Titan 메인 보드 (2세대)", "TITAN", "Titan", "main_logic", "김도현", ("개발",), 3, LifecycleStatus.REVIEW, 2025),
    BoardSpec("TTN-PWR-B1", "Titan 전원 보드", "TITAN", "Titan", "power", "이서준", ("양산",), 3, LifecycleStatus.RELEASED, 2023),
    BoardSpec("TTN-IF-C1", "Titan I/O 확장 보드", "TITAN", "Titan", "interface", "박민지", ("양산",), 2, LifecycleStatus.RELEASED, 2024),
    BoardSpec("TTN-SNS-D1", "Titan 온도 센서 모듈", "TITAN", "Titan", "sensor", "최수빈", (), 2, LifecycleStatus.RELEASED, 2024),
    BoardSpec("TTN-FLX-E1", "Titan 힌지 플렉스", "TITAN", "Titan", "flex", "정하윤", ("리지드플렉스",), 2, LifecycleStatus.REVIEW, 2025),
    BoardSpec("ORN-MAIN-A1", "Orion 컨트롤러", "ORION", "Orion", "main_logic", "윤지호", ("양산", "핵심"), 3, LifecycleStatus.RELEASED, 2022),
    BoardSpec("ORN-MAIN-A2", "Orion 컨트롤러 리비전 2", "ORION", "Orion", "main_logic", "윤지호", ("양산",), 2, LifecycleStatus.RELEASED, 2024),
    BoardSpec("ORN-PWR-B1", "Orion 파워 스테이지", "ORION", "Orion", "power", "이서준", ("양산", "후동박"), 3, LifecycleStatus.RELEASED, 2022),
    BoardSpec("ORN-PWR-B2", "Orion 파워 스테이지 개선", "ORION", "Orion", "power", "이서준", ("개발",), 1, LifecycleStatus.DRAFT, 2026),
    BoardSpec("ORN-RF-F1", "Orion 무선 모듈", "ORION", "Orion", "rf", "장서연", ("인증완료",), 3, LifecycleStatus.RELEASED, 2023),
    BoardSpec("ORN-IF-C1", "Orion 백플레인", "ORION", "Orion", "interface", "박민지", ("양산",), 2, LifecycleStatus.RELEASED, 2023),
    BoardSpec("VTX-MAIN-A1", "Vertex 연산 보드", "VERTEX", "Vertex", "main_logic", "임태경", ("개발", "고밀도"), 3, LifecycleStatus.REVIEW, 2025),
    BoardSpec("VTX-DSP-G1", "Vertex 디스플레이 드라이버", "VERTEX", "Vertex", "display", "한가온", ("개발",), 2, LifecycleStatus.DRAFT, 2025),
    BoardSpec("VTX-PWR-B1", "Vertex 전원 보드", "VERTEX", "Vertex", "power", "오세림", ("개발",), 2, LifecycleStatus.REVIEW, 2025),
    BoardSpec("VTX-SNS-D1", "Vertex IMU 모듈", "VERTEX", "Vertex", "sensor", "최수빈", (), 1, LifecycleStatus.DRAFT, 2026),
    BoardSpec("HLO-MAIN-A1", "Halo 본체 보드", "HALO", "Halo", "main_logic", "김도현", ("단종",), 3, LifecycleStatus.OBSOLETE, 2021),
    BoardSpec("HLO-IF-C1", "Halo 커넥터 보드", "HALO", "Halo", "interface", "박민지", ("단종",), 2, LifecycleStatus.OBSOLETE, 2021),
    BoardSpec("HLO-DSP-G1", "Halo 패널 인터페이스", "HALO", "Halo", "display", "한가온", ("단종",), 2, LifecycleStatus.OBSOLETE, 2022),
    BoardSpec("MRD-MAIN-A1", "Meridian 게이트웨이", "MERIDIAN", "Meridian", "main_logic", "윤지호", ("양산",), 3, LifecycleStatus.RELEASED, 2024),
    BoardSpec("MRD-RF-F1", "Meridian LTE 모듈", "MERIDIAN", "Meridian", "rf", "장서연", ("인증완료", "양산"), 2, LifecycleStatus.RELEASED, 2024),
    BoardSpec("MRD-RF-F2", "Meridian Wi-Fi 6E 모듈", "MERIDIAN", "Meridian", "rf", "장서연", ("개발",), 2, LifecycleStatus.REVIEW, 2026),
    BoardSpec("MRD-PWR-B1", "Meridian PoE 전원", "MERIDIAN", "Meridian", "power", "오세림", ("양산",), 2, LifecycleStatus.RELEASED, 2024),
    BoardSpec("MRD-SNS-D1", "Meridian 환경 센서", "MERIDIAN", "Meridian", "sensor", "최수빈", (), 2, LifecycleStatus.RELEASED, 2025),
    BoardSpec("KSL-MAIN-A1", "Kestrel 소형 제어기", "KESTREL", "Kestrel", "main_logic", "임태경", ("개발",), 2, LifecycleStatus.REVIEW, 2026),
    BoardSpec("KSL-FLX-E1", "Kestrel 액추에이터 플렉스", "KESTREL", "Kestrel", "flex", "정하윤", ("개발",), 1, LifecycleStatus.DRAFT, 2026),
    BoardSpec("KSL-IF-C1", "Kestrel 센서 허브", "KESTREL", "Kestrel", "interface", "박민지", ("개발",), 2, LifecycleStatus.DRAFT, 2026),
    BoardSpec("KSL-DSP-G1", "Kestrel OLED 드라이버", "KESTREL", "Kestrel", "display", "한가온", ("개발",), 1, LifecycleStatus.DRAFT, 2026),
    BoardSpec("ORN-SNS-D2", "Orion 전류 센서", "ORION", "Orion", "sensor", "최수빈", ("양산",), 2, LifecycleStatus.RELEASED, 2023),
    BoardSpec("TTN-RF-F1", "Titan BLE 모듈", "TITAN", "Titan", "rf", "장서연", ("양산",), 3, LifecycleStatus.RELEASED, 2023),
]


# ── 설계 생성 ─────────────────────────────────────────────────────


def make_outline(arch: Archetype, w_nm: int, h_nm: int, rng: random.Random) -> list[Polygon]:
    """직사각형 또는 모서리를 자른 이형 보드. 컷아웃은 가끔 넣는다."""
    polys: list[Polygon] = []
    if arch.shaped and rng.random() < 0.75:
        notch = int(min(w_nm, h_nm) * rng.uniform(0.15, 0.3))
        polys.append(Polygon(points_nm=[
            0, 0, w_nm, 0, w_nm, h_nm - notch, w_nm - notch, h_nm, 0, h_nm,
        ], is_cutout=False))
    else:
        polys.append(Polygon(points_nm=[0, 0, w_nm, 0, w_nm, h_nm, 0, h_nm], is_cutout=False))

    if rng.random() < 0.25:
        cw, ch = int(w_nm * 0.12), int(h_nm * 0.15)
        cx, cy = int(w_nm * 0.62), int(h_nm * 0.55)
        polys.append(Polygon(points_nm=[cx, cy, cx + cw, cy, cx + cw, cy + ch, cx, cy + ch], is_cutout=True))
    return polys


def build_stackup(n_cond: int, thickness_nm: int, arch: Archetype, rng: random.Random) -> list[StackupLayer]:
    pattern = STACKUP_PATTERNS.get(n_cond) or ("S" + "G" * (n_cond - 2) + "S")
    copper_um = 70.0 if arch.heavy_copper else 35.0
    material = rng.choice(MATERIALS if not arch.special else MATERIALS[:3])

    layers: list[StackupLayer] = []
    idx = 1

    def add(name: str, source: str, role: LayerRole, thick_nm: int, **kw) -> None:
        nonlocal idx
        layers.append(StackupLayer(index=idx, name=name, source_name=source, role=role, thickness_nm=thick_nm, **kw))
        idx += 1

    add("Silk Top", "SILKSCREEN_TOP", LayerRole.SILK, 15 * NM_PER_UM)
    add("Mask Top", "SOLDERMASK_TOP", LayerRole.MASK, 20 * NM_PER_UM)

    copper_total = int(copper_um * NM_PER_UM) * n_cond
    dielectric_total = max(thickness_nm - copper_total, n_cond * 50 * NM_PER_UM)
    per_dielectric = dielectric_total // max(n_cond - 1, 1)

    for i, code in enumerate(pattern[:n_cond], start=1):
        role = ROLE_OF[code]
        is_plane = role in (LayerRole.PLANE_GND, LayerRole.PLANE_POWER)
        add(
            f"L{i}", f"LAYER_{i}", role, int(copper_um * NM_PER_UM),
            material="동박",
            copper_weight_um=copper_um,
            copper_area_ratio=round(rng.uniform(0.82, 0.96) if is_plane else rng.uniform(0.24, 0.58), 3),
            impedance_single_ohm=50.0 if role == LayerRole.SIGNAL else None,
            impedance_diff_ohm=(90.0 if arch.key in ("rf", "display", "main_logic") else 100.0) if role == LayerRole.SIGNAL else None,
            routed_net_count=None,
        )
        if i < n_cond:
            add(
                f"D{i}", f"DIELECTRIC_{i}", LayerRole.DIELECTRIC, per_dielectric,
                material=material,
                dk=round(rng.uniform(3.3, 4.5), 2),
                df=round(rng.uniform(0.004, 0.021), 4),
            )

    add("Mask Bottom", "SOLDERMASK_BOT", LayerRole.MASK, 20 * NM_PER_UM)
    add("Silk Bottom", "SILKSCREEN_BOT", LayerRole.SILK, 15 * NM_PER_UM)
    return layers


def make_pins(spec: PartSpec, x: int, y: int, rng: random.Random) -> list[Pin]:
    """패키지 모양에 맞춰 핀 좌표를 만든다. 정밀할 필요는 없고 개수와 배치 경향만 맞으면 된다."""
    n = spec.pins
    pitch = (spec.pitch_um or 500) * NM_PER_UM
    pins: list[Pin] = []

    if n <= 2:
        gap = 500 * NM_PER_UM if spec.package.startswith("02") else 800 * NM_PER_UM
        for i in range(n):
            pins.append(Pin(name=str(i + 1), x_nm=x + (gap if i else -gap), y_nm=y))
        return pins

    if "BGA" in spec.package or "CSP" in spec.package:
        side = int(math.isqrt(n))
        half = (side - 1) * pitch // 2
        for i in range(n):
            r, c = divmod(i, side)
            pins.append(Pin(
                name=f"{chr(ord('A') + r % 26)}{c + 1}",
                x_nm=x - half + c * pitch,
                y_nm=y - half + r * pitch,
            ))
        return pins

    # 나머지는 둘레 배치 (QFN/QFP/SOIC/커넥터)
    per_side = max(n // 4, 1)
    half = per_side * pitch // 2
    for i in range(n):
        edge, k = divmod(i, per_side)
        off = -half + k * pitch
        if edge == 0:
            px, py = x - half, y + off
        elif edge == 1:
            px, py = x + off, y - half
        elif edge == 2:
            px, py = x + half, y + off
        else:
            px, py = x + off, y + half
        pins.append(Pin(name=str(i + 1), x_nm=px, y_nm=py))
    return pins


def place_components(
    arch: Archetype, w_nm: int, h_nm: int, count: int, rng: random.Random, scope: str
) -> list[Component]:
    """부품을 겹치지 않게 놓는다.

    큰 IC 를 먼저 중앙에, 커넥터를 가장자리에 두고, 나머지를 빈 칸에 채워 넣는다.
    점유 격자를 쓰는 이유는 배치도가 몸통 사각형을 그리기 때문이다 — 겹친 채로 그리면
    그림이 실제 보드처럼 보이지 않고 배치 밀도도 거짓말이 된다.

    `scope` 는 부품번호를 나누는 경계(프로젝트 키)다. 수동 소자는 값이 같으면 어느 보드든
    같은 부품번호를 쓰지만, IC 와 커넥터는 설계마다 다른 품번이다 — 이걸 구분하지 않으면
    모든 보드가 같은 BGA 를 쓰는 것이 되어 부품 재사용률이 100%로 나온다.
    """
    occ = Occupancy(w_nm, h_nm)
    counters: dict[str, int] = {}
    out: list[Component] = []

    def next_ref(prefix: str) -> str:
        counters[prefix] = counters.get(prefix, 0) + 1
        return f"{prefix}{counters[prefix]}"

    def emit(
        spec: PartSpec, x: int | None, y: int | None, side: Side, rotation: int | None = None
    ) -> bool:
        """x, y 가 None 이면 빈 칸을 찾아 채운다 (수동 소자 채우기)."""
        rot = rng.choice([0, 90_000, 180_000, 270_000]) if rotation is None else rotation
        bw, bh = body_size(spec.package)
        rw, rh = rotated(bw, bh, rot)
        spot = occ.find(rw, rh) if x is None or y is None else jitter_into(occ, x, y, rw, rh, rng)
        if spot is None:
            return False  # 자리가 없으면 놓지 않는다. 억지로 겹쳐 두지 않는다.
        px, py = spot

        if spec.values:
            value = rng.choice(spec.values)
            part_number = mpn_for(spec, value, rng)
        else:
            # IC·커넥터: 프로젝트 안에서만 공유된다. 변종 수를 넉넉히 둬야 보드마다
            # 부품 구성이 달라지고, 그래야 재사용률과 역검색이 의미를 갖는다.
            value = None
            part_number = mpn_for(spec, f"{scope}#{rng.randint(1, 12)}", rng)

        out.append(Component(
            refdes=next_ref(spec.prefix),
            part_number=part_number,
            manufacturer=spec.maker or None,
            value=value,
            package=spec.package,
            x_nm=px, y_nm=py,
            rotation_mdeg=rot,
            side=side,
            body_w_nm=bw, body_h_nm=bh,
            height_nm=rng.randint(400, 3200) * NM_PER_UM,
            pin_pitch_nm=(spec.pitch_um * NM_PER_UM) if spec.pitch_um else None,
            pins=make_pins(spec, px, py, rng),
        ))
        return True

    n_big = rng.randint(*arch.big_ics)
    for i in range(n_big):
        spec = rng.choice(BIG_ICS if arch.key != "sensor" else BIG_ICS[:2])
        fx = (i + 1) / (n_big + 1)
        emit(spec, int(w_nm * fx), int(h_nm * rng.uniform(0.38, 0.62)), Side.TOP, rotation=0)

    for i in range(rng.randint(*arch.connectors)):
        spec = rng.choice(CONNECTORS)
        bw, bh = body_size(spec.package)
        edge = i % 4
        # 커넥터는 가장자리에 붙되 긴 변이 그 변과 나란하도록 돌린다
        if edge in (0, 2):
            rot = 0
            x = rng.randint(w_nm // 6, w_nm * 5 // 6)
            y = bh // 2 + NM_PER_MM if edge == 0 else h_nm - bh // 2 - NM_PER_MM
        else:
            rot = 90_000
            x = bh // 2 + NM_PER_MM if edge == 3 else w_nm - bh // 2 - NM_PER_MM
            y = rng.randint(h_nm // 6, h_nm * 5 // 6)
        emit(spec, x, y, Side.TOP if rng.random() < 0.8 else Side.BOTTOM, rotation=rot)

    # 남은 부품 목록을 먼저 만들고 섞는다. IC 를 앞에 몰아 놓으면 그것들이 면적을
    # 선점해 수동 소자가 들어갈 자리가 없어진다 — 실제 보드는 IC 주변을 수동 소자가
    # 둘러싸는 모양이라, 섞어 놓는 편이 결과도 실제에 가깝다.
    remaining = max(count - len(out), 0)
    bill: list[PartSpec] = []
    for i in range(remaining):
        r = rng.random()
        if r < 0.07:
            bill.append(rng.choices(SMALL_ICS, weights=SMALL_IC_WEIGHTS)[0])
        elif r < 0.20:
            bill.append(rng.choice(DISCRETES + MISC))
        else:
            bill.append(rng.choice(PASSIVES))
    rng.shuffle(bill)

    # 자리가 다 차면 남은 부품은 놓지 않는다 — 실제 보드도 면적이 부품 수의 상한이다.
    # 큰 부품 하나가 안 들어간다고 바로 멈추지는 않는다. 작은 것은 아직 들어갈 수 있다.
    misses = 0
    for spec in bill:
        if emit(spec, None, None, Side.TOP if rng.random() < 0.78 else Side.BOTTOM):
            misses = 0
        else:
            misses += 1
            if misses >= 16:
                break

    return out


def build_nets(components: list[Component], n_cond: int, arch: Archetype, rng: random.Random) -> list[Net]:
    """핀 풀을 GND · 전원 레일 · 신호 넷으로 나눈다.

    실제 보드에서 GND가 전체 핀의 4분의 1 안팎을 가져가는 분포를 흉내낸다. 그래야
    넷 수와 핀 수의 비율, 넷별 핀 수 분포가 그럴듯해진다.
    """
    # (핀 참조, x, y). 좌표를 들고 다녀야 신호 넷을 공간적으로 묶을 수 있다.
    pool = [(NetPinRef(refdes=c.refdes, pin_name=p.name), p.x_nm, p.y_nm) for c in components for p in c.pins]
    rng.shuffle(pool)
    if not pool:
        return []

    signal_layers = [i for i in range(1, n_cond + 1)]
    nets: list[Net] = []
    cursor = 0

    def length_for(pin_count: int) -> tuple[int, list[LayerLength]]:
        total = int(rng.uniform(4, 55) * pin_count * NM_PER_MM / 3)
        n_layers = min(rng.randint(1, 3), len(signal_layers))
        picked = rng.sample(signal_layers, n_layers)
        parts, rest = [], total
        for i, layer in enumerate(picked):
            share = rest if i == len(picked) - 1 else int(rest * rng.uniform(0.3, 0.7))
            parts.append(LayerLength(layer_index=layer, length_nm=share))
            rest -= share
        return total, parts

    def take(n: int) -> list[NetPinRef]:
        nonlocal cursor
        chunk = [ref for ref, _, _ in pool[cursor:cursor + n]]
        cursor += n
        return chunk

    def add(name: str, pins: list[NetPinRef], net_class: str | None, partner: str | None = None) -> None:
        if not pins:
            return
        total, by_layer = length_for(len(pins))
        nets.append(Net(
            name=name, pins=pins, net_class=net_class, diff_partner=partner,
            length_nm=total, length_by_layer=by_layer,
            via_count=int(len(pins) * rng.uniform(0.4, 1.8)),
            width_nm=rng.randint(*arch.min_trace_um) * NM_PER_UM,
            unrouted=rng.random() < 0.012,
        ))

    add("GND", take(int(len(pool) * 0.25)), "ground")

    rails = POWER_RAILS[: max(2, min(len(POWER_RAILS), n_cond))]
    rail_budget = int(len(pool) * 0.16)
    for rail in rails:
        add(rail, take(max(rail_budget // len(rails), 2)), "power")

    # 남은 핀은 신호 넷이 된다. 여기서부터는 무작위로 뽑으면 안 된다 — 보드 양 끝의
    # 핀이 한 넷에 묶이면 배선이 기판을 가로지르고, 배선 길이 분포도 실제와 달라진다.
    # 굵은 격자로 나눈 뒤 뱀 모양으로 훑어 공간적으로 인접한 핀이 이웃하게 만든다.
    rest = pool[cursor:]
    if rest:
        xs = [x for _, x, _ in rest]
        ys = [y for _, _, y in rest]
        span_x = max(max(xs) - min(xs), 1)
        span_y = max(max(ys) - min(ys), 1)
        cells = 16
        min_x, min_y = min(xs), min(ys)

        def spatial_key(item: tuple[NetPinRef, int, int]) -> tuple[int, int]:
            _, x, y = item
            row = (y - min_y) * cells // (span_y + 1)
            col = (x - min_x) * cells // (span_x + 1)
            return (row, col if row % 2 == 0 else cells - col)

        rest.sort(key=spatial_key)
        pool[cursor:] = rest

    bus_idx: dict[str, int] = {}
    diff_pending: tuple[str, list[NetPinRef]] | None = None

    while cursor < len(pool):
        size = rng.choices([2, 3, 4, 6], weights=[62, 22, 11, 5])[0]
        pins = take(size)
        if not pins:
            break
        bus = rng.choice(BUS_NAMES)
        bus_idx[bus] = bus_idx.get(bus, -1) + 1
        base = f"{bus}{bus_idx[bus]}" if bus_idx[bus] or bus in ("DDR_DQ", "GPIO", "LVDS_TX", "MIPI_D") else bus

        is_diff = bus in ("LVDS_TX", "MIPI_D", "PCIE_TX", "PCIE_RX", "USB_DP", "DDR_DQS") and rng.random() < 0.7
        if is_diff and diff_pending is None:
            diff_pending = (f"{base}_P", pins)
            continue
        if diff_pending is not None:
            p_name, p_pins = diff_pending
            n_name = p_name[:-2] + "_N"
            add(p_name, p_pins, "differential", n_name)
            add(n_name, pins, "differential", p_name)
            diff_pending = None
            continue

        add(base, pins, "high_speed" if bus.startswith(("DDR", "PCIE", "LVDS", "MIPI")) else None)

    if diff_pending is not None:
        add(diff_pending[0], diff_pending[1], "differential")
    return nets


def build_design(spec: BoardSpec, rev_label: str, rng: random.Random, when: date) -> Design:
    arch = ARCHETYPES[spec.archetype]
    n_cond = rng.choice([n for n in STACKUP_PATTERNS if arch.layers[0] <= n <= arch.layers[1]] or [arch.layers[0]])
    w_nm = int(rng.uniform(*arch.width_mm) * NM_PER_MM)
    h_nm = int(rng.uniform(*arch.height_mm) * NM_PER_MM)
    thickness_nm = int(arch.thickness_mm * NM_PER_MM)

    components = place_components(arch, w_nm, h_nm, rng.randint(*arch.components), rng, spec.project)
    nets = build_nets(components, n_cond, arch, rng)

    min_trace = rng.randint(*arch.min_trace_um) * NM_PER_UM
    min_drill = arch.min_drill_um * NM_PER_UM
    bga_pitches = [c.pin_pitch_nm for c in components if "BGA" in c.package or "CSP" in c.package]

    via_total = max(int(sum(n.via_count for n in nets)), 1)
    vias = [ViaSpec(
        kind=ViaKind.THROUGH, from_layer=1, to_layer=n_cond,
        drill_nm=min_drill * 2, pad_nm=min_drill * 4, count=int(via_total * (0.55 if arch.advanced_via else 1.0)),
    )]
    if arch.advanced_via:
        vias.append(ViaSpec(kind=ViaKind.MICRO, from_layer=1, to_layer=2, drill_nm=min_drill, pad_nm=min_drill * 3, count=int(via_total * 0.3)))
        vias.append(ViaSpec(kind=ViaKind.BURIED, from_layer=2, to_layer=n_cond - 1, drill_nm=int(min_drill * 1.5), pad_nm=min_drill * 3, count=int(via_total * 0.15)))

    drills = [
        DrillEntry(diameter_nm=v.drill_nm, plated=True, kind=DrillKind.VIA, count=v.count) for v in vias
    ] + [
        DrillEntry(diameter_nm=int(2.2 * NM_PER_MM), plated=False, kind=DrillKind.MOUNTING, count=rng.choice([2, 4, 4, 6])),
        DrillEntry(diameter_nm=int(1.5 * NM_PER_MM), plated=False, kind=DrillKind.TOOLING, count=3),
    ]

    findings: list[DrcFinding] = []
    for _ in range(rng.choices([0, 1, 2, 3, 5, 9], weights=[30, 22, 18, 14, 10, 6])[0]):
        rule, sev, tmpl = rng.choice(DRC_RULES)
        findings.append(DrcFinding(
            rule=rule, severity=sev,
            message=tmpl.format(v=rng.randint(3, 40)),
            x_nm=rng.randint(0, w_nm), y_nm=rng.randint(0, h_nm),
            layer_index=rng.randint(1, n_cond),
            net_name=rng.choice(nets).name if nets else None,
            refdes=rng.choice(components).refdes if components else None,
        ))

    warnings: list[IngestWarning] = []
    if rng.random() < 0.3:
        warnings.append(IngestWarning(code="orphan_net", severity=Severity.WARNING, message="핀이 0개인 넷", count=rng.randint(1, 4)))
    if rng.random() < 0.15:
        warnings.append(IngestWarning(code="outline_not_closed", severity=Severity.WARNING, message="외형 폴리곤 미폐합 — 자동 폐합함", count=1))

    tool, tool_ver = rng.choice(TOOLS)
    header = DesignHeader(
        board_key=spec.board_key,
        board_name=spec.name,
        revision_label=rev_label,
        part_number=f"PCB-{spec.board_key}",
        project_key=spec.project,
        product_family=spec.family,
        author=spec.owner,
        designed_at=when.isoformat(),
        source_tool=tool,
        source_version=tool_ver,
        units_source=SourceUnits.MM,
        outline=make_outline(arch, w_nm, h_nm, rng),
        board_thickness_nm=thickness_nm,
        surface_finish=rng.choice(FINISHES),
        special_processes=list(arch.special),
    )

    stackup = build_stackup(n_cond, thickness_nm, arch, rng)

    design = Design(
        cdm_version=CDM_VERSION,
        parser_name=PARSER_NAME,
        parser_version=PARSER_VERSION,
        header=header,
        stackup=stackup,
        components=components,
        nets=nets,
        vias=vias,
        drills=drills,
        design_rules=DesignRules(
            min_trace_width_nm=min_trace,
            min_clearance_nm=int(min_trace * rng.uniform(0.9, 1.25)),
            min_drill_nm=min_drill,
            min_annular_ring_nm=int(min_drill * 0.4),
            max_aspect_ratio=round(thickness_nm / min_drill, 1),
            min_bga_pitch_nm=min(bga_pitches) if bga_pitches else None,
        ),
        drc_findings=findings,
        warnings=warnings,
    )
    fill_signatures(design)
    return design


# ── 리비전 파생 ───────────────────────────────────────────────────


def move_component(c: Component, dx: int, dy: int, w_nm: int, h_nm: int) -> None:
    """부품을 옮긴다. 핀도 같이 옮기고, 핀이 기판 밖으로 나가지 않게 조인다.

    핀을 함께 옮기지 않으면 부품 표는 "3mm 이동"이라고 하는데 뷰어의 패드는 제자리에
    남는다 — 두 화면이 같은 데이터를 다르게 말하게 되는, 눈에 잘 안 띄는 종류의 오류다.
    """
    reach_x = max((abs(p.x_nm - c.x_nm) for p in c.pins), default=0) + NM_PER_MM // 2
    reach_y = max((abs(p.y_nm - c.y_nm) for p in c.pins), default=0) + NM_PER_MM // 2
    nx = min(max(c.x_nm + dx, reach_x), max(w_nm - reach_x, reach_x))
    ny = min(max(c.y_nm + dy, reach_y), max(h_nm - reach_y, reach_y))
    ddx, ddy = nx - c.x_nm, ny - c.y_nm
    c.x_nm, c.y_nm = nx, ny
    for pin in c.pins:
        pin.x_nm += ddx
        pin.y_nm += ddy


def derive_revision(parent: Design, rev_label: str, rng: random.Random, when: date) -> Design:
    """부모 리비전을 변형해 자식을 만든다.

    Diff 엔진이 판정해야 할 모든 종류의 변경을 의도적으로 심는다 — 이동, 임계값 미만의
    미세 흔들림, 추가·삭제, 부품 치환, 넷 이름 변경(핀 집합 동일), 실제 회로 변경.
    Phase 3에서 이 데이터가 그대로 개발·검증 재료가 된다.
    """
    d = parent.model_copy(deep=True)
    d.header.revision_label = rev_label
    d.header.designed_at = when.isoformat()

    w_nm = max(p for poly in d.header.outline if not poly.is_cutout for p in poly.points_nm[0::2])
    h_nm = max(p for poly in d.header.outline if not poly.is_cutout for p in poly.points_nm[1::2])

    # 1) 실제 이동 — 재배치 검토 결과
    for c in rng.sample(d.components, min(len(d.components), rng.randint(3, 15))):
        move_component(c, rng.randint(-3_500_000, 3_500_000), rng.randint(-3_500_000, 3_500_000), w_nm, h_nm)
        if rng.random() < 0.25:
            c.rotation_mdeg = (c.rotation_mdeg + rng.choice([90_000, 180_000, 270_000])) % 360_000

    # 2) 임계값(10 µm) 미만의 흔들림 — CAD 재저장의 흔적. 변경으로 잡히면 안 된다.
    for c in rng.sample(d.components, min(len(d.components), rng.randint(5, 25))):
        move_component(c, rng.randint(-4_000, 4_000), rng.randint(-4_000, 4_000), w_nm, h_nm)

    # 3) 부품 치환 — 패키지는 그대로 두고 파트넘버만 바뀐다 (단종 대응의 전형적 모습)
    swappable = [c for c in d.components if c.part_number and c.value]
    for c in rng.sample(swappable, min(len(swappable), rng.randint(0, 3))):
        same_package = [s for s in PASSIVES + DISCRETES if s.package == c.package and s.values]
        if not same_package:
            continue
        spec = rng.choice(same_package)
        alternatives = [v for v in spec.values if v != c.value] or list(spec.values)
        c.value = rng.choice(alternatives)
        c.part_number = mpn_for(spec, c.value, rng)

    # 4) 부품 삭제
    for c in rng.sample(d.components, min(len(d.components), rng.randint(0, 4))):
        d.components.remove(c)
        for net in d.nets:
            net.pins = [p for p in net.pins if p.refdes != c.refdes]

    # 5) 부품 추가 — 기존 최대 번호 뒤에 붙인다
    for _ in range(rng.randint(0, 6)):
        spec = rng.choice(PASSIVES + DISCRETES)
        used = [int(c.refdes[len(spec.prefix):]) for c in d.components
                if c.refdes.startswith(spec.prefix) and c.refdes[len(spec.prefix):].isdigit()]
        refdes = f"{spec.prefix}{max(used, default=0) + 1}"
        x, y = rng.randint(2_000_000, w_nm - 2_000_000), rng.randint(2_000_000, h_nm - 2_000_000)
        value = rng.choice(spec.values) if spec.values else None
        bw, bh = body_size(spec.package)
        d.components.append(Component(
            refdes=refdes, part_number=mpn_for(spec, value or spec.package, rng),
            manufacturer=spec.maker or None, value=value, package=spec.package,
            x_nm=x, y_nm=y, rotation_mdeg=rng.choice([0, 90_000, 180_000, 270_000]),
            side=Side.TOP if rng.random() < 0.8 else Side.BOTTOM,
            body_w_nm=bw, body_h_nm=bh,
            height_nm=rng.randint(400, 1200) * NM_PER_UM, pin_pitch_nm=None,
            pins=make_pins(spec, x, y, rng),
        ))

    # 6~7) 넷 변경. 두 집단을 겹치지 않게 나눈다 — 이름만 바뀐 넷과 회로가 바뀐 넷이
    # 같은 넷이 되면 Diff 개발에서 두 판정을 따로 확인할 수 없다.
    signal_nets = [n for n in d.nets if n.net_class not in ("power", "ground") and len(n.pins) >= 2]
    rng.shuffle(signal_nets)
    renamed = signal_nets[:rng.randint(1, 2)]
    rewired = signal_nets[len(renamed):len(renamed) + rng.randint(1, 3)]

    # 6) 이름만 변경 — 핀 집합은 그대로. Diff 가 renamed 로 잡아야 하는 케이스.
    for n in renamed:
        n.name = f"{n.name}_R{rng.randint(2, 9)}"

    # 7) 실제 회로 변경 — 핀이 붙거나 떨어진다. Diff 가 rewired 로 잡아야 한다.
    for n in rewired:
        if rng.random() < 0.5 and len(n.pins) > 2:
            n.pins.pop(rng.randrange(len(n.pins)))
        elif d.components:
            c = rng.choice(d.components)
            if c.pins:
                n.pins.append(NetPinRef(refdes=c.refdes, pin_name=rng.choice(c.pins).name))

    # 8) 가끔 적층 사양 변경
    if rng.random() < 0.25:
        dielectrics = [l for l in d.stackup if l.role == LayerRole.DIELECTRIC]
        if dielectrics:
            layer = rng.choice(dielectrics)
            layer.thickness_nm = int(layer.thickness_nm * rng.uniform(0.85, 1.15))
            layer.material = rng.choice(MATERIALS)

    # 9) DRC 는 보통 개선된다
    if d.drc_findings:
        keep = max(0, len(d.drc_findings) - rng.randint(0, 3))
        d.drc_findings = d.drc_findings[:keep]

    for net in d.nets:
        net.length_nm = max(int(net.length_nm * rng.uniform(0.94, 1.08)), 1)

    fill_signatures(d)
    return d


# ── 픽스처 조립 ───────────────────────────────────────────────────


def emit_geometry(design: Design, rev_id: str, out_dir: Path, rng: random.Random) -> list[LayerGeometryRef]:
    """레이어별 .blg 를 쓰고 그것을 가리키는 참조를 돌려준다.

    참조에 담기는 객체 수와 바이트 수는 실제로 쓴 파일에서 나온다. 화면이 "이 리비전은
    기하 객체 4만 개"라고 말할 때 그 숫자가 진짜여야 뷰어 성능 목표를 가늠할 수 있다.
    """
    refs: list[LayerGeometryRef] = []
    for idx, g in sorted(synthesize(design, rng).items()):
        key = f"blg/{rev_id}/L{idx}.blg"
        size = blg.write(g, len(design.nets), out_dir / key)
        x0, y0, x1, y1 = g.bbox()
        refs.append(LayerGeometryRef(
            layer_index=idx,
            storage_key=key,
            object_count=g.object_count,
            byte_size=size,
            bbox=BBox(x0_nm=x0, y0_nm=y0, x1_nm=x1, y1_nm=y1),
            kind_counts=g.kind_counts(),
        ))
    return refs


def slug(text: str) -> str:
    return "".join(ch.lower() if ch.isalnum() else "-" for ch in text).strip("-")


def build_all(seed: int, out_dir: Path, golden_dir: Path) -> dict:
    rng = random.Random(seed)
    boards: list[Board] = []
    details: dict[str, RevisionDetail] = {}
    golden: list[tuple[str, Design]] = []
    changesets: dict[str, ChangeSet] = {}
    registry = PartRegistry()
    refs: list[ChangeSetRef] = []
    # 세대 비교(다른 보드의 같은 계열)를 위해 보드마다 최신 설계 하나만 남긴다.
    # 전부 들고 있으면 핀이 50만 개를 넘어 메모리를 낭비한다.
    latest_design: dict[str, tuple[BoardSpec, str, Design]] = {}

    for spec in BOARD_SPECS:
        lineage: list[RevisionRef] = []
        revisions: list[tuple[str, Design, datetime]] = []
        parent_design: Design | None = None
        parent_id: str | None = None
        when = date(spec.first_year, rng.randint(1, 12), rng.randint(1, 28))

        for i in range(spec.revisions):
            label = chr(ord("A") + i)
            rev_id = f"{slug(spec.board_key)}-{label.lower()}"
            design = (
                build_design(spec, label, rng, when)
                if parent_design is None
                else derive_revision(parent_design, label, rng, when)
            )
            created = datetime(when.year, when.month, when.day, rng.randint(9, 18), rng.randint(0, 59))

            lineage.append(RevisionRef(
                id=rev_id, label=f"Rev {label}",
                status=spec.status if i == spec.revisions - 1 else LifecycleStatus.RELEASED,
                created_at=created.isoformat(),
                parent_revision_id=parent_id,
                author=spec.owner,
                note=None if i == 0 else rng.choice([
                    "배치 재검토 반영", "EMI 대책 적용", "부품 단종 대응 치환",
                    "전원 임피던스 개선", "DRC 지적 사항 수정", "커넥터 위치 변경",
                ]),
            ))
            revisions.append((rev_id, design, created))
            parent_design, parent_id = design, rev_id
            when = when + timedelta(days=rng.randint(45, 400))

        # 리비전 상세 조립
        for i, (rev_id, design, created) in enumerate(revisions):
            design.layer_geometry = emit_geometry(design, rev_id, out_dir, rng)
            summary = summarize(design)
            status = spec.status if i == len(revisions) - 1 else LifecycleStatus.RELEASED
            revision = Revision(
                id=rev_id, board_id=slug(spec.board_key), board_key=spec.board_key,
                board_name=spec.name,
                label=f"Rev {design.header.revision_label}",
                parent_revision_id=lineage[i].parent_revision_id,
                status=status, ingest_state=IngestState.READY,
                author=spec.owner, designed_at=design.header.designed_at,
                created_at=created.isoformat(), note=lineage[i].note,
                source_tool=design.header.source_tool, source_version=design.header.source_version,
                parser_version=PARSER_VERSION, thumbnail_url=None, summary=summary,
            )
            registry.add_revision(
                design,
                revision_id=rev_id,
                revision_label=revision.label,
                board_key=spec.board_key,
                board_name=spec.name,
                status=status.value,
            )
            details[rev_id] = RevisionDetail(
                revision=revision,
                part_number=design.header.part_number,
                project_key=design.header.project_key,
                product_family=design.header.product_family,
                surface_finish=design.header.surface_finish,
                special_processes=design.header.special_processes or [],
                outline=design.header.outline,
                stackup=design.stackup,
                design_rules=design.design_rules,
                vias=design.vias,
                drills=design.drills,
                drc_findings=design.drc_findings,
                warnings=design.warnings,
                layer_geometry=design.layer_geometry,
                components=to_component_rows(design),
                nets=to_net_rows(design),
                files=[DesignFileRef(
                    id=f"{rev_id}-hkp", filename=f"{spec.board_key}_{design.header.revision_label}.hkp",
                    sha256="".join(rng.choice("0123456789abcdef") for _ in range(64)),
                    byte_size=rng.randint(6_000_000, 48_000_000),
                    uploaded_at=created.isoformat(), uploaded_by=spec.owner,
                    storage_key=f"design/{rev_id}.hkp", kind="design",
                )],
                lineage=lineage,
            )

        # 같은 보드의 모든 리비전 쌍. 실제 API 는 요청 시점에 계산하고 캐시하지만,
        # 목데이터에서는 미리 다 만들어 둔다 — 보드당 최대 6쌍이라 비용이 없다.
        for i in range(len(revisions)):
            for j in range(i + 1, len(revisions)):
                id_a, design_a, _ = revisions[i]
                id_b, design_b, _ = revisions[j]
                cs = diff(design_a, design_b, id_a, id_b)
                changesets[f"{id_a}__{id_b}"] = cs
                refs.append(ChangeSetRef(
                    revision_a_id=id_a, revision_b_id=id_b,
                    board_key=spec.board_key, board_name=spec.name,
                    label_a=details[id_a].revision.label, label_b=details[id_b].revision.label,
                    kind=ChangeSetKind.REVISION, generated_at=cs.generated_at, stats=cs.stats,
                ))

        last_id, last_design, last_created = revisions[-1]
        latest_design[spec.board_key] = (spec, last_id, last_design)
        boards.append(Board(
            id=slug(spec.board_key), project_key=spec.project, board_key=spec.board_key,
            name=spec.name, part_number=last_design.header.part_number,
            product_family=spec.family, owner=spec.owner, status=spec.status,
            source_tool=last_design.header.source_tool,
            tags=list(spec.tags), revision_count=len(revisions),
            latest_revision_id=last_id, latest_revision_label=f"Rev {last_design.header.revision_label}",
            created_at=revisions[0][2].isoformat(), updated_at=last_created.isoformat(),
            thumbnail_url=None, outline=last_design.header.outline,
            landmarks=pick_landmarks(details[last_id].components),
            summary=details[last_id].revision.summary,
        ))

        if len(golden) < 3:
            golden.append((revisions[0][0], revisions[0][1]))

    # 보드 간 비교 — 최신 리비전끼리 모든 조합.
    #
    # 사용자가 비교할 두 보드를 자유롭게 고르므로 미리 다 만들어 둔다. 리비전까지 전부
    # 조합하면 2,211쌍에 2.2 GB 라 불가능하고, 실제로 고르는 것은 "같은 보드의 두 리비전"
    # 아니면 "두 보드의 최신"이다. 실서버는 어느 조합이든 요청받은 자리에서 계산한다.
    #
    # 방향은 보드 코드 순으로 고정한다. 양방향을 다 만들면 크기가 두 배가 되고,
    # A→B 와 B→A 는 서로 뒤집은 것이라 한쪽만 있어도 읽을 수 있다.
    latest_keys = sorted(latest_design)
    for i in range(len(latest_keys)):
        for j in range(i + 1, len(latest_keys)):
            spec_a, id_a, design_a = latest_design[latest_keys[i]]
            spec_b, id_b, design_b = latest_design[latest_keys[j]]
            cs = diff(design_a, design_b, id_a, id_b)
            changesets[f"{id_a}__{id_b}"] = cs
            refs.append(ChangeSetRef(
                revision_a_id=id_a, revision_b_id=id_b,
                board_key=spec_a.board_key, board_name=spec_a.name, board_key_b=spec_b.board_key,
                label_a=f"{spec_a.board_key} {details[id_a].revision.label}",
                label_b=f"{spec_b.board_key} {details[id_b].revision.label}",
                kind=ChangeSetKind.GENERATION, generated_at=cs.generated_at, stats=cs.stats,
            ))

    # ── 부품 마스터와 수명 상태 ──
    part_rows = registry.parts()
    life_rng = random.Random(seed ^ 0x5EED)
    for part in part_rows:
        part.lifecycle = life_rng.choices(
            [k for k, _ in LIFECYCLE_WEIGHTS], weights=[w for _, w in LIFECYCLE_WEIGHTS]
        )[0]

    # 파셋 집계
    def tally(values) -> dict[str, int]:
        out: dict[str, int] = {}
        for v in values:
            if v:
                out[str(v)] = out.get(str(v), 0) + 1
        return dict(sorted(out.items(), key=lambda kv: (-kv[1], kv[0])))

    def span(values) -> RangeFacet:
        vals = list(values) or [0]
        return RangeFacet(min=min(vals), max=max(vals))

    page = BoardPage(
        items=sorted(boards, key=lambda b: b.updated_at, reverse=True),
        total=len(boards), offset=0, limit=len(boards),
        facets=CatalogFacets(
            product_family=tally(b.product_family for b in boards),
            status=tally(b.status.value for b in boards),
            owner=tally(b.owner for b in boards),
            source_tool=tally(details[b.latest_revision_id].revision.source_tool for b in boards),
            tags=tally(t for b in boards for t in b.tags),
            layer_count=span(b.summary.layer_count for b in boards),
            area_mm2=span(b.summary.area_mm2 for b in boards),
            component_count=span(b.summary.component_count for b in boards),
            min_trace_width_nm=span(b.summary.min_trace_width_nm for b in boards),
        ),
    )

    # 쓰기
    (out_dir / "revisions").mkdir(parents=True, exist_ok=True)
    golden_dir.mkdir(parents=True, exist_ok=True)

    def dump(path: Path, model) -> int:
        # exclude_none: 생성 타입이 옵셔널 필드를 `?: T | null` 로 내므로 null 키를
        # 통째로 빼도 프론트 계약이 깨지지 않는다. 픽스처 크기가 절반 아래로 준다.
        text = model.model_dump_json(indent=None, exclude_none=True)
        path.write_text(text, encoding="utf-8")
        return len(text)

    (out_dir / "changesets").mkdir(parents=True, exist_ok=True)
    total_bytes = dump(out_dir / "catalog.json", page)
    for rev_id, detail in details.items():
        total_bytes += dump(out_dir / "revisions" / f"{rev_id}.json", detail)
    for pair_key, cs in changesets.items():
        total_bytes += dump(out_dir / "changesets" / f"{pair_key}.json", cs)
    total_bytes += dump(
        out_dir / "changesets" / "index.json",
        ChangeSetIndex(pairs=refs, move_threshold_nm=DEFAULT_MOVE_THRESHOLD_NM),
    )

    # ── 분석 산출물 ──
    (out_dir / "parts").mkdir(parents=True, exist_ok=True)
    now = datetime.now().isoformat(timespec="seconds")
    total_bytes += dump(out_dir / "parts" / "index.json", PartIndex(generated_at=now, parts=part_rows))
    for part in part_rows:
        total_bytes += dump(
            out_dir / "parts" / f"{part.id}.json",
            PartDetail(part=part, usages=registry.usages(part.id)),
        )

    unique, reused, ratio = registry.reuse_ratio()
    total_bytes += dump(
        out_dir / "insights.json",
        portfolio.build(
            [d.revision for d in details.values()],
            first_seen_year={b.board_key: int(b.created_at[:4]) for b in boards},
            part_count=unique,
            reused_part_count=reused,
            reuse_ratio=ratio,
            top_parts=part_rows[:12],
        ),
    )
    for rev_id, design in golden:
        dump(golden_dir / f"{rev_id}.cdm.json", design)

    manifest = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "seed": seed,
        "cdm_version": CDM_VERSION,
        "parser_version": PARSER_VERSION,
        "board_count": len(boards),
        "revision_count": len(details),
        "component_total": sum(d.revision.summary.component_count for d in details.values()),
        "net_total": sum(d.revision.summary.net_count for d in details.values()),
        "part_count": len(part_rows),
        "changeset_count": len(changesets),
        "bytes": total_bytes,
    }
    (out_dir / "index.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--seed", type=int, default=20260830)
    ap.add_argument("--out", type=Path, default=ROOT / "web" / "public" / "mock")
    ap.add_argument("--golden", type=Path, default=ROOT / "backend" / "boardlens" / "parser" / "fixtures")
    args = ap.parse_args()

    manifest = build_all(args.seed, args.out, args.golden)
    print(f"보드 {manifest['board_count']}개 · 리비전 {manifest['revision_count']}개")
    print(f"부품 누계 {manifest['component_total']:,} · 넷 누계 {manifest['net_total']:,} · 고유 부품 {manifest['part_count']}종")
    print(f"비교 {manifest['changeset_count']}쌍 (같은 보드의 리비전 쌍 + 보드 간 최신 쌍)")
    print(f"픽스처 {manifest['bytes'] / 1_048_576:.1f} MB -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
