"""입력 어댑터.

DB 도 API 도 화면도 HKP 를 알지 못한다. 아는 것은 CDM 하나뿐이고, 어댑터는 어떤 포맷이든
받아 CDM Design 을 내놓는 함수다. 이렇게 두면 나중에 ODB++ 나 IPC-2581 이 들어와도
어댑터만 추가하면 되고, 반대로 포맷의 필드명이 그대로 컬럼명이 되어버리면 두 번째 포맷이
들어오는 날 전체를 다시 짜야 한다.

어댑터가 지켜야 할 것은 두 가지뿐이다:
  - `parse(payload, source) -> Design` 하나만 공개한다
  - 실패는 `ParseError` 로 던지고, 가능하면 원본 라인 번호를 담는다
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol, runtime_checkable

from boardlens.cdm.cdm_v1 import Design


class ParseError(Exception):
    """파싱 실패. 원본의 어디서 막혔는지 남긴다 — 없으면 사람이 파일을 처음부터 뒤져야 한다."""

    def __init__(self, message: str, *, line: int | None = None, section: str | None = None) -> None:
        where = []
        if section:
            where.append(f"섹션 {section}")
        if line is not None:
            where.append(f"{line}번째 줄")
        super().__init__(f"{message} ({', '.join(where)})" if where else message)
        self.line = line
        self.section = section


class ParserNotImplemented(ParseError):
    """포맷 문법이 아직 확정되지 않아 파싱할 수 없다."""


@runtime_checkable
class Adapter(Protocol):
    name: str
    version: str
    extensions: tuple[str, ...]

    def sniff(self, payload: bytes) -> bool:
        """앞부분만 보고 이 어댑터가 다룰 파일인지 판단한다."""
        ...

    def parse(self, payload: bytes, *, source: str) -> Design:
        ...


@dataclass
class Registry:
    adapters: list[Adapter] = field(default_factory=list)

    def register(self, adapter: Adapter) -> Adapter:
        self.adapters.append(adapter)
        return adapter

    def by_name(self, name: str) -> Adapter:
        for a in self.adapters:
            if a.name == name:
                return a
        raise KeyError(f"등록되지 않은 어댑터: {name}")

    def for_file(self, path: str | Path, payload: bytes | None = None) -> Adapter:
        """확장자를 먼저 보고, 애매하면 내용을 살핀다.

        확장자를 믿을 수 없는 경우가 실제로 있다 — 사내 공유 폴더를 거치며 이름이 바뀐
        파일들. 그래서 sniff 를 마지막 수단으로 남겨 둔다.
        """
        suffix = Path(path).suffix.lower()
        for a in self.adapters:
            if suffix in a.extensions:
                return a
        if payload is not None:
            for a in self.adapters:
                if a.sniff(payload):
                    return a
        raise KeyError(f"{suffix or path} 를 다룰 어댑터가 없습니다")


REGISTRY = Registry()


# ── ASCII 섹션 포맷 공통 뼈대 ───────────────────


@dataclass
class Line:
    number: int
    text: str
    tokens: list[str]


class AsciiSectionParser:
    """줄 단위 ASCII 포맷의 공통 골격.

    대부분의 CAD 중간 포맷이 같은 모양을 한다 — 섹션 머리말이 나오고, 그 아래 레코드가
    줄 단위로 이어진다. 토큰 분리, 주석 제거, 섹션 디스패치, 라인 번호를 실은 오류 보고는
    포맷과 무관하므로 여기 모아 둔다. 문법이 확정되면 하위 클래스가 SECTIONS 만 채운다.
    """

    #: 섹션 이름 -> 그 섹션의 레코드를 처리하는 메서드 이름.
    SECTIONS: dict[str, str] = {}
    COMMENT_PREFIXES: tuple[str, ...] = ("#", "//", "!")
    SECTION_PREFIX: str = "$"

    def iter_lines(self, text: str):
        for i, raw in enumerate(text.splitlines(), start=1):
            line = raw.strip()
            if not line or line.startswith(self.COMMENT_PREFIXES):
                continue
            yield Line(number=i, text=line, tokens=line.split())

    def dispatch(self, text: str) -> None:
        section: str | None = None
        for line in self.iter_lines(text):
            if line.text.startswith(self.SECTION_PREFIX):
                section = line.text[len(self.SECTION_PREFIX) :].strip().upper()
                continue
            if section is None:
                raise ParseError("섹션 머리말보다 먼저 레코드가 나왔습니다", line=line.number)
            handler = self.SECTIONS.get(section)
            if handler is None:
                # 모르는 섹션은 건너뛴다. CAD 가 버전마다 섹션을 늘리는데, 그때마다
                # 적재가 통째로 실패하면 시스템을 아무도 안 쓴다.
                continue
            getattr(self, handler)(line)
