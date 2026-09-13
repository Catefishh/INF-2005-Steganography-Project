import io
from PIL import Image
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from backend.app.workflows import protect_audio, protect_image, verify_audio, verify_image, estimate, Verdict
from test_audio import wav


def carrier():
    image = Image.new("RGBA", (80, 80), (12, 34, 56, 211)); out = io.BytesIO(); image.save(out, "PNG"); return out.getvalue()


def test_image_protect_and_fresh_verify_reports_all_stages():
    key = Ed25519PrivateKey.from_private_bytes(b"k" * 32)
    result = protect_image(carrier(), b"secret", key, metadata={"media_id": "12345678-1234-5678-9234-567812345678", "created_at": "2026-09-13T12:34:56Z", "nonce": "00112233445566778899aabbccddeeff"}, secret=b"s" * 32, salt=b"t" * 16)
    verified = verify_image(result.carrier, result.sidecar, result.recovery_code, key.public_key())
    assert verified.overall is Verdict.AUTHENTIC
    assert verified.content == b"secret"
    assert all(verified.stages.values())


def test_protection_overflow_does_not_release_partial_output():
    key = Ed25519PrivateKey.from_private_bytes(b"q" * 32)
    with pytest.raises(ValueError, match="capacity"):
        protect_image(carrier(), b"x" * 1000000, key)


def test_audio_protect_and_fresh_verify_reports_all_stages():
    key = Ed25519PrivateKey.from_private_bytes(b"a" * 32)
    result = protect_audio(wav(frames=5000), b"secret", key, metadata={"media_id": "12345678-1234-5678-9234-567812345678", "created_at": "2026-09-13T12:34:56Z", "nonce": "00112233445566778899aabbccddeeff"}, secret=b"s" * 32, salt=b"t" * 16)
    verified = verify_audio(result.carrier, result.sidecar, result.recovery_code, key.public_key())
    assert verified.overall is Verdict.AUTHENTIC
    assert verified.content == b"secret"
    assert all(verified.stages.values())
    assert verified.stages["size_policy"]["status"] == "unavailable"
    assert verified.overall is Verdict.AUTHENTIC


def test_png_size_policy_is_unavailable_but_authenticity_remains_authentic():
    key = Ed25519PrivateKey.from_private_bytes(b'z' * 32)
    result = protect_image(carrier(), b"secret", key, secret=b"a" * 32, salt=b"b" * 16)
    verified = verify_image(result.carrier, result.sidecar, result.recovery_code, key.public_key())
    assert verified.overall is Verdict.AUTHENTIC
    assert verified.stages["size_policy"]["status"] == "unavailable"
    assert "metadata" in verified.stages["size_policy"]["evidence"]


def test_audio_verify_reports_payload_tamper_and_wrong_recovery_material():
    key = Ed25519PrivateKey.from_private_bytes(b"b" * 32)
    result = protect_audio(wav(frames=5000), b"secret", key, secret=b"u" * 32, salt=b"v" * 16)
    tampered = bytearray(result.carrier)
    tampered[-1] ^= 1
    assert verify_audio(bytes(tampered), result.sidecar, result.recovery_code, key.public_key()).overall is Verdict.TAMPERED
    assert verify_audio(result.carrier, result.sidecar, "STEGLOC1-" + "00" * 32, key.public_key()).overall is Verdict.CANNOT_VERIFY


def test_audio_verify_rejects_wrong_signer_as_signature_invalid():
    key = Ed25519PrivateKey.from_private_bytes(b"c" * 32)
    other = Ed25519PrivateKey.from_private_bytes(b"d" * 32)
    result = protect_audio(wav(frames=5000), b"secret", key, secret=b"w" * 32, salt=b"x" * 16)
    assert verify_audio(result.carrier, result.sidecar, result.recovery_code, other.public_key()).overall is Verdict.SIGNATURE_INVALID


def test_alpha_only_png_tamper_is_tampered_and_never_releases_content():
    key = Ed25519PrivateKey.from_private_bytes(b"e" * 32)
    result = protect_image(carrier(), b"secret", key, secret=b"1" * 32, salt=b"2" * 16)
    image = Image.open(io.BytesIO(result.carrier)).convert("RGBA")
    pixels = list(image.get_flattened_data()); pixels[0] = (*pixels[0][:3], (pixels[0][3] + 1) % 256)
    image.putdata(pixels); out = io.BytesIO(); image.save(out, format="PNG")
    verified = verify_image(out.getvalue(), result.sidecar, result.recovery_code, key.public_key())
    assert verified.overall is Verdict.TAMPERED
    assert verified.content is None


def test_non_authentic_audio_verification_never_releases_content():
    key = Ed25519PrivateKey.from_private_bytes(b"f" * 32)
    result = protect_audio(wav(frames=5000), b"secret", key, secret=b"3" * 32, salt=b"4" * 16)
    tampered = bytearray(result.carrier); tampered[-1] ^= 1
    verified = verify_audio(bytes(tampered), result.sidecar, result.recovery_code, key.public_key())
    assert verified.overall is Verdict.TAMPERED
    assert verified.content is None


def test_protection_defaults_are_fresh_and_estimate_uses_actual_record():
    key = Ed25519PrivateKey.from_private_bytes(b"g" * 32)
    first = protect_image(carrier(), b"secret", key)
    second = protect_image(carrier(), b"secret", key)
    assert (first.record["created_at"], first.record["nonce"]) != (second.record["created_at"], second.record["nonce"])


def test_estimate_accounts_for_payload_bytes_and_metadata():
    result = estimate(carrier(), 17, metadata={"filename": "note.txt", "media_type": "text/plain", "team": {"name": "x"}})
    assert result["content_bytes"] == 17
    assert result["overhead_bytes"] > 0


def test_estimate_and_protect_use_same_unicode_metadata_envelope():
    key = Ed25519PrivateKey.from_private_bytes(b'h' * 32)
    metadata = {"filename": "秘密.txt", "media_type": "text/plain", "team": {"name": "Équipe"},
                "media_id": "12345678-1234-5678-9234-567812345678", "created_at": "2026-09-13T12:34:56Z",
                "nonce": "00112233445566778899aabbccddeeff"}
    content = "héllo".encode()
    estimate_result = estimate(carrier(), len(content), metadata=metadata, depth=3)
    protected = protect_image(carrier(), content, key, metadata=metadata, depth=3,
                              secret=b'i' * 32, salt=b'j' * 16)
    assert int(protected.record["encoded_byte_length"]) == estimate_result["encoded_byte_length"]
    assert protected.record["content"]["filename"] == metadata["filename"]
    assert protected.record["team"] == metadata["team"]
