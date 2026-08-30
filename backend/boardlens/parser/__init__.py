"""입력 어댑터 — 어떤 포맷이든 CDM Design 으로."""

from . import cdm_json, hkp  # noqa: F401  (import 시 등록된다)
from .base import REGISTRY, Adapter, ParseError, ParserNotImplemented  # noqa: F401
