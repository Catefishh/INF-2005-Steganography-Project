"""Signed and encrypted V3 text protection; carrier algorithms are in text_carrier."""
from __future__ import annotations

import base64
import hashlib
import json
import os
import struct

from cryptography.exceptions import InvalidSignature, InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import hashes

from .v2_security import decode_recovery_code, recovery_code

from .text_carrier import MAGIC, DOMAIN, METHODS, MAX_MESSAGE, MAX_CARRIER, encode, decode

def _json(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")

def estimate(message: str, method: str, visible: str = "") -> dict:
    payload = message.encode("utf-8")
    if method not in METHODS or len(payload) > MAX_MESSAGE:
        raise ValueError("Method or message length is invalid (32 KiB maximum)")
    record = {
        "version": 3,
        "method": method,
        "message_length": len(payload),
        "message_sha256": hashlib.sha256(payload).hexdigest(),
    }
    package = _json({
        "record": record,
        "message": base64.b64encode(payload).decode("ascii"),
        "signature": base64.b64encode(bytes(64)).decode("ascii"),
    })
    frame_bytes = 9 + 16 + 12 + len(package) + 16
    units = frame_bytes * (2 if method == "acrostic" else 8)
    return {"message_bytes": len(payload), "frame_bytes": frame_bytes,
            "required_lines_or_symbols": units,
            "method": method, "existing_visible_characters": len(visible)}


def protect(message: str, method: str, visible: str, private_key) -> dict:
    payload = message.encode("utf-8")
    if method not in METHODS or len(payload) > MAX_MESSAGE:
        raise ValueError("Method or message length is invalid (32 KiB maximum)")
    record = {
        "version": 3,
        "method": method,
        "message_length": len(payload),
        "message_sha256": hashlib.sha256(payload).hexdigest(),
    }
    signed = DOMAIN + _json(record) + b"\0" + payload
    package = _json({
        "record": record,
        "message": base64.b64encode(payload).decode("ascii"),
        "signature": base64.b64encode(private_key.sign(signed)).decode("ascii"),
    })
    secret, salt, nonce = os.urandom(32), os.urandom(16), os.urandom(12)
    key = HKDF(algorithm=hashes.SHA256(), length=32, salt=salt, info=DOMAIN).derive(secret)
    encrypted = AESGCM(key).encrypt(nonce, package, DOMAIN + method.encode())
    body = salt + nonce + encrypted
    frame = MAGIC + struct.pack(">I", len(body)) + body
    carrier = encode(frame, method, visible)
    if len(carrier.encode("utf-8")) > MAX_CARRIER:
        raise ValueError("Resulting text carrier exceeds 2 MiB")
    recovery = _json({"version": 3, "method": method, "frame_sha256": hashlib.sha256(frame).hexdigest()})
    return {"carrier": carrier, "recovery": recovery, "recovery_code": recovery_code(secret),
            "record": record, "frame_bytes": len(frame),
            "required_lines_or_symbols": len(frame) * (2 if method == "acrostic" else 8)}


def verify(carrier: str, recovery: bytes, code: str, public_key) -> dict:
    if len(recovery) > 4096:
        raise ValueError("Recovery material is too large")
    try:
        meta = json.loads(recovery)
        valid_fields = set(meta) == {"version", "method", "frame_sha256"}
        if not valid_fields or meta["version"] != 3 or meta["method"] not in METHODS:
            raise ValueError
    except (ValueError, TypeError) as exc:
        raise ValueError("Recovery material is invalid") from exc
    frame = decode(carrier, meta["method"])
    if hashlib.sha256(frame).hexdigest() != meta["frame_sha256"]:
        raise ValueError("Hidden symbols differ from recovery material")
    secret = decode_recovery_code(code)
    body = frame[9:]
    salt, nonce, encrypted = body[:16], body[16:28], body[28:]
    key = HKDF(algorithm=hashes.SHA256(), length=32, salt=salt, info=DOMAIN).derive(secret)
    try:
        package = json.loads(AESGCM(key).decrypt(nonce, encrypted, DOMAIN + meta["method"].encode()))
        if set(package) != {"record", "message", "signature"}:
            raise ValueError
        record = package["record"]
        valid_fields = set(record) == {"version", "method", "message_length", "message_sha256"}
        if not valid_fields or record["version"] != 3 or record["method"] != meta["method"]:
            raise ValueError
        payload = base64.b64decode(package["message"], validate=True)
        signature = base64.b64decode(package["signature"], validate=True)
        public_key.verify(signature, DOMAIN + _json(record) + b"\0" + payload)
        length_matches = len(payload) == record["message_length"]
        digest_matches = hashlib.sha256(payload).hexdigest() == record["message_sha256"]
        if not length_matches or not digest_matches:
            raise ValueError
        message = payload.decode("utf-8")
    except (InvalidTag, InvalidSignature, ValueError, UnicodeError, KeyError, TypeError) as exc:
        raise ValueError("Text message authentication or signature verification failed") from exc
    return {"verdict": "Authentic", "message": message, "record": record,
            "visible_text_authenticated": False}
