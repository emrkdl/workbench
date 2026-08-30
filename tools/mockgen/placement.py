"""부품 몸통 크기와 겹치지 않는 배치.

배치도(뷰어의 '배치' 모드)는 핀이 아니라 **몸통 사각형**을 그린다. 그래서 목데이터도
몸통 크기를 갖고 있어야 하고, 무엇보다 서로 겹치지 않아야 한다 — 겹친 배치를 그리면
그림이 실제 보드처럼 보이지 않고, 배치 밀도 같은 숫자도 의미를 잃는다.

여기서 하는 것은 자동 배치가 아니다. 빈 칸을 찾아 채워 넣는 정도이고, 실제 배치기가
푸는 문제(넷 길이 최소화, 열, 커플링)는 손대지 않는다.
"""

from __future__ import annotations

import random

from boardlens.units import NM_PER_MM, NM_PER_UM

MM = NM_PER_MM

#: 패키지별 몸통 크기(mm). 실제 부품 규격에 가깝게 잡았다 — 배치 밀도와 그림이
#: 동시에 그럴듯해지려면 이 표가 현실적이어야 한다.
BODY_MM: dict[str, tuple[float, float]] = {
    "0201": (0.6, 0.3),
    "0402": (1.0, 0.5),
    "0603": (1.6, 0.8),
    "0805": (2.0, 1.25),
    "SOD-123": (3.68, 1.77),
    "SOD-323": (2.5, 1.35),
    "SOT-23": (2.9, 1.3),
    "SOT-223": (6.5, 3.5),
    "SOIC-8": (4.9, 3.9),
    "TSSOP-20": (6.5, 4.4),
    "QFN-24": (4.0, 4.0),
    "QFN-32": (5.0, 5.0),
    "QFN-48": (7.0, 7.0),
    "QFN-64": (9.0, 9.0),
    "LQFP-64": (10.0, 10.0),
    "LQFP-100": (14.0, 14.0),
    "WLCSP-36": (2.6, 2.6),
    "LFBGA-196": (12.0, 12.0),
    "BGA-256": (14.0, 14.0),
    "BGA-484": (19.0, 19.0),
    "BGA-676": (21.0, 21.0),
    "CONN-FPC-40": (22.0, 3.0),
    "CONN-B2B-60": (14.0, 3.0),
    "CONN-USB-C": (9.0, 7.3),
    "CONN-HDR-10": (13.0, 5.0),
    "XTAL-3225": (3.2, 2.5),
    "TP-1": (1.0, 1.0),
}

DEFAULT_BODY_MM = (2.0, 2.0)

#: 부품 사이 최소 간격. 고밀도 보드의 실제 값에 가깝게 둔다 — 여기를 넉넉히 잡으면
#: 배치가 성기게 나오고, 실제 스마트폰 기판(30개/cm² 이상)과 그림이 달라진다.
KEEPOUT_NM = 130 * NM_PER_UM


def body_size(package: str) -> tuple[int, int]:
    w, h = BODY_MM.get(package, DEFAULT_BODY_MM)
    return int(w * MM), int(h * MM)


