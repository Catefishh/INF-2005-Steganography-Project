"""Independent checks for v3 analysis, text carriers and robustness."""
import io
import base64
import time

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.app.main import create_app
from backend.app.stego.analysis_parts.quality import ssim
from backend.app.stego.analysis_parts.rs import analyse as rs_analyse
from backend.app.stego.analysis_parts.difference import compare as compare_media
from backend.app.stego.analysis_parts.bit_planes import render as render_planes
from backend.app.stego.analysis_parts.common import grid as preview_grid
from backend.app.stego.covers import load_cover
from backend.app.stego import robustness, text_v3
from backend.app.stego.v2_security import generate_signing_keys, load_signing_key, load_verification_key
from backend.app.workflows import estimate, protect_image
from test_audio import wav
from test_video_v2 import avi


def _scalar_counts(image, negative):
    result = [0, 0, 0]
    for row in image:
        for offset in range(0, len(row) // 4 * 4, 4):
            values = [int(value) for value in row[offset:offset + 4]]
            before = sum(abs(a - b) for a, b in zip(values, values[1:]))
            changed = values.copy()
            for index in (1, 2):
                changed[index] = ((changed[index] + 1) ^ 1) - 1 if negative else changed[index] ^ 1
            after = sum(abs(a - b) for a, b in zip(changed, changed[1:]))
            result[0 if after > before else 1 if after < before else 2] += 1
    return dict(zip(("regular", "singular", "unchanged"), result))


def test_rs_matches_scalar_at_boundaries_and_handles_short_images():
    data = np.tile(np.array([0, 1, 254, 255, 2, 3, 253, 252], dtype=np.uint8), (300, 1))
    found = rs_analyse(data)
    assert found["positive"] == _scalar_counts(data, False)
    assert found["negative"] == _scalar_counts(data, True)
    assert found["flipped_negative"] == _scalar_counts(data ^ 1, True)
    assert found["groups"] == 600
    assert rs_analyse(data[:, :3])["estimated_rate"] is None


def test_ssim_numeric_fixtures_and_small_images():
    black = np.zeros((16, 16, 3), dtype=np.uint8)
    white = np.full_like(black, 255)
    assert ssim(black, black) == 1
    assert ssim(black, white) == pytest.approx((.01 * 255) ** 2 / (255 ** 2 + (.01 * 255) ** 2), rel=1e-8)
    assert ssim(black[:10], black[:10]) is None
    with pytest.raises(ValueError):
        ssim(black, black[:12])


def _png(pixels):
    out = io.BytesIO()
    Image.fromarray(pixels).save(out, format="PNG")
    return out.getvalue()


def _data_url_image(url):
    return np.asarray(Image.open(io.BytesIO(base64.b64decode(url.split(",", 1)[1]))))


def test_parity_planes_and_aggregated_isolated_pixel():
    rgb = np.zeros((513, 513, 3), dtype=np.uint8)
    rgb[0, 0, 0] = 1
    cover = load_cover(_png(rgb))
    grid, stride = preview_grid(cover, 0)
    planes, _ = render_planes(cover, grid, stride)
    assert len(planes) == 8 and _data_url_image(planes[0])[0, 0] == 255
    assert _data_url_image(planes[1])[0, 0] == 0
    altered = rgb.copy()
    altered[1, 1, 0] = 1  # Skipped by a naïve stride-2 preview.
    report = compare_media(cover, load_cover(_png(altered)), stride)
    assert report["pixels_changed"] == 1 and report["slots_changed"] == 1
    assert _data_url_image(report["changed_map"])[0, 0] == 255
    with pytest.raises(ValueError):
        compare_media(cover, load_cover(_png(altered[:-1])), stride)


@pytest.mark.parametrize("method", text_v3.METHODS)
def test_text_secure_round_trip_and_tampering(method):
    private_pem, public_pem = generate_signing_keys()
    private, public = load_signing_key(private_pem), load_verification_key(public_pem)
    result = text_v3.protect("Secret 你好 🌍", method, "A visible paragraph.", private)
    assert text_v3.estimate("Secret 你好 🌍", method)["frame_bytes"] == result["frame_bytes"]
    assert text_v3.verify(result["carrier"], result["recovery"], result["recovery_code"], public)["message"] == "Secret 你好 🌍"
    with pytest.raises(ValueError):
        text_v3.verify(result["carrier"], result["recovery"], "A" * 43, public)
    truncated = ("\n".join(result["carrier"].splitlines()[:-1]) if method == "acrostic"
                 else result["carrier"][:-2] if method == "whitespace" else result["carrier"][:-1])
    with pytest.raises(ValueError):
        text_v3.verify(truncated, result["recovery"], result["recovery_code"], public)
    wrong_private, wrong_public = generate_signing_keys()
    with pytest.raises(ValueError):
        text_v3.verify(result["carrier"], result["recovery"], result["recovery_code"], load_verification_key(wrong_public))
    if method == "acrostic":
        lines = result["carrier"].splitlines()
        lines[0] = lines[0][0] + " rewritten prose with the same initial."
        assert text_v3.verify("\n".join(lines), result["recovery"], result["recovery_code"], public)["message"] == "Secret 你好 🌍"
        lines[0] = "Q changed initial"
        with pytest.raises(ValueError):
            text_v3.verify("\n".join(lines), result["recovery"], result["recovery_code"], public)
    elif method == "whitespace":
        with pytest.raises(ValueError):
            text_v3.verify(result["carrier"].replace("\t", ""), result["recovery"], result["recovery_code"], public)
    else:
        with pytest.raises(ValueError):
            text_v3.verify(result["carrier"].replace("\u200c", "\u200b", 1), result["recovery"], result["recovery_code"], public)


def test_text_rejects_oversized_input_and_ambiguous_whitespace():
    private, _ = generate_signing_keys()
    with pytest.raises(ValueError):
        text_v3.protect("x" * (text_v3.MAX_MESSAGE + 1), "zero-width", "", load_signing_key(private))
    with pytest.raises(ValueError):
        text_v3.encode(b"abc", "whitespace", "A line with a trailing space ")


def test_capacity_true_maximum_and_attacks():
    cover = _png(np.random.default_rng(2005).integers(0, 256, (128, 128, 3), dtype=np.uint8))
    for sample in cover, wav(frames=16000), avi():
        report = estimate(sample, 1, depth=3)
        maximum = report["maximum_message_bytes"]
        assert estimate(sample, maximum, depth=3)["fits_at_selected_start"]
        assert not estimate(sample, maximum + 1, depth=3)["fits_at_selected_start"]
    original = Image.open(io.BytesIO(cover))
    for name, value in (("resize", .75), ("crop", .9), ("jpeg", 75), ("noise", 2), ("brightness", 1.1)):
        transformed, extension = robustness.transform(cover, name, value)
        assert extension == ".png" and transformed == robustness.transform(cover, name, value)[0]
        assert Image.open(io.BytesIO(transformed)).format == "PNG"
    assert Image.open(io.BytesIO(cover)).size == original.size


def _finished(client, ident):
    for _ in range(200):
        value = client.get(f"/api/v2/jobs/{ident}").json()
        if value["status"] != "running" and value["status"] != "queued":
            return value
        time.sleep(.01)
    raise AssertionError("job did not finish")


def test_text_api_smoke():
    with TestClient(create_app(), base_url="http://127.0.0.1:8000") as client:
        assert client.post("/api/v2/session").status_code == 200
        private, public = generate_signing_keys()
        started = client.post("/api/v3/jobs/text/protect", data={"message": "API hello", "method": "zero-width",
            "visible": "Visible.", "private_key": private.decode()})
        assert started.status_code == 200, started.text
        result = _finished(client, started.json()["id"])
        assert result["status"] == "succeeded", result
        protected = result["result"]
        carrier = client.get(f"/api/v2/artifacts/{protected['carrier']['id']}").content
        recovery = client.get(f"/api/v2/artifacts/{protected['recovery']['id']}").content
        started = client.post("/api/v3/jobs/text/verify", data={"recovery_code": protected["recovery_code"],
            "public_key": public.decode()}, files={"carrier": ("carrier.txt", carrier), "recovery": ("recovery.stegloc-text", recovery)})
        result = _finished(client, started.json()["id"])
        assert result["status"] == "succeeded" and result["result"]["message"] == "API hello"
        assert client.post("/api/v3/jobs/text/verify", data={"recovery_code": protected["recovery_code"],
            "public_key": public.decode()}, files={"carrier": ("carrier.txt", b"\xff"),
            "recovery": ("recovery.stegloc-text", recovery)}).status_code == 400


def test_robustness_job_uses_real_v2_verifier():
    private, public = generate_signing_keys()
    cover = _png(np.random.default_rng(2005).integers(0, 256, (128, 128, 3), dtype=np.uint8))
    protected = protect_image(cover, b"robustness sample", load_signing_key(private))
    with TestClient(create_app(), base_url="http://127.0.0.1:8000") as client:
        assert client.post("/api/v2/session").status_code == 200
        attack = client.post("/api/v3/jobs/robustness", data={"protocol": "v2", "public_key": public.decode(),
            "recovery_code": protected.recovery_code}, files={"stego": ("stego.png", protected.carrier),
            "recovery": ("recovery.stegloc", protected.sidecar)})
        assert attack.status_code == 200, attack.text
        result = _finished(client, attack.json()["id"])
        assert result["status"] == "succeeded", result
        report = result["result"]
        assert report["baseline_verdict"] == "Authentic"
        assert len(report["scenarios"]) == 5
        assert all(item["verdict"] != "Authentic" for item in report["scenarios"])
        resized = next(item for item in report["scenarios"] if item["operation"] == "resize")
        assert resized["original_dimensions"] == [128, 128]
        assert resized["result_dimensions"] == [96, 96]
        assert resized["metrics"]["mse"] > 0
        assert resized["metrics"]["psnr_db"] is not None
        assert resized["metrics"]["ssim"] is not None
        assert resized["metrics"]["basis"] == "Resized result restored to original dimensions"

        cropped = next(item for item in report["scenarios"] if item["operation"] == "crop")
        assert cropped["result_dimensions"] == [115, 115]
        assert cropped["metrics"]["mse"] == 0
        assert cropped["metrics"]["psnr_db"] is None
        assert cropped["metrics"]["ssim"] == 1
        assert cropped["metrics"]["retained_area_percent"] == pytest.approx(100 * 115 * 115 / (128 * 128))
