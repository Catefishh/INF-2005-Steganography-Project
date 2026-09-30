"""Tamper and attack pages run distinct cases through the existing job endpoints."""
import io
import json
import zipfile

import pytest
from fastapi.testclient import TestClient

from backend.app.main import create_app
from backend.app.stego import engine, signed_text
from backend.app.stego.recovery_security import generate_signing_keys, load_signing_key
from backend.app.stego.security import generate_rsa_keys
from backend.app.workflows import protect_video
from test_audio import wav
from test_dct_api import png
from test_media_api import finished
from test_video import avi


@pytest.mark.parametrize("kind", ["image", "audio", "dct", "video"])
@pytest.mark.parametrize("suite", ["tamper", "attack"])
def test_media_suites_run_only_their_cases(kind, suite):
    if kind == "video":
        private, public = generate_signing_keys()
        protected = protect_video(avi(), b"message", load_signing_key(private), depth=1)
        carrier = protected.carrier
        files = {"stego": ("protected.avi", carrier), "recovery": ("recovery.stegloc", protected.sidecar)}
        data = {"recovery_code": protected.recovery_code, "public_key": public.decode()}
        expected = {"baseline", "wrong_key", "cover_flip", "payload_flip"} if suite == "tamper" else {"baseline", "lsb_noise", "wrong_code"}
    else:
        private, public = generate_rsa_keys()
        original = wav(frames=8000) if kind == "audio" else png()
        suffix = ".wav" if kind == "audio" else ".png"
        carrier, _, _ = engine.hide(original, "cover" + suffix, b"message", "message.txt", "text/plain",
                                    "password", private, method="dct" if kind == "dct" else "lsb")
        files = {"stego": ("protected" + suffix, carrier), "cover": ("cover" + suffix, original)}
        data = {"passphrase": "password", "public_key": public.decode()}
        expected = {"baseline", "wrong_passphrase", "lsb_noise", "forged_payload"} if suite == "attack" else {
            "baseline", "wrong_key", "clean_cover", "flip_cover_bit", "flip_payload_bit", "click" if kind == "audio" else "jpeg"}
        if suite == "tamper" and kind != "dct":
            expected.add("payload_hash_mismatch")
    with TestClient(create_app(), base_url="http://127.0.0.1:8000") as client:
        client.post("/api/session")
        started = client.post("/api/jobs/tamper-tests", data={**data, "suite": suite}, files=files)
        assert started.status_code == 200, started.text
        state = finished(client, started.json()["id"])
        assert state["status"] == "succeeded", state.get("error")
        rows = state["result"]["cases"]
        assert {row["id"] for row in rows} == expected
        assert rows[0]["id"] == "baseline" and rows[0]["verdict"] == "Authentic"
        assert all(row["as_expected"] for row in rows), rows
        if suite == "attack":
            assert rows[0]["attack_outcome"] == "Baseline verified"
            for row in rows[1:]:
                if row["verdict"] != "Unsupported":
                    assert row["attack"]["succeeded"] == (row["id"] in {"lsb_noise", "symbol_damage"})
                    assert row["attack"]["goal"] and row["attack"]["assumption"]
        assert state["total"] == state["completed"] == len(rows)
        if suite == "attack" and kind == "dct":
            assert {row["id"] for row in rows if row["verdict"] == "Unsupported"} == {"lsb_noise", "forged_payload"}
        if suite == "attack" and kind == "video":
            wrong_code = next(row for row in rows if row["id"] == "wrong_code")
            assert "recovery code is invalid" not in wrong_code["summary"]
        evidence = client.get(f"/api/jobs/{started.json()['id']}/evidence")
        assert evidence.status_code == 200 and evidence.content.startswith(b"PK")
        if suite == "attack":
            with zipfile.ZipFile(io.BytesIO(evidence.content)) as archive:
                exported = json.loads(archive.read("results.json"))
                assert [row.get("attack_outcome") for row in exported["cases"]] == [row.get("attack_outcome") for row in rows]
                report = archive.read("report.html").decode()
                assert "Attack simulation report" in report
                assert "Attack failed" in report and "Baseline verified" in report
                if kind != "dct":
                    assert "Attack succeeded" in report and "Attacker goal:" in report
        # A failed baseline must stop either selected suite before changing any files.
        bad_data = {**data, "suite": suite, "recovery_code" if kind == "video" else "passphrase": "incorrect"}
        started = client.post("/api/jobs/tamper-tests", data=bad_data, files=files)
        failed_baseline = finished(client, started.json()["id"])
        assert [row["id"] for row in failed_baseline["result"]["cases"]] == ["baseline"]


@pytest.mark.parametrize("method", ["acrostic", "whitespace", "zero-width"])
@pytest.mark.parametrize("suite", ["tamper", "attack"])
def test_text_suites_and_valid_wrong_secret(method, suite):
    private, public = generate_signing_keys()
    protected = signed_text.protect("message", method, "A visible sentence.", load_signing_key(private))
    with TestClient(create_app(), base_url="http://127.0.0.1:8000") as client:
        client.post("/api/session")
        started = client.post("/api/jobs/text-tamper-tests", data={"suite": suite,
            "recovery_code": protected["recovery_code"], "public_key": public.decode()}, files={
                "carrier": ("protected.txt", protected["carrier"].encode()),
                "recovery": ("recovery.stegloc-text", protected["recovery"])})
        state = finished(client, started.json()["id"])
        assert state["status"] == "succeeded", state.get("error")
        rows = state["result"]["cases"]
        expected = {"baseline", "wrong_code", "symbol_damage"} if suite == "attack" else {"baseline", "wrong_key", "symbol_damage", "visible_wording"}
        assert {row["id"] for row in rows} == expected
        assert all(row["as_expected"] for row in rows), rows
        if suite == "attack":
            assert rows[0]["attack_outcome"] == "Baseline verified"
            for row in rows[1:]:
                if row["verdict"] != "Unsupported":
                    assert row["attack"]["succeeded"] == (row["id"] in {"lsb_noise", "symbol_damage"})
                    assert row["attack"]["goal"] and row["attack"]["assumption"]
        if suite == "attack":
            assert next(row for row in rows if row["id"] == "wrong_code")["summary"] == "Text message authentication or signature verification failed"
        else:
            assert next(row for row in rows if row["id"] == "visible_wording")["verdict"] == "Authentic"


def test_attack_deep_link_and_unknown_suite(tmp_path):
    (tmp_path / "index.html").write_text("<html>Stegloc</html>")
    with TestClient(create_app(frontend_dist=tmp_path), base_url="http://127.0.0.1:8000") as client:
        assert client.get("/attack-tests").text == "<html>Stegloc</html>"
        client.post("/api/session")
        for path in ("/api/jobs/tamper-tests", "/api/jobs/text-tamper-tests"):
            response = client.post(path, data={"suite": "unknown", "public_key": "key"})
            assert response.status_code == 400 and response.json()["detail"] == "Unknown test suite"
