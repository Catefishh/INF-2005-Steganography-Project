import io
import asyncio
from pathlib import Path
import threading
import time
import wave

from fastapi.testclient import TestClient
from PIL import Image
import pytest

from backend.app.main import create_app
from backend.app.main import _read_upload
from backend.app.session import Session
from fastapi import HTTPException
from starlette.datastructures import UploadFile as StarletteUploadFile


def png(size=(128, 128)):
    image = Image.new("RGB", size, (80, 120, 160))
    out = io.BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


def wait_job(client, job_id):
    for _ in range(100):
        response = client.get(f"/api/jobs/{job_id}")
        assert response.status_code == 200
        body = response.json()
        if body["status"] in {"succeeded", "failed", "cancelled"}:
            return body
        time.sleep(0.01)
    raise AssertionError("job did not finish")


def keypair(client):
    response = client.post("/api/keys/generate", json={"include_private": True, "password": "test-password"})
    assert response.status_code == 200
    return response.json()


def upload(client, route, data, name):
    response = client.post(route, files={"file": (name, data, "image/png")})
    assert response.status_code == 201
    return response.json()["artifact_id"]


def test_health_host_and_cors_regressions_are_preserved():
    client = TestClient(create_app(), base_url="http://localhost")
    assert client.get("/api/health").json() == {"status": "ok", "service": "stegloc-api"}
    assert client.get("/api/health", headers={"Origin": "http://localhost:5173"}).headers["access-control-allow-origin"] == "http://localhost:5173"
    assert TestClient(create_app(), base_url="http://attacker.example").get("/api/health").status_code == 400


@pytest.mark.parametrize("media", ["image", "audio"])
def test_protect_verify_and_download_can_be_completed_by_fresh_session(media):
    owner = TestClient(create_app(), base_url="http://localhost")
    keys = keypair(owner)
    data = png()
    if media == "audio":
        out = io.BytesIO()
        with wave.open(out, "wb") as audio:
            audio.setparams((2, 2, 8000, 0, "NONE", "not compressed"))
            audio.writeframes(b"\x00\x10" * 60000)
        data = out.getvalue()
    cover_id = upload(owner, "/api/covers", data, "cover.png")
    payload_id = upload(owner, "/api/payloads", b"classified message", "../payload.txt")
    estimate = owner.post("/api/estimate", json={"cover_artifact_id": cover_id, "payload_artifact_id": payload_id, "depth": 3})
    assert estimate.status_code == 200
    assert estimate.json()["fits_at_zero"] is True
    protect = owner.post("/api/protect", json={"cover_artifact_id": cover_id, "payload_artifact_id": payload_id, "private_key": keys["private_key"], "password": "test-password", "depth": 3})
    assert protect.status_code == 202
    result = wait_job(owner, protect.json()["job_id"])
    assert result["status"] == "succeeded"
    assert "classified message" not in str(result)
    assert "BEGIN PRIVATE KEY" not in str(result)
    stego_id = result["result"]["stego_artifact_id"]
    sidecar_id = result["result"]["sidecar_artifact_id"]
    code = result["result"]["recovery_code"]
    stego = owner.get(f"/api/artifacts/{stego_id}")
    sidecar = owner.get(f"/api/artifacts/{sidecar_id}")
    assert stego.status_code == sidecar.status_code == 200

    recipient = TestClient(owner.app, base_url="http://localhost")
    recipient_stego = upload(recipient, "/api/covers", stego.content, "stego.png")
    recipient_sidecar = upload(recipient, "/api/recovery", sidecar.content, "locator.stegloc")
    public_id = upload(recipient, "/api/keys/public", keys["public_key"].encode(), "public.pem")
    verify = recipient.post("/api/verify", json={"stego_artifact_id": recipient_stego, "sidecar_artifact_id": recipient_sidecar, "recovery_code": code, "public_key_artifact_id": public_id})
    assert verify.status_code == 202
    verified = wait_job(recipient, verify.json()["job_id"])
    assert verified["status"] == "succeeded"
    content_id = verified["result"]["content_artifact_id"]
    assert recipient.get(f"/api/artifacts/{content_id}").content == b"classified message"
    assert owner.get(f"/api/artifacts/{content_id}").status_code == 404


