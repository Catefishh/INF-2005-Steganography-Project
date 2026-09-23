import io
import time
import threading

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image

from backend.app.main import create_app
from test_audio import wav
from test_video_v2 import avi


def image_bytes():
    data = np.random.default_rng(2005).integers(0, 256, (96, 96, 3), dtype=np.uint8)
    out = io.BytesIO()
    Image.fromarray(data).save(out, format="PNG")
    return out.getvalue()


def finished(client, ident):
    for _ in range(200):
        response = client.get(f"/api/v2/jobs/{ident}")
        assert response.status_code == 200
        state = response.json()
        if state["status"] in ("succeeded", "failed", "cancelled"):
            return state
        time.sleep(0.01)
    raise AssertionError("v2 job did not complete")


def test_v2_sender_receiver_and_session_artifact_scope():
    app = create_app()
    with TestClient(app, base_url="http://127.0.0.1:8000") as sender:
        assert sender.post("/api/v2/session").status_code == 200
        keys = sender.post("/api/v2/keys/generate", data={"password": "key password"}).json()
        assert keys["algorithm"] == "ed25519"
        cover = image_bytes()
        response = sender.post("/api/v2/jobs/protect", data={
            "private_key": keys["private_key"], "key_password": "key password", "depth": "3",
            "content_text": "hello v2",
        }, files={"cover": ("cover.png", cover, "image/png")})
        assert response.status_code == 200, response.text
        protected = finished(sender, response.json()["id"])
        assert protected["status"] == "succeeded", protected
        result = protected["result"]
        stego = sender.get(f"/api/v2/artifacts/{result['carrier']['id']}").content
        sidecar = sender.get(f"/api/v2/artifacts/{result['recovery']['id']}").content
        with TestClient(app, base_url="http://127.0.0.1:8000") as recipient:
            assert recipient.post("/api/v2/session").status_code == 200
            assert recipient.get(f"/api/v2/artifacts/{result['carrier']['id']}").status_code == 404
            response = recipient.post("/api/v2/jobs/verify", data={
                "recovery_code": result["recovery_code"], "public_key": keys["public_key"],
            }, files={"stego": ("stego.png", stego, "image/png"),
                      "recovery": ("recovery.stegloc", sidecar, "application/octet-stream")})
            verified = finished(recipient, response.json()["id"])
            assert verified["status"] == "succeeded", verified
            assert verified["result"]["verdict"] == "Authentic"
            content = verified["result"]["content"]
            assert recipient.get(f"/api/v2/artifacts/{content['id']}").content == b"hello v2"
            response = recipient.post("/api/v2/jobs/verify", data={
                "recovery_code": "A" * 43, "public_key": keys["public_key"],
            }, files={"stego": ("stego.png", stego, "image/png"),
                      "recovery": ("recovery.stegloc", sidecar, "application/octet-stream")})
            wrong = finished(recipient, response.json()["id"])
            assert wrong["result"]["verdict"] == "Cannot Verify"
            assert recipient.delete("/api/v2/session").status_code == 204


def test_bpcs_parameters_and_audio_unsupported():
    with TestClient(create_app(), base_url="http://127.0.0.1:8000") as client:
        data = image_bytes()
        response = client.post("/api/analyse", data={"bpcs_block_size": "8", "bpcs_first_plane": "1",
                                                     "bpcs_last_plane": "2", "bpcs_threshold": "0.4"},
                               files={"file": ("cover.png", data, "image/png")})
        assert response.status_code == 200
        result = response.json()
        assert result["bpcs"]["supported"] is True
        assert len(result["bpcs"]["planes"]) == 2
        assert result["chi_square_details"]["overall"]["sample_count"] == 96 * 96
        response = client.post("/api/analyse", data={"bpcs_block_size": "3"},
                               files={"file": ("cover.png", data, "image/png")})
        assert response.status_code == 400
        response = client.post("/api/analyse", files={"file": ("sound.wav", wav(frames=256), "audio/wav")})
        assert response.status_code == 200
        assert response.json()["bpcs"]["supported"] is False


