"""Ed25519 and recovery-sidecar operations for the independent v2 workflow."""
from __future__ import annotations

import base64
import hashlib
import json
import os
import struct
from dataclasses import dataclass

from cryptography.exceptions import InvalidSignature, InvalidTag, UnsupportedAlgorithm
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import hashes

from .protocol import (
    ProtocolError, canonical_json, pack_signed_package, parse_locator, parse_record,
    serialize_locator, serialize_record, unpack_signed_package,
)

MAGIC = b"STLC\x01"
RECORD_DOMAIN = b"stegloc/v1/record\x00"
LOCATOR_DOMAIN = b"stegloc/v1/locator\x00"


class RecoveryError(ValueError):
    pass


class AuthenticationError(ValueError):
    pass


class SignatureVerificationError(ValueError):
    pass


class IntegrityError(ValueError):
    pass


class ConsistencyError(ValueError):
    pass


@dataclass(frozen=True)
class Keys:
    payload: bytes
    locator: bytes
    start_selection: bytes


@dataclass(frozen=True)
class Bundle:
    encrypted_package: bytes
    sidecar: bytes
    recovery_code: str


@dataclass(frozen=True)
class VerifiedPackage:
    record: dict
    content: bytes


def _freeze(value):
    return json.loads(canonical_json(value))


def generate_recovery_secret() -> bytes:
    return os.urandom(32)


def generate_salt() -> bytes:
    return os.urandom(16)


def recovery_code(secret: bytes) -> str:
    if len(secret) != 32:
        raise RecoveryError("recovery secret must be 32 bytes")
    return base64.urlsafe_b64encode(secret).decode("ascii").rstrip("=")


def decode_recovery_code(code: str) -> bytes:
    try:
        if not isinstance(code, str) or len(code) != 43:
            raise ValueError
        secret = base64.b64decode(code + "=", altchars=b"-_", validate=True)
        if len(secret) != 32 or recovery_code(secret) != code:
            raise ValueError
        return secret
    except (ValueError, UnicodeEncodeError) as exc:
        raise RecoveryError("recovery code is invalid") from exc


def derive_keys(secret: bytes, salt: bytes) -> Keys:
    if len(secret) != 32 or len(salt) != 16:
        raise RecoveryError("recovery secret or salt has invalid length")
    def key(label: bytes) -> bytes:
        return HKDF(algorithm=hashes.SHA256(), length=32, salt=salt, info=b"stegloc/v1/" + label).derive(secret)
    return Keys(key(b"payload"), key(b"locator"), key(b"start"))


def generate_signing_keys(password: bytes | None = None) -> tuple[bytes, bytes]:
    private = Ed25519PrivateKey.generate()
    encryption = serialization.BestAvailableEncryption(password) if password else serialization.NoEncryption()
    return (
        private.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, encryption),
        private.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo),
    )


def load_signing_key(pem: bytes, password: bytes | None = None) -> Ed25519PrivateKey:
    try:
        key = serialization.load_pem_private_key(pem, password=password)
    except (TypeError, ValueError, UnsupportedAlgorithm) as exc:
        raise RecoveryError("Ed25519 private key or its password is invalid") from exc
    if not isinstance(key, Ed25519PrivateKey):
        raise RecoveryError("signing key must be Ed25519")
    return key


def load_verification_key(pem: bytes) -> Ed25519PublicKey:
    try:
        key = serialization.load_pem_public_key(pem)
    except (ValueError, UnsupportedAlgorithm) as exc:
        raise RecoveryError("Ed25519 public key is invalid") from exc
    if not isinstance(key, Ed25519PublicKey):
        raise RecoveryError("verification key must be Ed25519")
    return key


def public_key_fingerprint(key: Ed25519PublicKey) -> str:
    raw = key.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return hashlib.sha256(raw).hexdigest()


