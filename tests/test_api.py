import io

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.app.main import create_app
from backend.app.stego.analysis.bpcs import BPCSConfig
from test_audio import wav


LEGACY_ANALYSIS_FIELDS = {
    "info",
    "channel",
    "channel_names",
    "stride",
    "bit_planes",
    "chi_square",
    "chi_square_overall",
    "histograms",
    "lsb_composite",
    "compare",
}


@pytest.fixture(scope="module")
def client():
    return TestClient(create_app(), base_url="http://127.0.0.1:8000")


@pytest.fixture(scope="module")
def keys(client):
    response = client.post("/api/keys/generate")
    assert response.status_code == 200
    body = response.json()
    assert body["bits"] == 2048 and len(body["fingerprint"]) == 64
    return body


def png_bytes():
    array = np.random.default_rng(7).integers(0, 256, (100, 100, 3), dtype=np.uint8)
    out = io.BytesIO()
    Image.fromarray(array).save(out, format="PNG")
    return out.getvalue()


@pytest.mark.parametrize("name,data,mime", [("cover.png", png_bytes(), "image/png"),
                                            ("cover.wav", wav(frames=9000), "audio/wav")],
                         ids=["image", "audio"])
def test_sender_to_receiver_flow(client, keys, name, data, mime):
    info = client.post("/api/inspect", files={"file": (name, data, mime)}).json()
    assert info["capacity"][0]["n_lsb"] == 1

    estimate = client.post("/api/estimate", json={
        "cover_kind": info["kind"], "descriptor": info["descriptor"], "cover_filename": name,
        "payload_filename": "message.txt", "payload_type": "text/plain; charset=utf-8", "payload_size": 5,
        "team": "P1-4"}).json()

    hidden = client.post("/api/hide", files={"cover": (name, data, mime)}, data={
        "payload_text": "hello", "passphrase": "pw", "private_key": keys["private_key"], "n_lsb": "2",
        "team": "P1-4"})
    assert hidden.status_code == 200, hidden.text
    body = hidden.json()
    assert body["report"]["package_bytes"] == estimate["package_bytes"]

    download = client.get(f"/api/files/{body['stego']['id']}?download=1")
    assert download.status_code == 200
    assert download.headers["content-disposition"].startswith("attachment")
    stego = download.content

    verified = client.post("/api/verify", files={"stego": (body["stego"]["filename"], stego, mime)},
                           data={"passphrase": "pw", "public_key": keys["public_key"]}).json()
    assert verified["verdict"] == "Authentic"
    assert verified["content"]["text"] == "hello"
    assert client.get(f"/api/files/{verified['content']['id']}").content == b"hello"

    suite = client.post("/api/attacks", files={"stego": ("s", stego, mime), "cover": ("c", data, mime)},
                        data={"passphrase": "pw", "public_key": keys["public_key"]}).json()
    assert all(s["as_expected"] for s in suite["scenarios"]), suite

    response = client.post("/api/analyse", files={"file": ("s", stego, mime), "compare": ("c", data, mime)},
                           data={"channel": "0"})
    assert response.status_code == 200, response.text
    analysed = response.json()
    assert LEGACY_ANALYSIS_FIELDS <= analysed.keys()
    assert len(analysed["bit_planes"]) == 8
    assert analysed["compare"]["slots_changed"] > 0


def test_analyse_preserves_legacy_error_statuses_and_empty_comparison(client):
    image = png_bytes()

    out_of_range = client.post(
        "/api/analyse",
        files={"file": ("image.png", image, "image/png")},
        data={"channel": "3"},
    )
    assert out_of_range.status_code == 400
    assert out_of_range.json()["detail"] == "Channel is out of range for this file."

    malformed = client.post(
        "/api/analyse",
        files={"file": ("image.png", image, "image/png")},
        data={"channel": "not-an-int"},
    )
    assert malformed.status_code == 422

    mismatch = client.post(
        "/api/analyse",
        files={
            "file": ("image.png", image, "image/png"),
            "compare": ("audio.wav", wav(), "audio/wav"),
        },
        data={"channel": "0"},
    )
    assert mismatch.status_code == 400
    assert "same kind and size" in mismatch.json()["detail"]

    empty_named = client.post(
        "/api/analyse",
        files={
            "file": ("image.png", image, "image/png"),
            "compare": ("empty.png", b"", "image/png"),
        },
        data={"channel": "0"},
    )
    assert empty_named.status_code == 200
    assert empty_named.json()["compare"] is None


