"""골든 픽스처 대조.

HKP 실물이 오기 전까지 파서 계약을 붙잡아 두는 장치다. "이 입력이 들어오면 이 CDM 이
나온다"를 고정해 두고, 실물을 받으면 픽스처만 실물로 갈아 끼운다 — CDM 쪽 코드는
한 줄도 바뀌지 않는다.
"""

import pytest

from boardlens.ingest.normalize import normalize
from boardlens.ingest.summarize import summarize
from boardlens.ingest.validate import validate
from boardlens.parser import REGISTRY, ParserNotImplemented


def test_registry_picks_adapter_by_extension():
    assert REGISTRY.for_file("board.hkp").name == "hkp"
    assert REGISTRY.for_file("board.cdm.json").name == "cdm-json"


def test_hkp_adapter_refuses_clearly():
    """문법이 확정되기 전에는 추측해서 파싱하지 않는다. 조용히 틀린 답보다 명확한 실패가 낫다."""
    with pytest.raises(ParserNotImplemented) as e:
        REGISTRY.by_name("hkp").parse(b"$HEADER\n", source="x.hkp")
    assert "SECTIONS" in str(e.value)


def test_golden_fixtures_round_trip(fixtures):
    adapter = REGISTRY.by_name("cdm-json")
    for path in fixtures:
        design = adapter.parse(path.read_bytes(), source=path.name)
        normalize(design)
        validate(design)
        summary = summarize(design)

        assert summary.component_count == len(design.components)
        assert summary.net_count == len(design.nets)
        assert summary.layer_count > 0
        # 정규화 뒤 외형은 원점에서 시작해야 한다 — 리비전 간 좌표 비교의 전제다
        xs = [p for poly in design.header.outline if not poly.is_cutout for p in poly.points_nm[0::2]]
        ys = [p for poly in design.header.outline if not poly.is_cutout for p in poly.points_nm[1::2]]
        assert min(xs) == 0 and min(ys) == 0
        # 넷 시그니처는 정규화 단계가 채운다
        assert all(n.signature for n in design.nets)
