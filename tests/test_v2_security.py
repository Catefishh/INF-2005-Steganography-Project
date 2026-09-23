import io

import numpy as np
from PIL import Image

from backend.app.stego.carriers.image import inspect_image
from backend.app.stego.v2_security import generate_signing_keys, load_signing_key, load_verification_key
from backend.app.workflows import Verdict, protect_audio, protect_image, verify_audio, verify_image
from test_audio import wav


def cover_png():
    out = io.BytesIO()
    Image.fromarray(np.random.default_rng(2005).integers(0, 256, (96, 96, 3), dtype=np.uint8)).save(out, "PNG")
    return out.getvalue()


def test_sidecar_code_key_and_carrier_tampering():
    private, public = generate_signing_keys(b"private password")
    _, unrelated_public = generate_signing_keys(b"other password")
    result = protect_image(cover_png(), b"secret", load_signing_key(private, b"private password"))
    key = load_verification_key(public)
    assert verify_image(result.carrier, result.sidecar, result.recovery_code, key).overall is Verdict.AUTHENTIC
    assert verify_image(result.carrier, result.sidecar, result.recovery_code, load_verification_key(unrelated_public)).overall is Verdict.SIGNATURE_INVALID
    altered_sidecar = result.sidecar[:-1] + bytes([result.sidecar[-1] ^ 1])
    assert verify_image(result.carrier, altered_sidecar, result.recovery_code, key).overall is Verdict.CANNOT_VERIFY
    altered = inspect_image(result.carrier)
    altered.slots()[int(result.record["start_slot"])] ^= 1
    assert verify_image(altered.export(), result.sidecar, result.recovery_code, key).overall is Verdict.TAMPERED


def test_audio_sidecar_round_trip_preserves_byte_length():
    original = wav(frames=20000)
    private, public = generate_signing_keys()
    result = protect_audio(original, b"audio message", load_signing_key(private), depth=3)
    assert len(result.carrier) == len(original)
    verified = verify_audio(result.carrier, result.sidecar, result.recovery_code, load_verification_key(public))
    assert verified.overall is Verdict.AUTHENTIC
    assert verified.content == b"audio message"
