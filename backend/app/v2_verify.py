"""V2 receiver workflow and carrier-specific authenticity checks."""
from __future__ import annotations
import hashlib

from .stego import lsb
from .stego.carriers.image import ImageError, canonical_hash, inspect_image
from .stego.carriers.audio import AudioError, canonical_hash as audio_canonical_hash, inspect_audio
from .stego.carriers.video import VideoError, canonical_hash as video_canonical_hash, inspect_video
from .stego.protocol import format_uint64
from .stego.v2_security import AuthenticationError, ConsistencyError, IntegrityError, RecoveryError, SignatureVerificationError, decode_recovery_code, decrypt_payload, derive_keys, verify_signed_package, _decrypt_and_verify_locator, _parse_sidecar
from .v2_results import Verdict, VerificationResult, _stages, _passed, _failed

def _verify_adapter(adapter, sidecar, recovery_code, public_key, hash_fn, size_note) -> VerificationResult:
    stages = _stages()
    try:
        secret = decode_recovery_code(recovery_code)
        salt, _, _, _ = _parse_sidecar(sidecar)
        loc = _decrypt_and_verify_locator(sidecar, derive_keys(secret, salt).locator, public_key)
        _passed(stages, "locator", "authenticated locator")
        length, depth, start = int(loc["encoded_byte_length"]), int(loc["depth"]), int(loc["start_slot"])
        encrypted = adapter.extract(length, depth, start)
        _passed(stages, "extraction", f"extracted {length} bytes")
        if hashlib.sha256(encrypted).hexdigest() != loc["encrypted_package_sha256"]:
            _failed(stages, "ciphertext_digest", "encrypted package digest does not match locator")
            return VerificationResult(Verdict.TAMPERED, stages)
        _passed(stages, "ciphertext_digest", "encrypted package digest verified")
        from .stego.v2_security import decrypt_payload
        signed_package = decrypt_payload(encrypted, derive_keys(secret, salt).payload)
        _passed(stages, "decryption", "payload authenticated")
        verified = verify_signed_package(signed_package, public_key)
        _passed(stages, "signature", "record signature verified")
        _passed(stages, "content_hash", "content digest verified")
        if any(loc[field] != verified.record[field] for field in (
            "carrier_descriptor", "depth", "encoded_byte_length", "media_id",
         "protocol", "start_slot")):
            _failed(stages, "consistency", "locator and record identity or placement disagree")
            return VerificationResult(Verdict.TAMPERED, stages)
        _passed(stages, "consistency", "locator and signed record agree")
        if format_uint64(len(encrypted)) != loc["encoded_byte_length"]:
            _failed(stages, "consistency", "locator encoded length does not match extracted ciphertext")
            return VerificationResult(Verdict.TAMPERED, stages)
        if hash_fn(adapter, depth, length, start) != verified.record["carrier_sha256"]:
            _failed(stages, "carrier_hash", "canonical carrier digest mismatch")
        else:
            _passed(stages, "carrier_hash", "canonical carrier digest verified")
        stages["size_policy"] = {"status": "unavailable", "evidence": size_note, "reason": ""}
        required = ("locator", "extraction", "ciphertext_digest", "decryption", "signature", "content_hash", "consistency", "carrier_hash")
        overall = Verdict.AUTHENTIC if all(stages[name]["status"] == "passed" for name in required) else Verdict.TAMPERED
        return VerificationResult(overall, stages, verified.content if overall is Verdict.AUTHENTIC else None, verified.record if overall is Verdict.AUTHENTIC else None)
    except SignatureVerificationError as exc:
        _failed(stages, "locator" if stages["locator"]["status"] == "skipped" else "signature", str(exc))
        return VerificationResult(Verdict.SIGNATURE_INVALID, stages)
    except IntegrityError as exc:
        stage = "content_hash" if "content digest" in str(exc) else "ciphertext_digest"
        _failed(stages, stage, str(exc))
        return VerificationResult(Verdict.TAMPERED, stages)
    except lsb.PaddingError as exc:
        _failed(stages, "ciphertext_digest", str(exc))
        return VerificationResult(Verdict.TAMPERED, stages)
    except AuthenticationError as exc:
        _failed(stages, "decryption", str(exc))
        return VerificationResult(Verdict.TAMPERED, stages)
    except (RecoveryError, ConsistencyError, ImageError, VideoError, lsb.CapacityError, ValueError, IndexError) as exc:
        stage = "locator" if stages["locator"]["status"] == "skipped" else "consistency"
        _failed(stages, stage, str(exc))
        return VerificationResult(Verdict.CANNOT_VERIFY, stages)