def test_v2_direct_navigation_serves_frontend():
    from backend.app.main import FRONTEND_DIST
    if not FRONTEND_DIST.is_dir():
        return
    with TestClient(create_app(), base_url="http://127.0.0.1:8000") as client:
        response = client.get("/v2")
        assert response.status_code == 200
        assert "<html" in response.text.lower()


def test_v2_rejects_foreign_origin_session_mutations():
    with TestClient(create_app(), base_url="http://127.0.0.1:8000") as client:
        assert client.post("/api/v2/session", headers={"Origin": "http://evil.example"}).status_code == 403
        assert client.post("/api/v2/session", headers={"Origin": "http://127.0.0.1:8000"}).status_code == 200
        assert client.delete("/api/v2/session", headers={"Origin": "http://evil.example"}).status_code == 403


def test_v2_video_inside_video_through_jobs():
    with TestClient(create_app(), base_url="http://127.0.0.1:8000") as client:
        client.post("/api/v2/session")
        keys = client.post("/api/v2/keys/generate", data={"password": "video key"}).json()
        payload = avi(8, 8, 2)
        cover = avi()
        response = client.post("/api/v2/jobs/protect", data={"private_key": keys["private_key"],
                    "key_password": "video key", "depth": "3"}, files={
                    "cover": ("large.avi", cover, "video/x-msvideo"),
                    "content_file": ("small.avi", payload, "video/x-msvideo")})
        result = finished(client, response.json()["id"])
        assert result["status"] == "succeeded", result
        stored = result["result"]
        protected = client.get(f"/api/v2/artifacts/{stored['carrier']['id']}").content
        sidecar = client.get(f"/api/v2/artifacts/{stored['recovery']['id']}").content
        assert len(protected) == len(cover)
        response = client.post("/api/v2/jobs/verify", data={"public_key": keys["public_key"],
                    "recovery_code": stored["recovery_code"]}, files={
                    "stego": ("stego.avi", protected, "video/x-msvideo"),
                    "recovery": ("recovery.stegloc", sidecar, "application/octet-stream")})
        verified = finished(client, response.json()["id"])
        assert verified["result"]["verdict"] == "Authentic"
        content_id = verified["result"]["content"]["id"]
        assert client.get(f"/api/v2/artifacts/{content_id}").content == payload


def test_v2_job_cancellation_does_not_publish_artifacts(monkeypatch):
    from backend.app import v2_api
    entered = threading.Event()
    release = threading.Event()
    original = v2_api.protect_image

    def slow(*args, **kwargs):
        entered.set()
        assert release.wait(5)
        return original(*args, **kwargs)

    monkeypatch.setattr(v2_api, "protect_image", slow)
    with TestClient(create_app(), base_url="http://127.0.0.1:8000") as client:
        client.post("/api/v2/session")
        keys = client.post("/api/v2/keys/generate", data={"password": "secret"}).json()
        response = client.post("/api/v2/jobs/protect", data={"private_key": keys["private_key"],
                    "key_password": "secret", "content_text": "hello"},
                    files={"cover": ("cover.png", image_bytes(), "image/png")})
        ident = response.json()["id"]
        assert entered.wait(5)
        assert client.delete(f"/api/v2/jobs/{ident}").status_code == 200
        release.set()
        state = finished(client, ident)
        assert state["status"] == "cancelled"
        _, session = next(iter(client.app.state.registry.sessions.items()))
        assert not session.artifacts


def test_v2_session_expiration_removes_temporary_artifacts():
    from backend.app.session import Registry
    registry = Registry(ttl=1)
    token, session = registry.session(None)
    ident = registry.artifact(session, b"temporary", "result.bin", "application/octet-stream", "content")
    path = session.artifacts[ident].path
    assert path.is_file()
    session.touched -= 2
    registry.expire()
    assert token not in registry.sessions
    assert not path.exists()
