"""Real decoder and v4 video verification integration checks."""
import hashlib
import io
import json
import subprocess
import sys
import time
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.api.v4_media import _binary, _run
from backend.app.cancellation import installed
from backend.app.main import create_app
from backend.app.stego.carriers.video import inspect_video
from backend.app.stego.covers import load_cover
from backend.app.stego import engine, text_v3
from backend.app.stego.security import generate_rsa_keys
from backend.app.stego.v2_security import load_signing_key
from test_v2_api import finished, image_bytes


def _sample(path: Path, kind: str) -> bytes:
    ffmpeg = _binary("ffmpeg")
    if kind == "mp3":
        command = [ffmpeg, "-nostdin", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
                   "-ar", "22050", "-ac", "1", "-y", str(path)]
    else:
        command = [ffmpeg, "-nostdin", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=64x48:rate=8:duration=1",
                   "-c:v", "mpeg4", "-y", str(path)]
    subprocess.run(command, check=True, capture_output=True, timeout=20)
    return path.read_bytes()


@pytest.mark.parametrize("kind", ["mp3", "mp4", "mov"])
def test_real_media_preparation(tmp_path, kind):
    try:
        data = _sample(tmp_path / ("source." + kind), kind)
    except ValueError:
        pytest.skip("FFmpeg not available in this environment")
    with TestClient(create_app(), base_url="http://127.0.0.1:8000") as client:
        probe = client.post("/api/v4/media/probe", files={"file": ("source." + kind, data)})
        assert probe.status_code == 200, probe.text
        assert probe.json()["kind"] == ("audio" if kind == "mp3" else "video")
        prepared = client.post("/api/v4/media/prepare", data={"duration": "0.5", "fps": "8",
            "max_width": "64", "max_height": "48"}, files={"file": ("source." + kind, data)})
        assert prepared.status_code == 200, prepared.text
        saved = prepared.json()["file"]
        converted = client.get(f"/api/files/{saved['id']}").content
        if kind == "mp3":
            assert saved["filename"].endswith(".wav")
            load_cover(converted)
        else:
            assert saved["filename"].endswith(".avi")
            adapter = inspect_video(converted)
            assert (adapter.width, adapter.height) == (64, 48)
            assert adapter.frame_count > 0
            assert prepared.json()["conversion"]["audio_omitted"] is True


def test_media_rejects_invalid_source_and_oversized_video(tmp_path):
    with TestClient(create_app(), base_url="http://127.0.0.1:8000") as client:
        invalid = client.post("/api/v4/media/probe", files={"file": ("claim.mp4", b"not a movie")})
        assert invalid.status_code == 400
        try:
            source = _sample(tmp_path / "source.mov", "mov")
        except ValueError:
            pytest.skip("FFmpeg not available in this environment")
        large_source_path = tmp_path / "large.mp4"
        subprocess.run([_binary("ffmpeg"), "-nostdin", "-v", "error", "-f", "lavfi", "-i",
            "testsrc=size=640x360:rate=1:duration=1", "-c:v", "mpeg4", "-y", str(large_source_path)],
            check=True, capture_output=True, timeout=20)
        oversized = client.post("/api/v4/media/prepare", data={"duration": "30", "fps": "30",
            "max_width": "640", "max_height": "360"}, files={"file": ("large.mp4", large_source_path.read_bytes())})
        assert oversized.status_code == 400
        assert "64 MiB" in oversized.text
        invalid_setting = client.post("/api/v4/media/prepare", data={"duration": "31"},
            files={"file": ("source.mov", source)})
        assert invalid_setting.status_code == 400


def test_missing_converter_and_cancellable_subprocess(monkeypatch):
    monkeypatch.setattr(Path, "is_file", lambda _path: False)
    monkeypatch.setattr("backend.app.api.v4_media.shutil.which", lambda _name: None)
    with pytest.raises(ValueError, match="unavailable"):
        _binary("ffmpeg")
    started = time.monotonic()
    with installed(lambda: (_ for _ in ()).throw(InterruptedError())):
        with pytest.raises(InterruptedError):
            _run([sys.executable, "-c", "import time; time.sleep(5)"], timeout=10)
    assert time.monotonic() - started < 2