def test_api_preserves_non_authentic_verdict_and_stages():
    client = TestClient(create_app(), base_url="http://localhost")
    keys = keypair(client)
    cover_id = upload(client, "/api/covers", png(), "cover.png")
    payload_id = upload(client, "/api/payloads", b"secret", "note.txt")
    job = client.post("/api/protect", json={"cover_artifact_id": cover_id, "payload_artifact_id": payload_id, "private_key": keys["private_key"], "password": "test-password"}).json()["job_id"]
    protected = wait_job(client, job)["result"]
    image = Image.open(io.BytesIO(client.get(f"/api/artifacts/{protected['stego_artifact_id']}").content))
    pixel = image.getpixel((0, 0))
    image.putpixel((0, 0), (pixel[0] ^ 128, *pixel[1:]))
    tampered = io.BytesIO(); image.save(tampered, format="PNG")
    stego = upload(client, "/api/covers", tampered.getvalue(), "stego.png")
    verify = client.post("/api/verify", json={"stego_artifact_id": stego, "sidecar_artifact_id": protected["sidecar_artifact_id"], "recovery_code": protected["recovery_code"], "public_key": keys["public_key"]})
    result = wait_job(client, verify.json()["job_id"])
    assert result["status"] == "succeeded"
    assert result["result"]["overall"] == "Tampered"
    assert result["result"]["content_artifact_id"] is None


def test_invalid_inputs_are_rejected_and_artifacts_are_scoped():
    first = TestClient(create_app(), base_url="http://localhost")
    second = TestClient(first.app, base_url="http://localhost")
    artifact_id = upload(first, "/api/payloads", b"payload", "payload.txt")
    assert second.get(f"/api/artifacts/{artifact_id}").status_code == 404
    assert first.post("/api/estimate", json={"cover_artifact_id": artifact_id, "payload_artifact_id": artifact_id, "depth": 9}).status_code == 422
    assert first.post("/api/verify", json={"stego_artifact_id": "bad", "sidecar_artifact_id": "bad", "recovery_code": "secret", "public_key": "bad"}).status_code == 404
    assert first.post("/api/covers", files={"file": ("../../x.png", b"not-an-image", "image/png")}).status_code == 422


def test_duplicate_active_job_cancellation_and_session_cleanup(monkeypatch):
    client = TestClient(create_app(), base_url="http://localhost")
    keys = keypair(client)
    cover_id = upload(client, "/api/covers", png(), "cover.png")
    payload_id = upload(client, "/api/payloads", b"x" * 5000, "payload.bin")
    body = {"cover_artifact_id": cover_id, "payload_artifact_id": payload_id, "private_key": keys["private_key"], "password": "test-password", "depth": 3}
    started = threading.Event()
    release = threading.Event()
    original = __import__("backend.app.workflows", fromlist=["protect_image"]).protect_image

    def blocked(*args, **kwargs):
        started.set()
        release.wait(2)
        return original(*args, **kwargs)

    monkeypatch.setattr("backend.app.main.workflows.protect_image", blocked)
    first = client.post("/api/protect", json=body)
    assert started.wait(1)
    second = client.post("/api/protect", json=body)
    assert first.status_code == 202
    assert second.status_code == 409
    assert client.delete(f"/api/jobs/{first.json()['job_id']}").status_code == 202
    release.set()
    cancelled = wait_job(client, first.json()["job_id"])
    assert cancelled["status"] == "cancelled"
    assert cancelled["result"] is None
    assert client.delete("/api/session").status_code == 204
    assert client.get(f"/api/artifacts/{cover_id}").status_code == 404


def test_files_expire_and_reset_clears_sensitive_state():
    app = create_app()
    with TestClient(app, base_url="http://localhost") as client:
        ident = upload(client, "/api/payloads", b"secret", "payload.txt")
        session = next(iter(app.state.registry.sessions.values()))
        path = session.artifacts[ident].path
        assert path.read_bytes() == b"secret"
        app.state.registry.ttl = -1
        assert client.get(f"/api/artifacts/{ident}").status_code == 404
        assert not path.exists()
        assert not session.artifacts


def test_text_keys_bounds_origin_and_error_redaction(monkeypatch, caplog):
    client = TestClient(create_app(), base_url="http://localhost")
    text = client.post("/api/payloads/text", json={"text": "secret text"})
    assert text.status_code == 201
    assert client.get(f"/api/artifacts/{text.json()['artifact_id']}").content == b"secret text"
    assert client.post("/api/keys/generate", json={}, headers={"Origin": "http://evil.example"}).status_code == 403
    secret = "private-sensitive-value"
    response = client.post("/api/protect", json={"private_key": secret, "password": secret, "depth": 100})
    assert response.status_code == 422
    assert secret not in response.text
    assert secret not in caplog.text
    monkeypatch.setattr("backend.app.main.MAX_MEDIA", 16)
    response = client.post("/api/payloads", files={"file": ("x", b"x" * 17)})
    assert response.status_code == 413


