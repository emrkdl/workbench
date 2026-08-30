"""BoardLens Geometry (.blg) — 레이어 기하 버퍼.

브라우저가 **파싱 없이** 그대로 GPU 인스턴스 버퍼로 올릴 수 있는 형태로 만든다.
JSON 을 거치면 20만 객체에서 파싱만 수 초가 걸리고, 그 순간 뷰어의 성능 목표가 무너진다.

레이아웃 (리틀 엔디언, 모든 섹션은 8바이트 정렬):

    헤더 64바이트
      0  char[4] "BLG1"
      4  u16     version = 2
      6  u16     layer_index
      8  i32     bbox_x0, bbox_y0, bbox_x1, bbox_y1
     24  u32     pad_count
     28  u32     via_count
     32  u32     trace_count
     36  u32     plane_count
     40  u32     plane_point_count
     44  u32     net_count        (netId 유효 범위. 리비전의 nets 배열 인덱스다)
     48  u32[4]  예약

    pads    i32[n*4]  x, y, w, h        중심 좌표와 크기
            u32[n]    netId
    vias    i32[n*4]  x, y, pad_d, drill_d
            u8[n]     kind             (0 through / 1 blind / 2 buried / 3 micro)
            u32[n]    netId
    traces  i32[n*4]  x0, y0, x1, y1    선분 하나가 인스턴스 하나
            u32[n]    width_nm
            u32[n]    netId
    planes  u32[n+1]  point offsets     (점 단위. 마지막 항목이 총 점 수)
            u32[n]    netId
            i32[p*2]  x, y

배선을 폴리라인이 아니라 **선분 목록**으로 두는 것이 핵심이다. 폴리라인이면 클라이언트가
두께를 가진 사각형으로 펼치는 CPU 작업이 필요하지만, 선분이면 그 배열을 그대로 인스턴스
속성으로 바인딩할 수 있다 — 복사가 없다.

netId 는 리비전 nets 배열의 인덱스이고, NO_NET 은 넷에 속하지 않는 객체다.

비아가 패드 지름과 드릴 지름을 **둘 다** 들고 있는 이유는 화면에서 비아가 도넛이기
때문이다. 바깥은 패드, 안쪽은 뚫린 구멍이고, 그 둘의 비율이 through / micro 를 눈으로
가르는 첫 단서다. 지름 하나만 두면 뷰어가 나머지를 지어내야 하는데, 비아 규격은 보드마다
다르므로 지어낸 값은 틀린다. kind 도 같은 이유로 인스턴스마다 들고 있다 — 지름으로
되짚으면 규격이 겹치는 순간 뒤섞인다.
"""

from __future__ import annotations

import gzip
import struct
from dataclasses import dataclass, field
from pathlib import Path

MAGIC = b"BLG1"
VERSION = 2
HEADER_SIZE = 64
NO_NET = 0xFFFFFFFF

#: 비아 종류를 버퍼에 담는 코드. CDM 의 ViaKind 와 짝을 이루고, 뷰어가 색을 고르는 값이다.
VIA_KIND_CODE = {"through": 0, "blind": 1, "buried": 2, "micro": 3}


def _align8(n: int) -> int:
    return (n + 7) & ~7