def rotated(w: int, h: int, rotation_mdeg: int) -> tuple[int, int]:
    """90°/270° 회전이면 가로세로가 뒤바뀐다. 배치 검사와 그리기가 같은 값을 봐야 한다."""
    return (h, w) if (rotation_mdeg // 90_000) % 2 else (w, h)


class Occupancy:
    """굵은 격자 위의 점유 지도.

    격자 한 칸은 0.25mm 다. 가장 작은 부품(0201, 0.6×0.3mm)보다 잘아야 촘촘히 채워지고,
    더 잘게 쪼개면 검사 횟수가 제곱으로 늘어 목데이터 생성이 분 단위로 길어진다.
    """

    CELL = 250 * NM_PER_UM

    def __init__(self, w_nm: int, h_nm: int) -> None:
        self.cols = max(w_nm // self.CELL + 1, 1)
        self.rows = max(h_nm // self.CELL + 1, 1)
        self.grid = bytearray(self.cols * self.rows)
        self.cursor = 0
        #: 격자를 한 바퀴 다 돌고도 못 넣은 블록 넓이. 이보다 크거나 같은 것은 바로 포기한다.
        #: 없으면 부품 하나가 안 들어갈 때마다 6만 칸을 다시 훑는다.
        self._too_big = 1 << 30

    def _block(self, x_nm: int, y_nm: int, w_nm: int, h_nm: int) -> tuple[int, int, int, int]:
        x0 = (x_nm - w_nm // 2 - KEEPOUT_NM) // self.CELL
        y0 = (y_nm - h_nm // 2 - KEEPOUT_NM) // self.CELL
        x1 = (x_nm + w_nm // 2 + KEEPOUT_NM) // self.CELL
        y1 = (y_nm + h_nm // 2 + KEEPOUT_NM) // self.CELL
        return x0, y0, x1, y1

    def free(self, x_nm: int, y_nm: int, w_nm: int, h_nm: int) -> bool:
        x0, y0, x1, y1 = self._block(x_nm, y_nm, w_nm, h_nm)
        if x0 < 0 or y0 < 0 or x1 >= self.cols or y1 >= self.rows:
            return False
        for r in range(y0, y1 + 1):
            row = r * self.cols
            if any(self.grid[row + x0 : row + x1 + 1]):
                return False
        return True

    def mark(self, x_nm: int, y_nm: int, w_nm: int, h_nm: int) -> None:
        x0, y0, x1, y1 = self._block(x_nm, y_nm, w_nm, h_nm)
        x0, y0 = max(x0, 0), max(y0, 0)
        x1, y1 = min(x1, self.cols - 1), min(y1, self.rows - 1)
        for r in range(y0, y1 + 1):
            row = r * self.cols
            self.grid[row + x0 : row + x1 + 1] = b"\x01" * (x1 - x0 + 1)

    def place_at(self, x_nm: int, y_nm: int, w_nm: int, h_nm: int) -> tuple[int, int] | None:
        """원하는 자리에 놓아 본다. 비어 있으면 그대로, 아니면 None."""
        if self.free(x_nm, y_nm, w_nm, h_nm):
            self.mark(x_nm, y_nm, w_nm, h_nm)
            return x_nm, y_nm
        return None

    def find(self, w_nm: int, h_nm: int) -> tuple[int, int] | None:
        """빈 자리를 뱀 모양으로 훑어 찾는다.

        커서는 마지막으로 놓은 자리에 머문다. 부품이 대체로 비슷한 크기라 다음 부품도
        그 근처에서 곧바로 자리를 잡고, 덕분에 전체가 격자를 한 번 훑는 비용에 수렴한다.
        """
        cells = ((w_nm + 2 * KEEPOUT_NM) // self.CELL + 1) * ((h_nm + 2 * KEEPOUT_NM) // self.CELL + 1)
        if cells >= self._too_big:
            return None

        grid, cols = self.grid, self.cols
        total = cols * self.rows
        half = self.CELL // 2
        i = self.cursor
        for _ in range(total):
            r, c = divmod(i, cols)
            if r % 2:
                c = cols - 1 - c  # 뱀 모양 — 줄 끝에서 되돌아오지 않는다
            # 기준 칸부터 1바이트로 걸러 낸다. 판이 차 오르면 훑는 칸의 대부분이
            # 이미 점유 상태라, 여기서 막는 것과 블록 전체를 검사하는 것의 차이가 크다.
            if not grid[r * cols + c]:
                x = c * self.CELL + half
                y = r * self.CELL + half
                if self.free(x, y, w_nm, h_nm):
                    self.mark(x, y, w_nm, h_nm)
                    self.cursor = i
                    return x, y
            i = (i + 1) % total

        self._too_big = min(self._too_big, cells)
        return None

    def occupied_ratio(self) -> float:
        return sum(self.grid) / len(self.grid) if self.grid else 0.0


def jitter_into(occ: Occupancy, x: int, y: int, w: int, h: int, rng: random.Random,
                tries: int = 8) -> tuple[int, int] | None:
    """원하는 자리 근처를 조금씩 흔들어 본 뒤, 그래도 안 되면 빈 칸을 찾는다."""
    if (spot := occ.place_at(x, y, w, h)) is not None:
        return spot
    for _ in range(tries):
        dx = rng.randint(-3 * Occupancy.CELL, 3 * Occupancy.CELL)
        dy = rng.randint(-3 * Occupancy.CELL, 3 * Occupancy.CELL)
        if (spot := occ.place_at(x + dx, y + dy, w, h)) is not None:
            return spot
    return occ.find(w, h)
