"""Signed DCT PNG envelope, independent of the legacy LSB wire format."""
import hashlib
import hmac
import json
import os
import struct
import uuid
from datetime import datetime, timezone

from cryptography.exceptions import InvalidTag

from .dct_codec import DctCarrier, HEADER_BYTES, HEADER_SLOTS
from .legacy_record import _limit, _pack, _unpack, canonical_json, package_size
from .legacy_types import CapacityError, Verdict
from .security import (decrypt, derive_keys, encrypt, fingerprint, load_private_key,
                       load_public_key, sha256_hex, sign_digest, verify_digest)

MAGIC = b"DCT1"
HEADER_PLAIN = struct.Struct(">QQQ")
SALT_BYTES = 16
MAX_PACKAGE_BYTES = 100 * 1024 * 1024
ZERO_HASH = "0" * 64


def record_for(descriptor, cover_filename, payload_filename, payload_type, payload_size, team,
               signer, start, header, slots, package_length, cover_hash, payload_hash,
               media_id, timestamp, nonce, width, height):
    return {"protocol": "stegloc/dct/1", "media_id": media_id, "timestamp": timestamp,
            "nonce": nonce, "team": team, "signer_fingerprint": signer,
            "cover": {"type": "image", "descriptor": descriptor, "filename": cover_filename,
                      "width": f"{width:020d}", "height": f"{height:020d}", "sha256": cover_hash},
            "payload": {"filename": payload_filename, "media_type": payload_type,
                        "size": payload_size, "sha256": payload_hash},
            "embedding": {"method": "DCT", "version": 1, "start_slot": f"{start:020d}",
                          "header_slot": f"{header:020d}", "total_slots": f"{slots:020d}",
                          "package_bytes": f"{package_length:020d}"},
            "algorithms": {"hash": "SHA-256", "signature": "RSA-PSS (SHA-256)",
                           "encryption": "AES-256-GCM", "key_derivation": "PBKDF2-HMAC-SHA256"}}


