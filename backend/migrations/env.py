"""Alembic 환경.

주소는 설정 파일이 아니라 BOARDLENS_DATABASE_URL 에서 읽는다 — 배포 스크립트가 환경변수
하나만 채우면 되고, 비밀번호가 파일로 남지 않는다.
"""

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from boardlens.db.models import Base
from boardlens.db.session import database_url

config = context.config
config.set_main_option("sqlalchemy.url", database_url())
if config.config_file_name:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(url=database_url(), target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}), prefix="sqlalchemy.", poolclass=pool.NullPool
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
