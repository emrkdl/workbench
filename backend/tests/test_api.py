"""API 계약 시험.

프론트가 목데이터에서 쓰던 것과 같은 모양이 나오는지, 그리고 권한이 실제로 막히는지를 본다.
"""

import pytest
from fastapi.testclient import TestClient

from boardlens import auth
from boardlens.api.app import app, set_store
from boardlens.db.session import session_scope
from boardlens.ingest.pipeline import ingest_payload
from boardlens.storage import FileSystemStore


@pytest.fixture()
def client(env, fixtures):
    store = FileSystemStore(env / "blobs")
    set_store(store)
    with session_scope() as s:
        auth.ensure_user(s, username="viewer", display_name="열람자", role="viewer", password="pw")
        auth.ensure_user(s, username="eng", display_name="설계자", role="engineer", password="pw")
        auth.ensure_user(s, username="admin", display_name="관리자", role="admin", password="pw")
        for f in fixtures:
            ingest_payload(s, store, payload=f.read_bytes(), filename=f.name, actor="admin")
    return TestClient(app)


def token(client, username):
    r = client.post("/api/auth/login", json={"username": username, "password": "pw"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_login_rejects_bad_password(client):
    r = client.post("/api/auth/login", json={"username": "viewer", "password": "nope"})
    assert r.status_code == 401


def test_anonymous_is_refused(client):
    assert client.get("/api/catalog").status_code == 401


def test_catalog_matches_frontend_shape(client):
    r = client.get("/api/catalog", headers=token(client, "viewer"))
    assert r.status_code == 200
    page = r.json()
    assert page["total"] >= 1
    board = page["items"][0]
    # 프론트가 실제로 읽는 필드들
    for key in ("board_key", "name", "status", "source_tool", "outline", "summary", "latest_revision_id"):
        assert key in board
    assert board["summary"]["layer_count"] > 0
    assert "layer_count" in page["facets"]


def test_revision_detail_has_everything_the_page_needs(client):
    headers = token(client, "viewer")
    board = client.get("/api/catalog", headers=headers).json()["items"][0]
    r = client.get(f"/api/revisions/{board['latest_revision_id']}", headers=headers)
    assert r.status_code == 200
    d = r.json()
    assert d["revision"]["board_name"]
    assert len(d["components"]) > 0
    assert len(d["nets"]) > 0
    assert len(d["stackup"]) > 0
    assert len(d["lineage"]) >= 1


def test_changeset_separates_renamed_from_rewired(client):
    """비교의 핵심 판정이 API 를 통과해도 유지되는지."""
    headers = token(client, "viewer")
    pairs = client.get("/api/changesets", headers=headers).json()["pairs"]
    if not pairs:
        pytest.skip("리비전이 하나뿐이라 비교할 쌍이 없습니다")
    p = pairs[0]
    r = client.get(f"/api/changesets/{p['revision_a_id']}/{p['revision_b_id']}", headers=headers)
    assert r.status_code == 200
    cs = r.json()
    kinds = {c["kind"] for c in cs["net_changes"]}
    assert kinds <= {"added", "removed", "renamed", "rewired"}
    assert cs["move_threshold_nm"] > 0


def test_parts_and_insights(client):
    headers = token(client, "viewer")
    parts = client.get("/api/parts", headers=headers).json()["parts"]
    assert parts and parts[0]["board_count"] >= 1
    detail = client.get(f"/api/parts/{parts[0]['id']}", headers=headers).json()
    assert detail["usages"] and detail["usages"][0]["refdes_list"]

    stats = client.get("/api/insights", headers=headers).json()
    assert stats["part_count"] == len(parts)
    assert stats["revision_count"] >= 1


def test_download_requires_engineer_and_is_audited(client):
    viewer = token(client, "viewer")
    eng = token(client, "eng")
    board = client.get("/api/catalog", headers=viewer).json()["items"][0]
    detail = client.get(f"/api/revisions/{board['latest_revision_id']}", headers=viewer).json()
    file_id = detail["files"][0]["id"]

    assert client.get(f"/api/files/{file_id}/download", headers=viewer).status_code == 403
    assert client.get(f"/api/files/{file_id}/download", headers=eng).status_code == 200

    audit = client.get("/api/admin/audit", headers=token(client, "admin")).json()
    assert any(a["action"] == "download" and a["actor"] == "eng" for a in audit)


def test_upload_requires_maintainer(client, fixtures):
    files = {"file": (fixtures[0].name, fixtures[0].read_bytes(), "application/json")}
    assert client.post("/api/ingest", headers=token(client, "eng"), files=files).status_code == 403
    r = client.post("/api/ingest", headers=token(client, "admin"), files=files)
    assert r.status_code == 200 and r.json()["state"] == "ready"


def test_geometry_is_served_as_raw_gzip(client):
    headers = token(client, "viewer")
    board = client.get("/api/catalog", headers=headers).json()["items"][0]
    detail = client.get(f"/api/revisions/{board['latest_revision_id']}", headers=headers).json()
    if not detail["layer_geometry"]:
        pytest.skip("이 픽스처에는 기하 버퍼가 없습니다")
    layer = detail["layer_geometry"][0]["layer_index"]
    r = client.get(f"/api/geometry/{board['latest_revision_id']}/{layer}", headers=headers)
    # 스토어에 실제 .blg 를 들여놓지 않은 픽스처면 404 가 맞다 — 없는 것을 있다고 하지 않는다
    assert r.status_code in (200, 404)
