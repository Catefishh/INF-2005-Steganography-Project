"""Small image protection and recovery workflows."""
from __future__ import annotations
import hashlib
import uuid
import secrets
from datetime import datetime, timezone
from dataclasses import dataclass
from enum import Enum
from typing import Any

from .stego import lsb
from .stego.carriers.image import ImageError, canonical_hash, inspect_image
from .stego.carriers.audio import AudioError, canonical_hash as audio_canonical_hash, inspect_audio
from .stego.protocol import CARRIER_HASH_PLACEHOLDER, format_depth, format_uint64, measure_encrypted_envelope_length, PROTOCOL_ID, HASH_ALGORITHM, SIGNATURE_ALGORITHM
from .stego.security import (
    AuthenticationError, ConsistencyError, IntegrityError, RecoveryError,
    SignatureVerificationError, create_bundle, decode_recovery_code,
    decrypt_payload, derive_keys, generate_recovery_secret, generate_salt,
    verify_signed_package, _decrypt_and_verify_locator, _parse_sidecar,
)

class Verdict(str, Enum):
    AUTHENTIC = "Authentic"; TAMPERED = "Tampered"; SIGNATURE_INVALID = "Signature Invalid"; CANNOT_VERIFY = "Cannot Verify"

@dataclass(frozen=True)
class ProtectionResult:
    carrier: bytes; sidecar: bytes; recovery_code: str; record: dict[str, Any]

@dataclass(frozen=True)
class VerificationResult:
    overall: Verdict; stages: dict[str, dict[str, str]]; content: bytes | None = None; record: dict[str, Any] | None = None


def _stages() -> dict[str, dict[str, str]]:
    return {name: {"status": "skipped", "evidence": "", "reason": ""} for name in (
        "locator", "extraction", "ciphertext_digest", "decryption", "signature", "content_hash", "consistency", "carrier_hash", "size_policy"
    )}


def _passed(stages, name: str, evidence: str = "") -> None:
    stages[name] = {"status": "passed", "evidence": evidence, "reason": ""}


def _failed(stages, name: str, reason: str) -> None:
    stages[name] = {"status": "failed", "evidence": "", "reason": reason}

def _inspect(data: bytes):
    if data[:2] == b"BM" or data[:8] == b"\x89PNG\r\n\x1a\n":
        return inspect_image(data)
    return inspect_audio(data)


def estimate(data: bytes, content_length: int, *, metadata=None, depth: int = 3) -> dict[str, int | bool]:
    adapter = _inspect(data)
    if type(content_length) is not int or content_length < 0:
        raise ValueError("content length must be nonnegative")
    from .stego.protocol import AES_GCM_OVERHEAD_BYTES, SIGNATURE_BYTES
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    probe = _record(adapter, b"", Ed25519PrivateKey.from_private_bytes(b"\0" * 32), metadata or {}, depth, 0, 0, CARRIER_HASH_PLACEHOLDER)
    probe["content"]["byte_length"] = content_length
    probe["content"]["sha256"] = "0" * 64
    encoded = measure_encrypted_envelope_length(probe, content_length)
    available = lsb.available_bytes(adapter.eligible_slots, 0, depth)
    return {"eligible_slots": adapter.eligible_slots, "content_bytes": content_length, "overhead_bytes": encoded - content_length, "total_bytes": encoded, "available_bytes": available, "remaining_bytes": available - encoded, "encoded_byte_length": encoded, "fits_at_zero": lsb.fits(adapter.eligible_slots, 0, depth, encoded)}

