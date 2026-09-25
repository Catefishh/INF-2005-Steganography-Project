import io
import time

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image

from backend.app.main import create_app
from backend.app.stego import engine, lsb
from backend.app.stego.covers import load_cover
from backend.app.stego.dct_codec import DctCarrier
from backend.app.stego.security import generate_rsa_keys


def png():
    output = io.BytesIO()
    Image.fromarray(np.full((512, 512, 3), 128, dtype=np.uint8)).save(output, format="PNG")
    return output.getvalue()


def test_independent_dct_download_and_reupload():
    client = TestClient(create_app(), base_url="http://127.0.0.1:8000")
    keys = client.post("/api/keys/generate").json()
    source = png()
    info = client.post("/api/inspect", files={"file": ("cover.png", source)}).json()
    assert info["dct"]["max_package_bytes"] > 0
    estimate = client.post("/api/estimate", json={"method": "dct", "cover_kind": "image",
        "descriptor": info["descriptor"], "cover_filename": "cover.png", "payload_filename": "message.txt",
        "payload_type": "text/plain; charset=utf-8", "payload_size": 5, "team": "", "key_bits": 2048}).json()
    hidden = client.post("/api/hide", files={"cover": ("cover.png", source)}, data={
        "method": "dct", "payload_text": "hello", "passphrase": "pw", "private_key": keys["private_key"]})
    assert hidden.status_code == 200, hidden.text
    body = hidden.json()
    assert body["report"]["package_bytes"] == estimate["package_bytes"]
    assert body["stego"]["filename"].endswith(".png")
    stego = client.get(f"/api/files/{body['stego']['id']}").content
    assert client.post("/api/inspect", files={"file": ("stego.png", stego)}).json()["embedding_method"] == "dct"
    verified = client.post("/api/verify", files={"stego": ("stego.png", stego)},
                           data={"passphrase": "pw", "public_key": keys["public_key"]}).json()
    assert verified["verdict"] == "Authentic", verified
    assert verified["content"]["text"] == "hello"
    assert verified["info"]["coverage"]["protected_rgb_values"] > 0
    attacks = client.post("/api/attacks", files={"stego": ("stego.png", stego)},
                          data={"passphrase": "pw", "public_key": keys["public_key"]}).json()["scenarios"]
    assert next(row for row in attacks if row["id"] == "flip_cover_bit")["verdict"] == "Tampered"
    payload_flip = next(row for row in attacks if row["id"] == "flip_payload_bit")
    assert payload_flip["verdict"] == "Tampered"
    assert payload_flip["as_expected"] is True
    assert payload_flip["file"] is not None
    changed_payload = client.get(f"/api/files/{payload_flip['file']['id']}").content
    assert client.post("/api/verify", files={"stego": ("payload_flip.png", changed_payload)},
                       data={"passphrase": "pw", "public_key": keys["public_key"]}).json()["content"] is None
    assert not any(row["id"] == "wrong_passphrase" for row in attacks)
    blocked = client.post("/api/verify", files={"stego": ("stego.png", stego)},
                          data={"passphrase": "pw", "public_key": keys["public_key"], "start_slot": "1"}).json()
    assert blocked["content"] is None
    assert client.post("/api/hide", files={"cover": ("cover.png", source)}, data={
        "method": "dct", "payload_text": "hello", "passphrase": "pw", "private_key": keys["private_key"],
        "start_mode": "manual", "start_x": "1", "start_y": "1"}).status_code == 400
    assert client.post("/api/hide", files={"cover": ("cover.png", source)}, data={
        "method": "dct", "payload_text": "hello", "passphrase": "pw", "private_key": keys["private_key"],
        "n_lsb": "2"}).status_code == 400
    assert client.post("/api/estimate", json={"method": "bogus", "cover_kind": "image",
        "descriptor": info["descriptor"], "payload_filename": "a", "payload_type": "text/plain", "payload_size": 1}).status_code == 400


def test_unsupported_dct_version_has_no_lsb_fallback():
    carrier = DctCarrier(png())
    altered = carrier.embed_ranges([(carrier.n_slots - 1024, b"DCT2")])
    assert engine.detect_method(load_cover(altered)) == "unsupported_dct"
    result = engine.verify(altered, "pw", b"bad key")
    assert result["verdict"] == "Cannot Verify"
    assert "Unsupported DCT" in result["summary"]


def test_dct_showcase_reports_all_applicable_and_skipped_cases():
    private, public = generate_rsa_keys()
    stego, _, _ = engine.hide(png(), "cover.png", b"hello", "message.txt", "text/plain",
                              "pw", private, None, method="dct")
    with TestClient(create_app(), base_url="http://127.0.0.1:8000") as client:
        client.post("/api/v2/session")
        started = client.post("/api/v4/jobs/showcase", files={"stego": ("stego.png", stego)},
                              data={"passphrase": "pw", "public_key": public.decode()})
        assert started.status_code == 200, started.text
        for _ in range(1200):
            state = client.get(f"/api/v2/jobs/{started.json()['id']}").json()
            if state["status"] in {"succeeded", "failed", "cancelled"}:
                break
            time.sleep(0.01)
        assert state["status"] == "succeeded", state.get("error")
        assert state["total"] == len(state["result"]["cases"]) == 9
        payload_flip = next(row for row in state["result"]["cases"] if row["id"] == "flip_payload_bit")
        assert payload_flip["verdict"] == "Tampered"
        assert payload_flip["file"] is not None


def test_ambiguous_dct_and_lsb_framing_is_rejected():
    carrier = DctCarrier(png())
    dct = carrier.embed_ranges([(carrier.n_slots - 1024, b"DCT1")])
    lsb_cover = load_cover(dct)
    lsb.encode(lsb_cover.slots, b"STG1", 1, engine.header_slot(lsb_cover.n_slots))
    ambiguous = lsb_cover.export()
    assert engine.detect_method(load_cover(ambiguous)) == "ambiguous"
    result = engine.verify(ambiguous, "pw", b"bad key")
    assert result["content"] is None
    assert "Conflicting" in result["summary"]
