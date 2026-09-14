import io
import math

import numpy as np
import pytest
from PIL import Image

from backend.app.stego import engine
from backend.app.stego.analysis import chi_square_p, gamma_q
from backend.app.stego.attacks import run_suite
from backend.app.stego.covers import load_cover
from backend.app.stego.engine import CapacityError, StartLocationError, Verdict, hide, verify
from backend.app.stego.security import generate_rsa_keys
from test_audio import wav

SHORT = ("Explain how steganography can be used to embed hidden verification data in image and audio cover "
         "objects.").encode()


@pytest.fixture(scope="module")
def keys():
    return generate_rsa_keys()


def png(size=(120, 90), seed=3, alpha=False):
    rng = np.random.default_rng(seed)
    array = rng.integers(0, 256, (size[1], size[0], 4 if alpha else 3), dtype=np.uint8)
    out = io.BytesIO()
    Image.fromarray(array).save(out, format="PNG")
    return out.getvalue()


def protect(cover, keys, content=SHORT, **options):
    options.setdefault("n_lsb", 1)
    return hide(cover, "cover.png", content, "message.txt", "text/plain", "pass phrase", keys[0], **options)


@pytest.mark.parametrize("n_lsb", [1, 2, 3, 8])
@pytest.mark.parametrize("alpha", [False, True])
def test_image_round_trip_is_authentic(keys, n_lsb, alpha):
    cover = png(alpha=alpha)
    stego, _, report = protect(cover, keys, n_lsb=n_lsb)
    assert report["start"]["slot"] >= 1
    result = verify(stego, "pass phrase", keys[1])
    assert result["verdict"] == Verdict.AUTHENTIC, result["summary"]
    assert result["content"] == SHORT
    assert all(step["status"] == "passed" for step in result["steps"])
    assert result["record"]["embedding"]["lsb_bits"] == n_lsb
    assert len(result["record"]["nonce"]) == 32


@pytest.mark.parametrize("bits", [8, 16, 24])
def test_audio_round_trip_keeps_file_size(keys, bits):
    cover = wav(bits=bits, frames=6000)
    stego, _, report = protect(cover, keys, n_lsb=2)
    assert len(stego) == len(cover) and report["size_unchanged"]
    result = verify(stego, "pass phrase", keys[1])
    assert result["verdict"] == Verdict.AUTHENTIC, result["summary"]
    assert result["content"] == SHORT


def test_report_estimate_matches_real_package(keys):
    cover = png()
    info = load_cover(cover)
    estimate = engine.estimate_package_bytes("image", info.descriptor, "cover.png", "message.txt", "text/plain",
                                             len(SHORT))
    _, _, report = protect(cover, keys)
    assert report["package_bytes"] == estimate
    assert report["lecture_rows"][0]["payload_bits"] == format(report["lecture_rows"][0]["after"] & 1, "b")


def test_start_is_secret_and_changes_with_salt(keys):
    starts = {protect(png(size=(300, 300)), keys)[2]["start"]["slot"] for _ in range(4)}
    assert len(starts) > 1


def test_capacity_check(keys):
    with pytest.raises(CapacityError, match="Payload too large"):
        protect(png(size=(40, 40)), keys, content=b"x" * 5000)


def test_manual_start(keys):
    stego, _, report = protect(png(), keys, start_mode="manual", start_x=5, start_y=2)
    assert report["start"]["slot"] == (2 * 120 + 5) * 3
    assert verify(stego, "pass phrase", keys[1])["verdict"] == Verdict.AUTHENTIC
    with pytest.raises(StartLocationError, match="top-left"):
        protect(png(), keys, start_mode="manual", start_x=0, start_y=0)
    with pytest.raises(StartLocationError, match="header"):
        protect(png(), keys, start_mode="manual", start_x=119, start_y=89)


def test_negative_verdicts(keys):
    cover = png()
    stego, _, report = protect(cover, keys)
    start = report["start"]["slot"]

    assert verify(cover, "pass phrase", keys[1])["verdict"] == Verdict.PAYLOAD_MISSING
    assert verify(stego, "wrong", keys[1])["verdict"] == Verdict.CANNOT_VERIFY
    assert verify(stego, "pass phrase", generate_rsa_keys()[1])["verdict"] == Verdict.SIGNATURE_INVALID
    assert verify(stego, "pass phrase", keys[1], start_slot=start + 3)["verdict"] == Verdict.WRONG_START
    assert verify(stego, "pass phrase", keys[1], start_slot=start)["verdict"] == Verdict.AUTHENTIC
    assert verify(b"not media", "pass phrase", keys[1])["verdict"] == Verdict.CANNOT_VERIFY

    tampered = load_cover(stego)
    tampered.slots[0] ^= 1
    result = verify(tampered.export(), "pass phrase", keys[1])
    assert result["verdict"] == Verdict.TAMPERED and result["content"] is None
    assert result["steps"][-1]["status"] == "failed"

    tampered = load_cover(stego)
    tampered.slots[start] ^= 1
    result = verify(tampered.export(), "pass phrase", keys[1])
    assert result["verdict"] == Verdict.TAMPERED
    assert next(s for s in result["steps"] if s["id"] == "decrypt")["status"] == "failed"


@pytest.mark.parametrize("kind", ["image", "audio"])
def test_attack_suite_behaves_as_expected(keys, kind):
    cover = png() if kind == "image" else wav(frames=8000)
    stego, _, _ = protect(cover, keys)
    scenarios, files = run_suite(stego, "pass phrase", keys[1], cover)
    assert len(scenarios) == 10
    failures = [(s["id"], s["verdict"], s["summary"]) for s in scenarios if not s["as_expected"]]
    assert failures == []
    assert set(files) >= {"flip_cover_bit", "flip_payload_bit", "lsb_noise", "forged_payload"}


def test_gamma_q_matches_known_chi_square_values():
    assert gamma_q(1, 1) == pytest.approx(math.exp(-1), rel=1e-12)  # df=2, chi2=2
    assert gamma_q(2.5, 5) == pytest.approx(0.0752352, rel=1e-5)  # df=5, chi2=10
    assert gamma_q(0.5, 1.920729) == pytest.approx(0.05, rel=1e-5)  # df=1, chi2=3.841459


def test_chi_square_detects_randomised_lsbs():
    rng = np.random.default_rng(0)
    smooth = np.clip(rng.normal(100, 30, 200_000), 0, 255).astype(np.uint8) & 0xFE  # only even values
    assert chi_square_p(smooth) < 0.01
    embedded = smooth | rng.integers(0, 2, smooth.size, dtype=np.uint8)
    assert chi_square_p(embedded) > 0.5
