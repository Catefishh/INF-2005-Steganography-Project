"""Legacy record bytes and package framing."""
import json
import struct
import uuid

PROTOCOL = "stegloc/2"
MAGIC = b"STG1"
SALT_BYTES = 16
HEADER_PLAIN = struct.Struct(">QQB")
HEADER_BYTES = len(MAGIC) + SALT_BYTES + 12 + HEADER_PLAIN.size + 16
HEADER_SLOTS = HEADER_BYTES * 8
PACKAGE_OVERHEAD = 12 + 16 + 4 + 2
ZERO_HASH = "0" * 64
MAX_TEXT_FIELD = 200

def canonical_json(obj):
    """Same record -> same bytes -> same SHA-256 (sorted keys, no spaces)."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")

def _limit(text, name):
    text = (text or "").strip()
    if len(text) > MAX_TEXT_FIELD:
        raise ValueError(f"{name} is too long (maximum {MAX_TEXT_FIELD} characters).")
    return text

def make_record(cover_kind, descriptor, cover_filename, payload_filename, payload_type, payload_size,
                payload_sha256, team, signer_fingerprint, n_lsb, start, header_pos, cover_sha256,
                media_id, timestamp, nonce):
    # start_slot / header_slot are fixed-width strings so the record length does
    # not change when the placeholder start is replaced by the real one.
    return {
        "protocol": PROTOCOL,
        "media_id": media_id,
        "timestamp": timestamp,
        "nonce": nonce,
        "team": team,
        "signer_fingerprint": signer_fingerprint,
        "cover": {"type": cover_kind, "descriptor": descriptor, "filename": cover_filename,
                  "sha256": cover_sha256},
        "payload": {"filename": payload_filename, "media_type": payload_type, "size": payload_size,
                    "sha256": payload_sha256},
        "embedding": {"method": "LSB replacement", "lsb_bits": n_lsb, "start_slot": f"{start:020d}",
                      "header_slot": f"{header_pos:020d}"},
        "algorithms": {"hash": "SHA-256", "signature": "RSA-PSS (SHA-256)", "encryption": "AES-256-GCM",
                       "key_derivation": "PBKDF2-HMAC-SHA256"},
    }

def package_size(record_bytes, signature_bytes, content_bytes):
    return PACKAGE_OVERHEAD + record_bytes + signature_bytes + content_bytes

def _pack(record_json, signature, content):
    return (struct.pack(">I", len(record_json)) + record_json
            + struct.pack(">H", len(signature)) + signature + content)

def _unpack(package):
    (record_len,) = struct.unpack_from(">I", package, 0)
    record_end = 4 + record_len
    (sig_len,) = struct.unpack_from(">H", package, record_end)
    sig_end = record_end + 2 + sig_len
    if sig_end > len(package):
        raise ValueError("package is truncated")
    return package[4:record_end], package[record_end + 2:sig_end], package[sig_end:]