def estimate_package_bytes(cover_kind, descriptor, cover_filename, payload_filename, payload_type,
                           payload_size, team="", key_bits=2048):
    if cover_kind != "image":
        raise ValueError("DCT embedding requires an image cover.")
    if not 0 <= payload_size <= MAX_PACKAGE_BYTES:
        raise ValueError("Payload size is outside the DCT limit.")
    record = record_for(descriptor, _limit(cover_filename, "Cover filename"),
                        _limit(payload_filename, "Payload filename"), _limit(payload_type, "Payload type"),
                        payload_size, _limit(team, "Team"), ZERO_HASH, 0, 0, 0, 0,
                        ZERO_HASH, ZERO_HASH, str(uuid.UUID(int=0)), "2000-01-01T00:00:00Z", "0" * 32, 0, 0)
    return package_size(len(canonical_json(record)), (key_bits + 7) // 8, payload_size)


def hide(cover_data, cover_filename, content, payload_filename, payload_type, passphrase,
         private_key_pem, key_password=None, team=""):
    if not passphrase:
        raise ValueError("A passphrase is required.")
    if len(content) > MAX_PACKAGE_BYTES:
        raise ValueError("Payload is larger than the DCT limit.")
    cover = DctCarrier(cover_data)
    private_key = load_private_key(private_key_pem, key_password)
    signer = fingerprint(private_key.public_key())
    cover_filename = _limit(cover_filename, "Cover filename") or "cover"
    payload_filename = _limit(payload_filename, "Payload filename") or "payload.bin"
    payload_type = _limit(payload_type, "Payload type") or "application/octet-stream"
    team = _limit(team, "Team")
    header = cover.n_slots - HEADER_SLOTS
    salt = os.urandom(SALT_BYTES)
    keys = derive_keys(passphrase, salt)
    media_id = str(uuid.uuid4())
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    nonce = os.urandom(16).hex()
    payload_hash = sha256_hex(content)

    def record(start, length, cover_hash):
        return record_for(cover.descriptor, cover_filename, payload_filename, payload_type,
                          len(content), team, signer, start, header, cover.n_slots, length,
                          cover_hash, payload_hash, media_id, timestamp, nonce, cover.width, cover.height)

    signature_length = (private_key.key_size + 7) // 8
    length = package_size(len(canonical_json(record(0, 0, ZERO_HASH))), signature_length, len(content))
    if header < 2 or length > cover.capacity_bytes:
        raise CapacityError(f"DCT payload needs {length:,} bytes; this image holds {cover.capacity_bytes:,}. Choose a larger image or smaller payload.")
    span = length * 8
    message = salt + cover.descriptor.encode() + span.to_bytes(8, "big")
    start = 1 + int.from_bytes(hmac.new(keys["start"], message, hashlib.sha256).digest(), "big") % (header - span)
    cover_hash = cover.stable_hash(start, length)
    record_json = canonical_json(record(start, length, cover_hash))
    if len(record_json) != len(canonical_json(record(0, 0, ZERO_HASH))):
        raise RuntimeError("DCT signed record changed size")
    signature = sign_digest(private_key, hashlib.sha256(record_json).digest())
    associated = MAGIC + salt
    package = encrypt(keys["payload"], _pack(record_json, signature, content), associated)
    if len(package) != length:
        raise RuntimeError("DCT package changed size")
    header_bytes = MAGIC + salt + encrypt(keys["header"], HEADER_PLAIN.pack(start, length, cover.n_slots), associated)
    header_bytes += bytes(HEADER_BYTES - len(header_bytes))
    stego = cover.embed_ranges([(start, package), (header, header_bytes)])
    reopened = DctCarrier(stego)
    if reopened.read_bytes(length, start) != package or reopened.read_bytes(HEADER_BYTES, header) != header_bytes:
        raise ValueError("DCT output did not retain the complete encrypted package")
    report = {"method": "dct", "cover": {"kind": "image", "descriptor": cover.descriptor,
              "width": cover.width, "height": cover.height, "mode": cover.mode,
              "format": cover.source_format, "output_format": "PNG", "n_slots": cover.n_slots,
              "lossy_source": cover.source_format in {"JPEG", "MPO"}},
              "start": {"slot": start, "text": f"DCT slot {start:,}"},
              "header": {"slot": header, "text": f"DCT slot {header:,}"},
              "span_slots": span, "package_bytes": length, "capacity_bytes": cover.capacity_bytes,
              "record": json.loads(record_json), "record_sha256": sha256_hex(record_json),
              "signature_hex": signature.hex(), "signer_fingerprint": signer,
              "salt_hex": salt.hex(), "stego_size": len(stego),
              "coverage": cover.coverage(start, length),
              "steps": [{"title": "DCT embedding", "detail": "Signed and encrypted payload in 8×8 RGB coefficient blocks."}]}
    return stego, cover, report


def verify(stego_data, passphrase, public_key_pem, **manual):
    info = {"method": "dct"}
    labels = [("load", "Read PNG and public key"), ("header", "Detect DCT1 bootstrap"),
              ("unlock", "Authenticate DCT header"), ("extract", "Read transform slots"),
              ("decrypt", "Authenticate encrypted package"), ("signature", "Verify RSA signature"),
              ("payload_hash", "Check payload SHA-256"), ("cover_hash", "Check protected non-embedding pixels")]
    steps = {name: {"id": name, "title": title, "status": "skipped", "detail": ""} for name, title in labels}
    def ok(name, detail):
        steps[name].update(status="passed", detail=detail)
    def result(verdict, summary, record=None, trusted=False, content=None, stage="header"):
        if content is None:
            steps[stage].update(status="failed", detail=summary)
        return {"verdict": verdict, "summary": summary,
                "steps": [steps[name] for name, _ in labels],
                "info": info, "record": record, "record_trusted": trusted, "content": content}
    if any(value is not None for value in manual.values()):
        return result(Verdict.CANNOT_VERIFY, "Manual LSB locations are not supported for DCT images.", stage="load")
    try:
        cover = DctCarrier(stego_data)
        key = load_public_key(public_key_pem)
        if not passphrase:
            raise ValueError("A passphrase is required.")
    except ValueError as exc:
        return result(Verdict.CANNOT_VERIFY, str(exc), stage="load")
    info["cover"] = {"kind": "image", "descriptor": cover.descriptor, "width": cover.width,
                     "height": cover.height, "mode": cover.mode}
    ok("load", f"{cover.width}×{cover.height} {cover.mode}; public key {fingerprint(key)[:16]}…")
    header = cover.n_slots - HEADER_SLOTS
    if header < 1:
        return result(Verdict.PAYLOAD_MISSING, "Image is too small for a DCT header.")
    blob = cover.read_bytes(HEADER_BYTES, header)
    if blob[:4] != MAGIC:
        return result(Verdict.PAYLOAD_MISSING, "No supported DCT header found.")
    ok("header", "DCT1 bootstrap found in the final 1,024 transform slots")
    salt = blob[4:20]
    try:
        keys = derive_keys(passphrase, salt)
        plain = decrypt(keys["header"], blob[20:20 + 52], MAGIC + salt)
        start, length, slots = HEADER_PLAIN.unpack(plain)
    except (InvalidTag, ValueError, struct.error):
        return result(Verdict.CANNOT_VERIFY, "Wrong passphrase or altered DCT header.", stage="unlock")
    if (slots != cover.n_slots or length < 1 or length > min(MAX_PACKAGE_BYTES, cover.capacity_bytes)
            or start < 1 or start + length * 8 > header):
        return result(Verdict.CANNOT_VERIFY, "DCT header has invalid bounds or dimensions.", stage="unlock")
    if any(blob[72:]):
        return result(Verdict.CANNOT_VERIFY, "DCT header padding is damaged.", stage="header")
    ok("unlock", f"Authenticated start {start:,}, package {length:,} bytes, {cover.n_slots:,} slots")
    info.update(start={"slot": start, "text": f"DCT slot {start:,}"},
                header={"slot": header, "text": f"DCT slot {header:,}"},
                package_bytes=length, span_slots=length * 8, coverage=cover.coverage(start, length))
    try:
        package = cover.read_bytes(length, start)
        ok("extract", f"Read {length * 8:,} transform slots starting at {start:,}")
        record_json, signature, content = _unpack(decrypt(keys["payload"], package, MAGIC + salt))
        record = json.loads(record_json)
        if not isinstance(record, dict) or len(record_json) > 16384 or canonical_json(record) != record_json:
            raise ValueError("invalid DCT record")
    except InvalidTag:
        return result(Verdict.TAMPERED, "DCT payload authentication failed; hidden data was altered.", stage="decrypt")
    except (ValueError, IndexError, struct.error, KeyError, TypeError, RecursionError):
        return result(Verdict.CANNOT_VERIFY, "Malformed DCT signed package.", stage="decrypt")
    ok("decrypt", f"AES-GCM tag valid; record {len(record_json):,} bytes; payload {len(content):,} bytes")
    if not verify_digest(key, hashlib.sha256(record_json).digest(), signature):
        return result(Verdict.SIGNATURE_INVALID, "DCT RSA signature is invalid for this public key.", stage="signature")
    ok("signature", f"RSA-PSS valid for {fingerprint(key)[:16]}…")
    try:
        placement = record["embedding"]
        signed_cover = record["cover"]
        payload = record["payload"]
        matching = (record["protocol"] == "stegloc/dct/1" and placement["method"] == "DCT"
                    and placement["version"] == 1 and placement["start_slot"] == f"{start:020d}"
                    and placement["header_slot"] == f"{header:020d}"
                    and placement["total_slots"] == f"{cover.n_slots:020d}"
                    and placement["package_bytes"] == f"{length:020d}"
                    and signed_cover["descriptor"] == cover.descriptor
                    and signed_cover["width"] == f"{cover.width:020d}"
                    and signed_cover["height"] == f"{cover.height:020d}"
                    and record["signer_fingerprint"] == fingerprint(key))
        if not matching:
            return result(Verdict.TAMPERED, "Signed DCT placement or dimensions do not match the carrier.", record, True, stage="cover_hash")
        if payload["size"] != len(content) or payload["sha256"] != sha256_hex(content):
            return result(Verdict.TAMPERED, "Signed payload digest does not match.", record, True, stage="payload_hash")
        info["payload_hash"] = {"algorithm": "SHA-256", "scope": "decoded payload bytes",
                                "expected": payload["sha256"], "computed": sha256_hex(content),
                                "status": "match", "expected_trusted": True}
        ok("payload_hash", f"SHA-256 matches {payload['sha256']}")
        if signed_cover["sha256"] != cover.stable_hash(start, length):
            return result(Verdict.TAMPERED, "Protected non-embedding pixels changed.", record, True, stage="cover_hash")
    except (KeyError, TypeError, ValueError):
        return result(Verdict.TAMPERED, "Signed DCT record is malformed.", record, True, stage="cover_hash")
    ok("cover_hash", f"SHA-256 matches for {info['coverage']['protected_rgb_values']:,} RGB values and {info['coverage']['alpha_values']:,} alpha values")
    return result(Verdict.AUTHENTIC,
                  "Signature and payload authentication valid; non-embedding RGB pixels and all alpha values match the signed hash.",
                  record, True, content, stage="cover_hash")
