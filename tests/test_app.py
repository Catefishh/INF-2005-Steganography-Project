from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.main import create_app


def test_static_frontend_does_not_shadow_health_route(tmp_path: Path) -> None:
    frontend_dist = tmp_path / "dist"
    frontend_dist.mkdir()
    (frontend_dist / "index.html").write_text("local shell", encoding="utf-8")
    client = TestClient(create_app(frontend_dist), base_url="http://localhost")

    assert client.get("/").text == "local shell"
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "stegloc-api"}


def test_wildcard_cors_origin_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STEGLOC_DEV_ORIGINS", "*")

    with pytest.raises(ValueError, match="must not contain wildcard origins"):
        create_app()


@pytest.mark.parametrize(
    "base_url", ["http://localhost:5173", "http://127.0.0.1:8000"]
)
def test_loopback_hosts_are_allowed(base_url: str) -> None:
    response = TestClient(create_app(), base_url=base_url).get("/api/health")

    assert response.status_code == 200


def test_untrusted_host_is_rejected() -> None:
    response = TestClient(create_app(), base_url="http://attacker.example").get(
        "/api/health"
    )

    assert response.status_code == 400


def test_desktop_requires_bootstrap_and_keeps_downloads_authenticated(tmp_path):
    (tmp_path / "index.html").write_text("desktop shell", encoding="utf-8")
    token = "test-desktop-secret"
    app = create_app(tmp_path, desktop_token=token)
    client = TestClient(app, base_url="http://127.0.0.1:12345")
    assert client.get("/").status_code == 403
    assert client.get("/api/health").status_code == 403
    assert client.get("/_desktop/wrong-secret").status_code == 403

    bootstrap = client.get(f"/_desktop/{token}", follow_redirects=False)
    assert bootstrap.status_code == 303
    assert bootstrap.headers["location"] == "/"
    assert "HttpOnly" in bootstrap.headers["set-cookie"]
    assert "SameSite=strict" in bootstrap.headers["set-cookie"]
    assert bootstrap.headers["cache-control"] == "no-store"
    assert client.get("/").text == "desktop shell"
    assert client.get("/api/health").status_code == 200

    saved = app.state.store.put(b"saved media", "output.png", "image/png")
    assert client.get(f"/api/files/{saved['id']}?download=1").content == b"saved media"
    assert client.post("/api/keys/generate", headers={"Origin": "http://evil.example"}).status_code == 403
    assert client.post("/api/keys/generate", headers={"Origin": "http://127.0.0.1:9999"}).status_code == 403
    assert client.post("/api/keys/generate", headers={"Origin": "http://127.0.0.1:12345"}).status_code == 200


def test_desktop_bootstrap_accepts_only_local_graph_destinations(tmp_path):
    (tmp_path / "index.html").write_text("graph shell", encoding="utf-8")
    client = TestClient(create_app(tmp_path, desktop_token="secret"), base_url="http://127.0.0.1:12345")
    graph_id = "dc912f0d-7498-4d50-acb0-444395fd772d"
    assert client.get(f"/graph/{graph_id}").status_code == 403
    start = client.get(f"/_desktop/secret?next=/graph/{graph_id}", follow_redirects=False)
    assert start.headers["location"] == f"/graph/{graph_id}"
    assert client.get(f"/graph/{graph_id}").text == "graph shell"
    for bad in ("https://evil.example/graph", "//evil.example", "/api/health", "/graph/../../api/health"):
        response = client.get("/_desktop/secret", params={"next": bad}, follow_redirects=False)
        assert response.headers["location"] == "/"


def test_desktop_cookies_cannot_open_another_instance():
    first = TestClient(create_app(desktop_token="first"), base_url="http://localhost")
    first.get("/_desktop/first")
    second = TestClient(create_app(desktop_token="second"), base_url="http://localhost", cookies=first.cookies)
    assert second.get("/api/health").status_code == 403
