"""The app factory registers function-named routes with independent owners."""

import re

from fastapi.testclient import TestClient

from backend.app.main import create_app


def test_app_registers_routes_from_focused_modules():
    app = create_app()
    owners = {route.path: route.endpoint.__module__ for route in app.routes if hasattr(route, "endpoint")}
    assert owners["/api/hide"] == "backend.app.api.protection"
    assert owners["/api/analyse"] == "backend.app.api.analysis"
    assert owners["/api/jobs/media/protect"] == "backend.app.api.media_protection"
    assert owners["/api/jobs/{ident}"] == "backend.app.api.sessions"
    assert owners["/api/jobs/text/verify"] == "backend.app.api.text"
    assert owners["/api/signing-keys/generate"] == "backend.app.api.signing_keys"
    assert owners["/api/media/probe"] == "backend.app.api.media"
    assert owners["/api/video/verify"] == "backend.app.api.video_verify"
    assert owners["/api/jobs/tamper-tests"] == "backend.app.api.tamper_tests"
    assert owners["/api/jobs/text-tamper-tests"] == "backend.app.api.tamper_tests"
    assert owners["/api/jobs/{ident}/evidence"] == "backend.app.api.tamper_tests"
    assert not any(re.search(r"/v\d+(?:/|$)", path) for path in owners)


def test_text_route_uses_shared_origin_policy():
    with TestClient(create_app(), base_url="http://127.0.0.1:8000") as client:
        denied = client.post("/api/text/estimate", data={"message": "hello", "method": "zero-width"},
                             headers={"Origin": "https://another.example"})
        assert denied.status_code == 403
        accepted = client.post("/api/text/estimate", data={"message": "hello", "method": "zero-width"})
        assert accepted.status_code == 200
        assert accepted.json()["message_bytes"] == 5
