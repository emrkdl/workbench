import os
import shutil
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("BOARDLENS_DATABASE_URL", f"sqlite:///{tmp_path}/test.db")
    monkeypatch.setenv("BOARDLENS_BLOB_ROOT", str(tmp_path / "blobs"))
    monkeypatch.setenv("BOARDLENS_SECRET", "test-secret")
    from boardlens.db.session import create_all, reset_engine
    reset_engine()
    create_all()
    yield tmp_path
    reset_engine()


@pytest.fixture()
def fixtures() -> list[Path]:
    files = sorted((ROOT / "boardlens" / "parser" / "fixtures").glob("*.cdm.json"))
    if not files:
        pytest.skip("골든 픽스처가 없습니다 — python tools/mockgen/main.py 를 먼저 실행하세요")
    return files
