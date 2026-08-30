import pytest
from sqlalchemy import func, select

from boardlens.db import models as m
from boardlens.db.session import session_scope
from boardlens.ingest.pipeline import ingest_payload
from boardlens.ingest.validate import IntegrityError, validate
from boardlens.parser import REGISTRY
from boardlens.storage import FileSystemStore


def _ingest(tmp_path, fixtures, limit=1):
    store = FileSystemStore(tmp_path / "blobs")
    results = []
    with session_scope() as s:
        for f in fixtures[:limit]:
            results.append(ingest_payload(s, store, payload=f.read_bytes(), filename=f.name, actor="tester"))
    return store, results


def test_ingest_reaches_ready(env, fixtures):
    _, results = _ingest(env, fixtures)
    assert results[0].state == "ready"
    with session_scope() as s:
        rev = s.get(m.Revision, results[0].revision_id)
        assert rev.ingest_state == "ready"
        assert rev.summary["component_count"] > 0
        assert s.scalar(select(func.count()).select_from(m.NetPin)) > 0


def test_reingest_replaces_children_without_duplicating(env, fixtures):
    """리비전은 불변이다. 같은 파일을 다시 넣어도 자식 행이 두 배가 되면 안 된다."""
    store, first = _ingest(env, fixtures)
    with session_scope() as s:
        before = s.scalar(select(func.count()).select_from(m.Component))
    with session_scope() as s:
        again = ingest_payload(s, store, payload=fixtures[0].read_bytes(),
                               filename=fixtures[0].name, actor="tester")
    assert again.state == "ready"
    with session_scope() as s:
        assert s.scalar(select(func.count()).select_from(m.Component)) == before
        # 같은 내용이면 원본도 하나만 남는다 (sha256 주소)
        assert s.scalar(select(func.count()).select_from(m.DesignFile)) == 1


def test_unparseable_input_fails_loudly(env):
    store = FileSystemStore(env / "blobs")
    with session_scope() as s:
        r = ingest_payload(s, store, payload=b"$HEADER\nHKP\n", filename="x.hkp", actor="tester")
    assert r.state == "failed"
    assert "문법" in r.error


def test_duplicate_refdes_is_rejected(fixtures):
    """RefDes 는 Diff 의 매칭 키다. 중복된 채로 적재하면 비교가 조용히 깨진다."""
    design = REGISTRY.by_name("cdm-json").parse(fixtures[0].read_bytes(), source="x")
    design.components[1].refdes = design.components[0].refdes
    with pytest.raises(IntegrityError) as e:
        validate(design)
    assert "RefDes" in str(e.value)


def test_audit_records_ingest(env, fixtures):
    _ingest(env, fixtures)
    with session_scope() as s:
        rows = s.scalars(select(m.AuditLog)).all()
        assert [r.action for r in rows] == ["ingest"]