@dataclass
class LayerGeometry:
    """한 레이어에 그릴 것들. 좌표는 전부 정수 나노미터."""

    layer_index: int
    pads: list[tuple[int, int, int, int, int]] = field(default_factory=list)  # x, y, w, h, net
    vias: list[tuple[int, int, int, int, int, int]] = field(default_factory=list)  # x,y,pad_d,drill_d,kind,net
    traces: list[tuple[int, int, int, int, int, int]] = field(default_factory=list)  # x0,y0,x1,y1,w,net
    planes: list[tuple[list[int], int]] = field(default_factory=list)  # (평탄화 좌표, net)

    @property
    def object_count(self) -> int:
        return len(self.pads) + len(self.vias) + len(self.traces) + len(self.planes)

    def bbox(self) -> tuple[int, int, int, int]:
        xs: list[int] = []
        ys: list[int] = []
        for x, y, w, h, _ in self.pads:
            xs += [x - w // 2, x + w // 2]
            ys += [y - h // 2, y + h // 2]
        for x, y, d, _, _, _ in self.vias:
            xs += [x - d // 2, x + d // 2]
            ys += [y - d // 2, y + d // 2]
        for x0, y0, x1, y1, _, _ in self.traces:
            xs += [x0, x1]
            ys += [y0, y1]
        for pts, _ in self.planes:
            xs += pts[0::2]
            ys += pts[1::2]
        if not xs:
            return 0, 0, 0, 0
        return min(xs), min(ys), max(xs), max(ys)

    def kind_counts(self) -> dict[str, int]:
        return {
            "pad": len(self.pads),
            "via": len(self.vias),
            "trace": len(self.traces),
            "plane": len(self.planes),
        }


def pack(geometry: LayerGeometry, net_count: int) -> bytes:
    """LayerGeometry 를 .blg 바이트로. 압축은 하지 않는다 — 호출자가 gzip 한다."""
    x0, y0, x1, y1 = geometry.bbox()
    plane_points = sum(len(pts) // 2 for pts, _ in geometry.planes)

    out = bytearray()
    out += MAGIC
    out += struct.pack("<HH", VERSION, geometry.layer_index)
    out += struct.pack("<4i", x0, y0, x1, y1)
    out += struct.pack(
        "<6I",
        len(geometry.pads),
        len(geometry.vias),
        len(geometry.traces),
        len(geometry.planes),
        plane_points,
        net_count,
    )
    out += b"\x00" * (HEADER_SIZE - len(out))

    def section(data: bytes) -> None:
        out.extend(data)
        out.extend(b"\x00" * (_align8(len(out)) - len(out)))

    if geometry.pads:
        section(struct.pack(f"<{len(geometry.pads) * 4}i", *[v for p in geometry.pads for v in p[:4]]))
        section(struct.pack(f"<{len(geometry.pads)}I", *[p[4] for p in geometry.pads]))
    if geometry.vias:
        section(struct.pack(f"<{len(geometry.vias) * 4}i", *[v for p in geometry.vias for v in p[:4]]))
        section(struct.pack(f"<{len(geometry.vias)}B", *[p[4] for p in geometry.vias]))
        section(struct.pack(f"<{len(geometry.vias)}I", *[p[5] for p in geometry.vias]))
    if geometry.traces:
        section(struct.pack(f"<{len(geometry.traces) * 4}i", *[v for t in geometry.traces for v in t[:4]]))
        section(struct.pack(f"<{len(geometry.traces)}I", *[t[4] for t in geometry.traces]))
        section(struct.pack(f"<{len(geometry.traces)}I", *[t[5] for t in geometry.traces]))
    if geometry.planes:
        offsets: list[int] = [0]
        coords: list[int] = []
        for pts, _ in geometry.planes:
            coords += pts
            offsets.append(len(coords) // 2)
        section(struct.pack(f"<{len(offsets)}I", *offsets))
        section(struct.pack(f"<{len(geometry.planes)}I", *[net for _, net in geometry.planes]))
        section(struct.pack(f"<{len(coords)}i", *coords))

    return bytes(out)


def write(geometry: LayerGeometry, net_count: int, path: Path) -> int:
    """gzip 압축해 파일로 쓴다. 반환값은 압축 후 바이트 수."""
    raw = pack(geometry, net_count)
    path.parent.mkdir(parents=True, exist_ok=True)
    # mtime=0 — 같은 입력이면 같은 파일이 나와야 재생성 시 diff 가 깨끗하다.
    path.write_bytes(gzip.compress(raw, compresslevel=6, mtime=0))
    return path.stat().st_size


def read_header(raw: bytes) -> dict:
    """검증·디버깅용. 런타임 경로에서는 브라우저가 직접 읽는다."""
    if raw[:4] != MAGIC:
        raise ValueError(f"BLG 파일이 아니다: {raw[:4]!r}")
    version, layer_index = struct.unpack_from("<HH", raw, 4)
    if version != VERSION:
        raise ValueError(f"지원하지 않는 BLG 버전: {version}")
    x0, y0, x1, y1 = struct.unpack_from("<4i", raw, 8)
    pads, vias, traces, planes, plane_points, nets = struct.unpack_from("<6I", raw, 24)
    return {
        "version": version,
        "layer_index": layer_index,
        "bbox": (x0, y0, x1, y1),
        "pad_count": pads,
        "via_count": vias,
        "trace_count": traces,
        "plane_count": planes,
        "plane_point_count": plane_points,
        "net_count": nets,
    }
