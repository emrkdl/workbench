"""HKP 어댑터.

**아직 문법이 확정되지 않았다.** 실물 파일을 받지 못했고, 문법을 추측해서 짜 넣으면
없는 분석을 있는 것처럼 보이게 만드는 셈이라 그렇게 하지 않았다.

대신 문법과 무관한 부분은 전부 완성해 두었다:

  - 줄 단위 섹션 디스패치와 라인 번호를 실은 오류 보고 (AsciiSectionParser)
  - 원본 단위 -> 정수 나노미터 변환 (units.from_source)
  - 원점 정규화와 좌표계 규약 적용 (ingest.normalize)
  - CDM 스키마 검증과 골든 픽스처 대조 (tests/test_parser_golden.py)

실물이 오면 할 일은 SECTIONS 표를 채우고 각 레코드 핸들러를 쓰는 것뿐이다. CDM 이 이미
확정되어 있으므로 DB·API·화면 어느 쪽도 바뀌지 않는다.

확인이 필요한 것 (설계 문서 §13):
  1. 배선 기하가 파일에 들어 있는가 — 없으면 뷰어를 거버 기반으로 다시 설계해야 한다
  2. 섹션 구조와 머리말 표기
  3. 길이 단위와 원점 규약
"""

from __future__ import annotations

from boardlens.cdm.cdm_v1 import Design
from boardlens.parser.base import REGISTRY, AsciiSectionParser, ParserNotImplemented

#: 실물을 받으면 이 표를 채운다. 키는 섹션 머리말, 값은 레코드 핸들러 메서드 이름.
#: 예) {"HEADER": "on_header", "COMPONENT": "on_component", "NET": "on_net"}
SECTIONS: dict[str, str] = {}


class HkpAdapter(AsciiSectionParser):
    name = "hkp"
    version = "0.0.0"
    extensions = (".hkp",)
    SECTIONS = SECTIONS

    def sniff(self, payload: bytes) -> bool:
        # 앞 몇 줄만 본다. 문법이 확정되면 실제 서명으로 바꾼다.
        head = payload[:512].lstrip()
        return head.startswith(b"$") and b"HKP" in payload[:2048].upper()

    def parse(self, payload: bytes, *, source: str) -> Design:
        raise ParserNotImplemented(
            "HKP 문법이 아직 확정되지 않았습니다. "
            "boardlens/parser/hkp.py 의 SECTIONS 표와 레코드 핸들러를 채우면 "
            "나머지 경로(정규화·검증·적재·화면)는 그대로 동작합니다. "
            f"입력: {source}"
        )


REGISTRY.register(HkpAdapter())