def test_analyse_rejects_equal_slot_incompatible_audio_comparison(client):
    mono_8_bit = wav(bits=8, channels=1, frames=16, rate=8000)
    stereo_16_bit = wav(bits=16, channels=2, frames=8, rate=16000)

    response = client.post(
        "/api/analyse",
        files={
            "file": ("mono.wav", mono_8_bit, "audio/wav"),
            "compare": ("stereo.wav", stereo_16_bit, "audio/wav"),
        },
        data={"channel": "0"},
    )

    assert response.status_code == 400
    assert "same kind and size" in response.json()["detail"]


def test_analyse_uses_default_bpcs_config_when_fields_are_omitted(client):
    response = client.post(
        "/api/analyse",
        files={"file": ("image.png", png_bytes(), "image/png")},
        data={"channel": "0"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert LEGACY_ANALYSIS_FIELDS <= body.keys()
    assert body["bpcs"]["config"] == BPCSConfig().as_dict()


def test_analyse_applies_custom_bpcs_config_and_selected_planes(client):
    response = client.post(
        "/api/analyse",
        files={"file": ("image.png", png_bytes(), "image/png")},
        data={
            "channel": "0",
            "bpcs_channel": "2",
            "bpcs_block_size": "4",
            "bpcs_bit_plane_start": "1",
            "bpcs_bit_plane_end": "3",
            "bpcs_complexity_threshold": "0.45",
        },
    )

    assert response.status_code == 200, response.text
    bpcs = response.json()["bpcs"]
    assert bpcs["config"] == BPCSConfig(2, 4, 1, 3, 0.45).as_dict()
    assert [plane["bit_plane"] for plane in bpcs["planes"]] == [1, 2, 3]


def test_analyse_accepts_custom_bpcs_config_for_audio_as_unsupported(client):
    response = client.post(
        "/api/analyse",
        files={"file": ("audio.wav", wav(channels=2, frames=64), "audio/wav")},
        data={
            "channel": "0",
            "bpcs_channel": "2",
            "bpcs_block_size": "4",
            "bpcs_bit_plane_start": "1",
            "bpcs_bit_plane_end": "3",
            "bpcs_complexity_threshold": "0.45",
        },
    )

    assert response.status_code == 200, response.text
    bpcs = response.json()["bpcs"]
    assert bpcs["supported"] is False
    assert bpcs["reason"] == "BPCS analysis is available only for image inputs."
    assert bpcs["config"] == BPCSConfig(2, 4, 1, 3, 0.45).as_dict()
    assert bpcs["planes"] == []
    assert bpcs["summary"] is None
    assert bpcs["comparison"] is None


@pytest.mark.parametrize(
    ("data", "message"),
    [
        ({"bpcs_channel": "1.5"}, "BPCS channel must be a whole number from 0 through 2."),
        ({"bpcs_block_size": "8.0"}, "BPCS block size must be one of 2, 4, 8, 16, 32, or 64."),
        ({"bpcs_bit_plane_start": "8"}, "BPCS bit planes must be whole numbers from 0 through 7."),
        (
            {"bpcs_bit_plane_start": "5", "bpcs_bit_plane_end": "4"},
            "BPCS first bit plane must not exceed the last bit plane.",
        ),
        ({"bpcs_complexity_threshold": "nan"}, "BPCS complexity threshold must be a number from 0 through 1."),
        ({"bpcs_complexity_threshold": "infinity"}, "BPCS complexity threshold must be a number from 0 through 1."),
    ],
)
def test_analyse_rejects_invalid_bpcs_values_with_exact_400(client, data, message):
    response = client.post(
        "/api/analyse",
        files={"file": ("image.png", png_bytes(), "image/png")},
        data={"channel": "0", **data},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == message


def test_friendly_errors(client, keys):
    response = client.post("/api/hide", files={"cover": ("c.png", png_bytes(), "image/png")},
                           data={"payload_text": "x" * 20000, "passphrase": "pw", "private_key": keys["private_key"]})
    assert response.status_code == 400 and "Payload too large" in response.json()["detail"]
    response = client.post("/api/inspect", files={"file": ("a.mp3", b"ID3\x03" + b"\0" * 50, "audio/mpeg")})
    assert response.status_code == 400 and "MP3" in response.json()["detail"]
    response = client.post("/api/keys/inspect", json={"pem": keys["public_key"]})
    assert response.json()["type"] == "public"
    assert client.get("/api/files/unknown").status_code == 404