def _record(adapter, content, key, metadata, depth, start, encoded, carrier_hash):
    metadata = metadata or {}; media_id = metadata.get("media_id", str(uuid.uuid4()))
    created = metadata.get("created_at", datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")); nonce = metadata.get("nonce", secrets.token_hex(16))
    from .stego.security import public_key_fingerprint
    return {"carrier_descriptor": adapter.descriptor, "carrier_sha256": carrier_hash, "content": {"byte_length": len(content), "filename": metadata.get("filename", "payload.bin"), "media_type": metadata.get("media_type", "application/octet-stream"), "sha256": hashlib.sha256(content).hexdigest()}, "created_at": created, "depth": format_depth(depth), "encoded_byte_length": format_uint64(encoded), "hash_algorithm": HASH_ALGORITHM, "media_id": media_id, "nonce": nonce, "protocol": PROTOCOL_ID, "signature_algorithm": SIGNATURE_ALGORITHM, "signer_fingerprint": public_key_fingerprint(key.public_key()), "start_slot": format_uint64(start), "team": metadata.get("team", {})}

def protect_image(data: bytes, content: bytes, private_key, *, metadata=None, depth=3, start=None, secret=None, salt=None) -> ProtectionResult:
    adapter = inspect_image(data); metadata = metadata or {}
    secret = generate_recovery_secret() if secret is None else secret
    salt = generate_salt() if salt is None else salt
    start_key = derive_keys(secret, salt).start_selection
    probe = _record(adapter, content, private_key, metadata, depth, 0, 0, CARRIER_HASH_PLACEHOLDER)
    encoded = measure_encrypted_envelope_length(probe, len(content))
    try:
        start = lsb.suggest_start(start_key, salt, adapter.descriptor, depth, adapter.eligible_slots, encoded) if start is None else start
    except lsb.NoFitError as exc:
        raise lsb.CapacityError("capacity is insufficient for encrypted package") from exc
    record = _record(adapter, content, private_key, metadata, depth, start, encoded, CARRIER_HASH_PLACEHOLDER)
    carrier_hash = canonical_hash(adapter, depth, encoded, start); record["carrier_sha256"] = carrier_hash
    bundle = create_bundle(record, content, private_key, secret=secret, salt=salt)
    if len(bundle.encrypted_package) != encoded: raise ValueError("encrypted package length changed")
    adapter.embed(bundle.encrypted_package, depth, start)
    return ProtectionResult(adapter.export(), bundle.sidecar, bundle.recovery_code, _freeze_record(record))

def verify_image(data, sidecar, recovery_code, public_key) -> VerificationResult:
    stages = _stages()
    try:
        adapter = inspect_image(data)
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
        from .stego.security import decrypt_payload
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
        if canonical_hash(adapter, depth, length, start) != verified.record["carrier_sha256"]:
            _failed(stages, "carrier_hash", "canonical carrier digest mismatch")
        else:
            _passed(stages, "carrier_hash", "canonical carrier digest verified")
        stages["size_policy"] = {"status": "unavailable", "evidence": "PNG metadata scope does not include original encoded-size comparison", "reason": ""}
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
    except (RecoveryError, ConsistencyError, ImageError, lsb.CapacityError, ValueError, IndexError) as exc:
        stage = "locator" if stages["locator"]["status"] == "skipped" else "consistency"
        _failed(stages, stage, str(exc))
        return VerificationResult(Verdict.CANNOT_VERIFY, stages)


def protect_audio(data: bytes, content: bytes, private_key, *, metadata=None, depth=3, start=None, secret=None, salt=None) -> ProtectionResult:
    adapter = inspect_audio(data); metadata = metadata or {}
    secret = generate_recovery_secret() if secret is None else secret
    salt = generate_salt() if salt is None else salt
    start_key = derive_keys(secret, salt).start_selection
    probe = _record(adapter, content, private_key, metadata, depth, 0, 0, CARRIER_HASH_PLACEHOLDER)
    encoded = measure_encrypted_envelope_length(probe, len(content))
    try:
        start = lsb.suggest_start(start_key, salt, adapter.descriptor, depth, adapter.eligible_slots, encoded) if start is None else start
    except lsb.NoFitError as exc:
        raise lsb.CapacityError("capacity is insufficient for encrypted package") from exc
    record = _record(adapter, content, private_key, metadata, depth, start, encoded, CARRIER_HASH_PLACEHOLDER)
    record["carrier_sha256"] = audio_canonical_hash(adapter, depth, encoded, start)
    bundle = create_bundle(record, content, private_key, secret=secret, salt=salt)
    if len(bundle.encrypted_package) != encoded:
        raise ValueError("encrypted package length changed")
    adapter.embed(bundle.encrypted_package, depth, start)
    return ProtectionResult(adapter.export(), bundle.sidecar, bundle.recovery_code, _freeze_record(record))


def _freeze_record(record):
    from .stego.security import _freeze
    return _freeze(record)


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