def _parse_sidecar(sidecar: bytes) -> tuple[bytes, bytes, bytes, bytes]:
    if not isinstance(sidecar, bytes) or len(sidecar) < 5 + 16 + 12 + 16 or len(sidecar) > 8192 or not sidecar.startswith(MAGIC):
        raise RecoveryError("recovery file is invalid")
    header = sidecar[:21]
    return sidecar[5:21], sidecar[21:33], sidecar[33:], header


def create_bundle(record: dict, content: bytes, private_key: Ed25519PrivateKey, *, secret: bytes, salt: bytes) -> Bundle:
    keys = derive_keys(secret, salt)
    record_bytes = serialize_record(record)
    signature = private_key.sign(RECORD_DOMAIN + record_bytes)
    package = pack_signed_package(record_bytes, signature, content)
    nonce = os.urandom(12)
    encrypted = nonce + AESGCM(keys.payload).encrypt(nonce, package, b"stegloc/v1/payload")
    locator = {field: record[field] for field in (
        "carrier_descriptor", "depth", "encoded_byte_length", "media_id", "protocol", "start_slot"
    )}
    locator["encrypted_package_sha256"] = hashlib.sha256(encrypted).hexdigest()
    locator_bytes = serialize_locator(locator)
    signed_locator = struct.pack(">H", len(locator_bytes)) + locator_bytes + private_key.sign(LOCATOR_DOMAIN + locator_bytes)
    header = MAGIC + salt
    locator_nonce = os.urandom(12)
    sidecar = header + locator_nonce + AESGCM(keys.locator).encrypt(locator_nonce, signed_locator, header)
    return Bundle(encrypted, sidecar, recovery_code(secret))


def _decrypt_and_verify_locator(sidecar: bytes, key: bytes, public_key: Ed25519PublicKey) -> dict:
    _, nonce, ciphertext, header = _parse_sidecar(sidecar)
    try:
        plain = AESGCM(key).decrypt(nonce, ciphertext, header)
    except InvalidTag as exc:
        raise RecoveryError("recovery code or recovery file is invalid") from exc
    if len(plain) < 2 + 64:
        raise RecoveryError("recovery locator is truncated")
    length = struct.unpack_from(">H", plain)[0]
    if len(plain) != 2 + length + 64:
        raise RecoveryError("recovery locator length is invalid")
    loc_bytes = plain[2:2 + length]
    try:
        public_key.verify(plain[2 + length:], LOCATOR_DOMAIN + loc_bytes)
    except InvalidSignature as exc:
        raise SignatureVerificationError("recovery locator signature is invalid") from exc
    try:
        return parse_locator(loc_bytes)
    except ProtocolError as exc:
        raise RecoveryError(str(exc)) from exc


def decrypt_payload(encrypted: bytes, key: bytes) -> bytes:
    try:
        if len(encrypted) < 28:
            raise InvalidTag
        return AESGCM(key).decrypt(encrypted[:12], encrypted[12:], b"stegloc/v1/payload")
    except InvalidTag as exc:
        raise AuthenticationError("encrypted package authentication failed") from exc


def verify_signed_package(package: bytes, public_key: Ed25519PublicKey) -> VerifiedPackage:
    try:
        parts = unpack_signed_package(package)
    except ProtocolError as exc:
        raise IntegrityError(str(exc)) from exc
    try:
        public_key.verify(parts.signature, RECORD_DOMAIN + parts.record_bytes)
    except InvalidSignature as exc:
        raise SignatureVerificationError("signed record signature is invalid") from exc
    try:
        record = parse_record(parts.record_bytes)
    except ProtocolError as exc:
        raise IntegrityError(str(exc)) from exc
    if len(parts.content) != record["content"]["byte_length"] or hashlib.sha256(parts.content).hexdigest() != record["content"]["sha256"]:
        raise IntegrityError("content digest does not match signed record")
    if public_key_fingerprint(public_key) != record["signer_fingerprint"]:
        raise SignatureVerificationError("signer fingerprint does not match public key")
    return VerifiedPackage(record, parts.content)