def verify_image(data, sidecar, recovery_code, public_key) -> VerificationResult:
    try:
        adapter = inspect_image(data)
    except ImageError as exc:
        stages = _stages()
        _failed(stages, "extraction", str(exc))
        return VerificationResult(Verdict.CANNOT_VERIFY, stages)
    return _verify_adapter(adapter, sidecar, recovery_code, public_key, canonical_hash,
                           "PNG metadata scope does not include original encoded-size comparison")


def verify_video(data, sidecar, recovery_code, public_key) -> VerificationResult:
    try:
        adapter = inspect_video(data)
    except VideoError as exc:
        stages = _stages()
        _failed(stages, "extraction", str(exc))
        return VerificationResult(Verdict.CANNOT_VERIFY, stages)
    return _verify_adapter(adapter, sidecar, recovery_code, public_key, video_canonical_hash,
                           "recipient has no original AVI for byte-length comparison")


def verify_audio(data, sidecar, recovery_code, public_key) -> VerificationResult:
    stages = _stages()
    try:
        adapter = inspect_audio(data)
        secret = decode_recovery_code(recovery_code)
        salt, _, _, _ = _parse_sidecar(sidecar)
        loc = _decrypt_and_verify_locator(sidecar, derive_keys(secret, salt).locator, public_key)
        _passed(stages, "locator", "authenticated locator")
        length, depth, start = int(loc["encoded_byte_length"]), int(loc["depth"]), int(loc["start_slot"])
        encrypted = adapter.extract(length, depth, start)
        _passed(stages, "extraction", f"extracted {length} bytes")
        if hashlib.sha256(encrypted).hexdigest() != loc["encrypted_package_sha256"]:
            _failed(stages, "ciphertext_digest", "encrypted package digest does not match locator")
            return VerificationResult(Verdict.TAMPERED, stages)
        _passed(stages, "ciphertext_digest", "encrypted package digest verified")
        signed_package = decrypt_payload(encrypted, derive_keys(secret, salt).payload)
        _passed(stages, "decryption", "payload authenticated")
        verified = verify_signed_package(signed_package, public_key)
        _passed(stages, "signature", "record signature verified")
        _passed(stages, "content_hash", "content digest verified")
        if any(loc[field] != verified.record[field] for field in (
            "carrier_descriptor", "depth", "encoded_byte_length", "media_id",
            "protocol", "start_slot")):
            _failed(stages, "consistency", "locator and record identity or placement disagree")
            return VerificationResult(Verdict.TAMPERED, stages)
        _passed(stages, "consistency", "locator and signed record agree")
        if format_uint64(len(encrypted)) != loc["encoded_byte_length"]:
            _failed(stages, "consistency", "locator encoded length does not match extracted ciphertext")
            return VerificationResult(Verdict.TAMPERED, stages)
        if audio_canonical_hash(adapter, depth, length, start) != verified.record["carrier_sha256"]:
            _failed(stages, "carrier_hash", "canonical carrier digest mismatch")
        else:
            _passed(stages, "carrier_hash", "canonical carrier digest verified")
        stages["size_policy"] = {"status": "unavailable", "evidence": "recipient has no original carrier for size comparison", "reason": ""}
        required = ("locator", "extraction", "ciphertext_digest", "decryption", "signature", "content_hash", "consistency", "carrier_hash")
        overall = Verdict.AUTHENTIC if all(stages[name]["status"] == "passed" for name in required) else Verdict.TAMPERED
        return VerificationResult(overall, stages, verified.content if overall is Verdict.AUTHENTIC else None, verified.record if overall is Verdict.AUTHENTIC else None)
    except SignatureVerificationError as exc:
        _failed(stages, "locator" if stages["locator"]["status"] == "skipped" else "signature", str(exc))
        return VerificationResult(Verdict.SIGNATURE_INVALID, stages)
    except IntegrityError as exc:
        stage = "content_hash" if "content digest" in str(exc) else "ciphertext_digest"
        _failed(stages, stage, str(exc))
        return VerificationResult(Verdict.TAMPERED, stages)
    except lsb.PaddingError as exc:
        _failed(stages, "ciphertext_digest", str(exc))
        return VerificationResult(Verdict.TAMPERED, stages)
    except AuthenticationError as exc:
        _failed(stages, "decryption", str(exc))
        return VerificationResult(Verdict.TAMPERED, stages)
    except (RecoveryError, ConsistencyError, AudioError, lsb.CapacityError, ValueError, IndexError) as exc:
        stage = "locator" if stages["locator"]["status"] == "skipped" else "consistency"
        _failed(stages, stage, str(exc))
        return VerificationResult(Verdict.CANNOT_VERIFY, stages)
