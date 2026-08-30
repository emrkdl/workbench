"""CDM JSON 어댑터.

이미 CDM 형태인 문서를 그대로 받는다. 두 군데서 실제로 쓰인다:

  - 목데이터 생성기가 내놓은 골든 픽스처 — 파서가 없는 동안 인제스트 전 경로를
    끝에서 끝까지 돌려볼 수 있게 해 준다
  - 다른 시스템이 이미 CDM 으로 변환해 보내는 경우

"목데이터용 임시방편"이 아니라 정식 입력 경로다. 덕분에 HKP 문법이 확정되기 전에도
파이프라인·DB·API 를 실제 데이터로 검증할 수 있다.
"""

from __future__ import annotations

import json

from pydantic import ValidationError

from boardlens.cdm.cdm_v1 import Design
from boardlens.parser.base import REGISTRY, ParseError


class CdmJsonAdapter:
    name = "cdm-json"
    version = "1.0.0"
    extensions = (".json", ".cdm")

    def sniff(self, payload: bytes) -> bool:
        head = payload[:256].lstrip()
        return head.startswith(b"{") and b'"cdm_version"' in payload[:4096]

    def parse(self, payload: bytes, *, source: str) -> Design:
        try:
            raw = json.loads(payload.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            raise ParseError(f"JSON 을 읽지 못했습니다: {e}") from e
        try:
            return Design.model_validate(raw)
        except ValidationError as e:
            first = e.errors()[0]
            where = ".".join(str(p) for p in first["loc"])
            raise ParseError(f"CDM 스키마와 맞지 않습니다 — {where}: {first['msg']} ({source})") from e


REGISTRY.register(CdmJsonAdapter())
