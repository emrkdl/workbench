"""엔진과 세션.

DATABASE_URL 하나로 PostgreSQL(운영)과 SQLite(테스트)를 모두 받는다. 모델이 이식 가능한
타입만 쓰기 때문에 가능하고, 덕분에 인제스트→API 전 경로를 컨테이너 없이 테스트할 수 있다.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from boardlens.db.models import Base

DEFAULT_URL = "postgresql+psycopg://boardlens:boardlens@localhost:5432/boardlens"

_engine: Engine | None = None
_factory: sessionmaker[Session] | None = None


def database_url() -> str:
    return os.environ.get("BOARDLENS_DATABASE_URL", DEFAULT_URL)


def engine() -> Engine:
    global _engine, _factory
    if _engine is None:
        url = database_url()
        kwargs: dict = {"future": True, "pool_pre_ping": True}
        if url.startswith("sqlite"):
            # 파일 SQLite 는 기본적으로 외래키를 무시한다. 켜 두지 않으면 테스트가
            # 운영과 다른 규칙으로 통과한다.
            kwargs.pop("pool_pre_ping")
            _engine = create_engine(url, **kwargs)

            @event.listens_for(_engine, "connect")
            def _fk_on(dbapi_conn, _record):  # pragma: no cover - 드라이버 콜백
                dbapi_conn.execute("PRAGMA foreign_keys=ON")

        else:
            _engine = create_engine(url, **kwargs)
        _factory = sessionmaker(bind=_engine, expire_on_commit=False, future=True)
    return _engine


def session_factory() -> sessionmaker[Session]:
    engine()
    assert _factory is not None
    return _factory


@contextmanager
def session_scope() -> Iterator[Session]:
    s = session_factory()()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()


def get_session() -> Iterator[Session]:
    """FastAPI 의존성."""
    with session_scope() as s:
        yield s


def create_all() -> None:
    """테스트·초기 부트스트랩용. 운영 스키마는 Alembic 이 관리한다."""
    Base.metadata.create_all(engine())


def reset_engine() -> None:
    """테스트에서 DATABASE_URL 을 바꿔 끼울 때 쓴다."""
    global _engine, _factory
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _factory = None
