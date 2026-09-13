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