def test_upload_reservations_bound_concurrent_and_aggregate_unknown_bodies(monkeypatch):
    client = TestClient(create_app(), base_url="http://localhost")
    app = client.app
    monkeypatch.setattr("backend.app.main.MAX_MEDIA", 32)
    monkeypatch.setattr("backend.app.main.MAX_TEXT", 32)
    session = None
    entered = threading.Event()
    release = threading.Event()
    original = __import__("backend.app.main", fromlist=["_read_upload"])._read_upload

    async def blocked(registry, session, upload, limit, destination):
        entered.set()
        release.wait(2)
        return await original(registry, session, upload, limit, destination)

    monkeypatch.setattr("backend.app.main._read_upload", blocked)
    first = threading.Thread(target=lambda: client.post("/api/payloads", files={"file": ("a", b"a" * 8)}))
    second = threading.Thread(target=lambda: client.post("/api/payloads", files={"file": ("b", b"b" * 8)}))
    first.start(); assert entered.wait(1); second.start()
    time.sleep(0.05)
    release.set(); first.join(); second.join()
    session = next(iter(app.state.registry.sessions.values()))
    assert session.pending_uploads == 0
    assert session.pending_upload_bytes == 0

    response = client.post("/api/payloads", files={"file": ("large", b"x" * 64)})
    assert response.status_code == 413


def test_stored_public_key_and_safe_download_type():
    client = TestClient(create_app(), base_url="http://localhost")
    keys = keypair(client)
    ident = upload(client, "/api/keys/public", keys["public_key"].encode(), "public.pem")
    assert client.get(f"/api/artifacts/{ident}").content == keys["public_key"].encode()
    ident = upload(client, "/api/payloads", b"<script>bad</script>", '..\\evil.html')
    response = client.get(f"/api/artifacts/{ident}")
    assert response.headers["content-type"] == "application/octet-stream"
    assert "\\" not in response.headers["content-disposition"]
    assert response.headers["x-content-type-options"] == "nosniff"


def test_failed_upload_reservation_releases_only_bytes_it_owns():
    session = Session("test")
    session.pending_upload_bytes = 7  # another active upload owns these bytes
    reserved = []

    class Registry:
        def reserve_upload_bytes(self, session, amount):
            if reserved:
                raise HTTPException(413, "storage limit")
            reserved.append(amount)
            session.pending_upload_bytes += amount

        def release_upload_bytes(self, session, amount):
            session.pending_upload_bytes -= amount

    upload = StarletteUploadFile(filename="payload.bin", file=io.BytesIO(b"a" * 8))
    calls = 0

    async def two_chunks(size=-1):
        nonlocal calls
        calls += 1
        return b"a" * 5 if calls == 1 else (b"b" * 5 if calls == 2 else b"")

    upload.read = two_chunks
    with pytest.raises(HTTPException):
        asyncio.run(_read_upload(Registry(), session, upload, 100, Path(session.directory.name) / "upload"))
    assert reserved == [5]
    assert session.pending_upload_bytes == 7
    session.directory.cleanup()


def test_reset_waits_for_staged_worker_without_filesystem_errors(monkeypatch):
    client = TestClient(create_app(), base_url="http://localhost")
    keys = keypair(client)
    cover = upload(client, "/api/covers", png(), "cover.png")
    payload = upload(client, "/api/payloads", b"secret", "payload.bin")
    session = next(iter(client.app.state.registry.sessions.values()))
    entered, release, reset_done = threading.Event(), threading.Event(), threading.Event()
    errors = []
    original = Path.write_bytes

    def paused(path, data):
        if path.name.startswith("stage-"):
            entered.set()
            assert release.wait(5)
        try:
            return original(path, data)
        except OSError as exc:
            errors.append(exc)
            raise

    monkeypatch.setattr(Path, "write_bytes", paused)
    response = client.post("/api/protect", json={"cover_artifact_id": cover, "payload_artifact_id": payload, "private_key": keys["private_key"], "password": "test-password"})
    item = session.jobs[response.json()["job_id"]]
    assert entered.wait(5)

    def reset():
        try:
            client.app.state.registry.reset(session.root)
        except Exception as exc:
            errors.append(exc)
        finally:
            reset_done.set()

    thread = threading.Thread(target=reset)
    thread.start()
    try:
        assert item.cancel.wait(5)
        assert not reset_done.is_set()
        assert Path(session.directory.name).exists()
    finally:
        release.set()
        thread.join(5)
    assert reset_done.is_set()
    assert not errors
    assert not Path(session.directory.name).exists()
    assert not session.artifacts
    assert item.result is None
    assert item.status == "cancelled"
