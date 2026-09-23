"""The app factory must retain routes while their owners stay independent."""

from fastapi.testclient import TestClient

from backend.app.main import create_app


def test_app_registers_routes_from_focused_modules():
    app = create_app()
    owners = {route.path: route.endpoint.__module__ for route in app.routes if hasattr(route, "endpoint")}
    assert owners["/api/hide"] == "backend.app.api.protection"
    assert owners["/api/analyse"] == "backend.app.api.analysis"
    assert owners["/api/v2/jobs/protect"] == "backend.app.api.v2_protection"
    assert owners["/api/v2/jobs/{ident}"] == "backend.app.api.sessions"
    assert owners["/api/v3/jobs/text/verify"] == "backend.app.api.text"


def test_v3_text_route_uses_shared_origin_policy():
    with TestClient(create_app(), base_url="http://127.0.0.1:8000") as client:
        denied = client.post("/api/v3/text/estimate", data={"message": "hello", "method": "zero-width"},
                             headers={"Origin": "https://another.example"})
        assert denied.status_code == 403
        accepted = client.post("/api/v3/text/estimate", data={"message": "hello", "method": "zero-width"})
        assert accepted.status_code == 200
        assert accepted.json()["message_bytes"] == 5
