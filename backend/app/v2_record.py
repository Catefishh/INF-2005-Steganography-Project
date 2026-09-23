"""V2 carrier detection, records, and capacity estimates."""
from __future__ import annotations
import hashlib
import uuid
import secrets
from datetime import datetime, timezone

from .stego import lsb
from .stego.carriers.image import inspect_image
from .stego.carriers.audio import inspect_audio
from .stego.carriers.video import inspect_video
from .stego.protocol import CARRIER_HASH_PLACEHOLDER, format_depth, format_uint64, measure_encrypted_envelope_length, PROTOCOL_ID, HASH_ALGORITHM, SIGNATURE_ALGORITHM, MAX_CONTENT_BYTES

def _inspect(data: bytes):
    if data[:2] == b"BM" or data[:8] == b"\x89PNG\r\n\x1a\n":
        return inspect_image(data)
    if data[:4] == b"RIFF" and data[8:12] == b"AVI ":
        return inspect_video(data)
    return inspect_audio(data)


def estimate(data: bytes, content_length: int, *, metadata=None, depth: int = 3,
             start: int | None = None) -> dict[str, int | bool]:
    adapter = _inspect(data)
    if type(content_length) is not int or content_length < 0:
        raise ValueError("content length must be nonnegative")
    from .stego.protocol import AES_GCM_OVERHEAD_BYTES, SIGNATURE_BYTES
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    probe = _record(adapter, b"", Ed25519PrivateKey.from_private_bytes(b"\0" * 32), metadata or {}, depth, 0, 0, CARRIER_HASH_PLACEHOLDER)
    probe["content"]["sha256"] = "0" * 64
    def packaged_size(length: int) -> int:
        probe["content"]["byte_length"] = length
        return measure_encrypted_envelope_length(probe, length)
    encoded = packaged_size(content_length)
    available = lsb.available_bytes(adapter.eligible_slots, 0, depth)
    selected = 0 if start is None else start
    selected_available = lsb.available_bytes(adapter.eligible_slots, selected, depth)
    low, high = 0, min(MAX_CONTENT_BYTES, selected_available)
    while low < high:
        middle = (low + high + 1) // 2
        if packaged_size(middle) <= selected_available:
            low = middle
        else:
            high = middle - 1
    return {"eligible_slots": adapter.eligible_slots, "content_bytes": content_length,
            "overhead_bytes": encoded - content_length, "total_bytes": encoded,
            "raw_embedding_bytes": available, "maximum_message_bytes": low,
            "selected_raw_embedding_bytes": selected_available,
            "available_bytes": available, "remaining_bytes": available - encoded,
            "encoded_byte_length": encoded, "fits_at_zero": lsb.fits(adapter.eligible_slots, 0, depth, encoded),
            "selected_start": selected, "available_from_start": selected_available,
            "fits_at_selected_start": lsb.fits(adapter.eligible_slots, selected, depth, encoded)}

def _record(adapter, content, key, metadata, depth, start, encoded, carrier_hash):
    metadata = metadata or {}
    media_id = metadata.get("media_id", str(uuid.uuid4()))
    created = metadata.get("created_at", datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
    nonce = metadata.get("nonce", secrets.token_hex(16))
    from .stego.v2_security import public_key_fingerprint
    return {
        "carrier_descriptor": adapter.descriptor,
        "carrier_sha256": carrier_hash,
        "content": {
            "byte_length": len(content),
            "filename": metadata.get("filename", "payload.bin"),
            "media_type": metadata.get("media_type", "application/octet-stream"),
            "sha256": hashlib.sha256(content).hexdigest(),
        },
        "created_at": created,
        "depth": format_depth(depth),
        "encoded_byte_length": format_uint64(encoded),
        "hash_algorithm": HASH_ALGORITHM,
        "media_id": media_id,
        "nonce": nonce,
        "protocol": PROTOCOL_ID,
        "signature_algorithm": SIGNATURE_ALGORITHM,
        "signer_fingerprint": public_key_fingerprint(key.public_key()),
        "start_slot": format_uint64(start),
        "team": metadata.get("team", {}),
    }