def test_video_wrong_slot_retry_and_binary_payload(tmp_path):
    try:
        source = _sample(tmp_path / "source.mp4", "mp4")
    except ValueError:
        pytest.skip("FFmpeg not available in this environment")
    with TestClient(create_app(), base_url="http://127.0.0.1:8000") as client:
        assert client.post("/api/v2/session").status_code == 200
        prepared = client.post("/api/v4/media/prepare", data={"duration": "1", "fps": "8",
            "max_width": "64", "max_height": "48"}, files={"file": ("source.mp4", source)})
        assert prepared.status_code == 200, prepared.text
        cover = client.get(f"/api/files/{prepared.json()['file']['id']}").content
        keys = client.post("/api/v2/keys/generate", data={"password": "video test key"}).json()
        payload = b"\x00\x01movie payload\xff"
        protected = client.post("/api/v2/jobs/protect", data={"private_key": keys["private_key"],
            "key_password": "video test key", "depth": "3"},
            files={"cover": ("prepared.avi", cover), "content_file": ("movie.mov", payload, "video/quicktime")})
        assert protected.status_code == 200, protected.text
        result = finished(client, protected.json()["id"])["result"]
        assert result["payload_hash"]["expected"] == hashlib.sha256(payload).hexdigest()
        stego = client.get(f"/api/v2/artifacts/{result['carrier']['id']}").content
        recovery = client.get(f"/api/v2/artifacts/{result['recovery']['id']}").content
        form = {"recovery_code": result["recovery_code"], "public_key": keys["public_key"]}
        files = {"stego": ("stego.avi", stego), "recovery": ("recovery.stegloc", recovery)}
        wrong = client.post("/api/v4/video/verify", data={**form, "start_slot": "0"}, files=files)
        assert wrong.status_code == 200, wrong.text
        assert wrong.json()["verdict"] == "Wrong Start Location"
        assert wrong.json()["content"] is None
        second_wrong = client.post("/api/v4/video/verify", data={**form, "start_slot": "-1"}, files=files)
        assert second_wrong.status_code == 200, second_wrong.text
        assert second_wrong.json()["verdict"] == "Wrong Start Location"
        assert second_wrong.json()["content"] is None
        correct = client.post("/api/v4/video/verify", data=form, files=files)
        assert correct.status_code == 200, correct.text
        assert correct.json()["verdict"] == "Authentic"
        assert correct.json()["payload_hash"]["computed"] == hashlib.sha256(payload).hexdigest()
        content = correct.json()["content"]
        assert content["filename"] == "movie.mov"
        assert content["media_type"] == "video/quicktime"
        assert client.get(f"/api/v2/artifacts/{content['id']}").content == payload


def test_live_showcase_existing_file_and_export():
    private, public = generate_rsa_keys()
    cover = image_bytes()
    protected, _, _ = engine.hide(cover, "original.png", b"\x00\x01binary evidence", "voice.mp3",
        "audio/mpeg", "testing passphrase", private, None, 1, "auto")
    with TestClient(create_app(), base_url="http://127.0.0.1:8000") as client:
        client.post("/api/v2/session")
        started = client.post("/api/v4/jobs/showcase", data={"passphrase": "testing passphrase",
            "public_key": public.decode()}, files={"stego": ("protected.png", protected, "image/png"),
            "cover": ("original.png", cover, "image/png")})
        assert started.status_code == 200, started.text
        state = None
        for _ in range(1200):
            state = client.get(f"/api/v2/jobs/{started.json()['id']}").json()
            if state["status"] in {"succeeded", "failed", "cancelled"}:
                break
            time.sleep(0.01)
        assert state["status"] == "succeeded", state.get("error")
        rows = state["result"]["cases"]
        assert rows[0]["verdict"] == "Authentic"
        assert any(row["id"] == "payload_hash_mismatch" and row["verdict"] == "Tampered" for row in rows)
        evidence = client.get(f"/api/v4/jobs/{started.json()['id']}/evidence")
        assert evidence.status_code == 200
        assert evidence.content[:2] == b"PK"
        with zipfile.ZipFile(io.BytesIO(evidence.content)) as bundle:
            manifest = json.loads(bundle.read("sha256-manifest.json"))
            assert "report.html" in manifest and "results.json" in manifest
            assert "heatmaps/embedding.png" in manifest
            assert any(name.startswith("samples/") for name in manifest)
            for name, digest in manifest.items():
                assert hashlib.sha256(bundle.read(name)).hexdigest() == digest
            assert private not in evidence.content
            assert b"testing passphrase" not in evidence.content
        with TestClient(client.app, base_url="http://127.0.0.1:8000") as unrelated:
            unrelated.post("/api/v2/session")
            assert unrelated.get(f"/api/v4/jobs/{started.json()['id']}/evidence").status_code == 404
        assert client.post("/api/v4/jobs/showcase", data={"mode": "encode", "public_key": public.decode()}).status_code == 400


@pytest.mark.parametrize("method", ["acrostic", "whitespace", "zero-width"])
def test_text_showcase_methods(method):
    with TestClient(create_app(), base_url="http://127.0.0.1:8000") as client:
        client.post("/api/v2/session")
        keys = client.post("/api/v2/keys/generate", data={"password": "text test key"}).json()
        protected = text_v3.protect("exact text", method, "A visible sentence.",
            load_signing_key(keys["private_key"].encode(), b"text test key"))
        started = client.post("/api/v4/jobs/text-showcase", data={"recovery_code": protected["recovery_code"],
            "public_key": keys["public_key"]}, files={"carrier": ("protected.txt", protected["carrier"].encode()),
            "recovery": ("recovery.stegloc-text", protected["recovery"])})
        assert started.status_code == 200, started.text
        state = finished(client, started.json()["id"])
        assert state["status"] == "succeeded", state.get("error")
        rows = state["result"]["cases"]
        assert len(rows) == 5
        assert all(row["as_expected"] for row in rows), rows
        assert client.post("/api/v4/jobs/text-showcase", data={"mode": "encode", "public_key": keys["public_key"]}).status_code == 400
