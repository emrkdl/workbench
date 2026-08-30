"""단위 규약.

내부 저장과 연산은 전부 정수 나노미터(nm)와 1/1000도(mdeg)로 한다. 부동소수를 쓰면
두 리비전의 좌표를 뺐을 때 0.09999999 같은 값이 나오고, 그러면 아무것도 바뀌지 않은
부품이 "이동함"으로 잡힌다. 정수로 두면 비교가 정확히 == 로 성립한다.

mm/mil 변환은 표시 직전에만 한다. 이 모듈의 to_* 함수는 UI 응답을 만들 때만 쓰고,
저장·비교·집계 경로에서는 부르지 않는다.
"""

from __future__ import annotations

NM_PER_UM = 1_000
NM_PER_MM = 1_000_000
NM_PER_MIL = 25_400
NM_PER_INCH = 25_400_000

MDEG_PER_DEG = 1_000

#: 이 값 미만의 부품 이동은 변경으로 판정하지 않는다. CAD 재저장만으로도
#: 하위 자릿수는 흔들리기 때문이다. 비교 화면에서 조정 가능하게 노출한다.
DEFAULT_MOVE_THRESHOLD_NM = 10 * NM_PER_UM

_SOURCE_UNIT_TO_NM = {
    "nm": 1.0,
    "um": float(NM_PER_UM),
    "mm": float(NM_PER_MM),
    "mil": float(NM_PER_MIL),
    "inch": float(NM_PER_INCH),
}


def from_source(value: float, units: str) -> int:
    """원본 파일 단위의 길이를 정수 나노미터로 옮긴다. 파서의 유일한 입구다."""
    try:
        factor = _SOURCE_UNIT_TO_NM[units]
    except KeyError:
        raise ValueError(f"알 수 없는 원본 단위: {units!r}") from None
    return round(value * factor)


def to_mm(nm: int) -> float:
    return nm / NM_PER_MM


def to_mil(nm: int) -> float:
    return nm / NM_PER_MIL


def to_um(nm: int) -> float:
    return nm / NM_PER_UM


def area_mm2(nm2: int) -> float:
    """제곱 나노미터를 제곱 밀리미터로. 면적은 nm² 로 두면 int64를 넘기 쉬워 float 로 낸다."""
    return nm2 / (NM_PER_MM * NM_PER_MM)


def to_deg(mdeg: int) -> float:
    return mdeg / MDEG_PER_DEG


def normalize_angle(mdeg: int) -> int:
    """0 이상 360000 미만으로 정규화한다."""
    return mdeg % (360 * MDEG_PER_DEG)


def format_length(nm: int, unit: str = "mm") -> str:
    """표시용 문자열. mm 는 소수 3자리(=µm 해상도), mil 은 1자리."""
    if unit == "mil":
        return f"{to_mil(nm):.1f} mil"
    if unit == "um":
        return f"{to_um(nm):.1f} µm"
    return f"{to_mm(nm):.3f} mm"
