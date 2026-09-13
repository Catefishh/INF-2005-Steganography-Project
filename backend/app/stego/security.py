"""Standard-library and cryptography-backed v1 security operations."""

from __future__ import annotations

import hashlib
import re
import secrets
import struct
from collections.abc import Mapping
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any

from cryptography.exceptions import InvalidSignature, InvalidTag
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from .protocol import (
    MAX_ENCRYPTED_ENVELOPE_BYTES,
    MAX_LOCATOR_BYTES,
    MAX_SIGNED_PACKAGE_BYTES,
    SIGNATURE_BYTES,
    ProtocolError,
    format_uint64,
    measure_encrypted_envelope_length,
    pack_signed_package,
    parse_locator,
    parse_record,
    serialize_locator,
    serialize_record,
    unpack_signed_package,
)


RECORD_SIGNATURE_DOMAIN = b"stegloc/v1/signed-record\x00"
LOCATOR_SIGNATURE_DOMAIN = b"stegloc/v1/signed-locator\x00"
PAYLOAD_AAD = b"stegloc/v1/aes-256-gcm/payload\x00"

_HKDF_LABELS = {
    "payload": b"stegloc/v1/hkdf/payload-key\x00",
    "locator": b"stegloc/v1/hkdf/locator-key\x00",
    "start_selection": b"stegloc/v1/hkdf/start-selection-key\x00",
}
_RECOVERY_CODE = re.compile(
    r"STEGLOC1-(?:[0-9a-f]{8}-){7}[0-9a-f]{8}\Z"
)
_SIDECAR_MAGIC = b"STGL"
_SIDECAR_VERSION = 1
_SIDECAR_HEADER = struct.Struct(">4sB16s12s")
_MIN_SIDECAR_BYTES = _SIDECAR_HEADER.size + 1 + SIGNATURE_BYTES + 16
_MAX_SIDECAR_BYTES = _SIDECAR_HEADER.size + MAX_LOCATOR_BYTES + SIGNATURE_BYTES + 16


class KeyFormatError(ValueError):
    """A key is malformed, has the wrong type, or cannot be decrypted."""


class SignatureVerificationError(ValueError):
    """An Ed25519 signature does not verify for the selected public key."""


class RecoveryError(ValueError):
    """Recovery material is malformed or cannot authenticate a locator."""


class AuthenticationError(ValueError):
    """AES-GCM authentication failed."""


class IntegrityError(ValueError):
    """Authenticated metadata and observed bytes have different digests."""


class ConsistencyError(ValueError):
    """Individually valid protocol structures disagree."""


@dataclass(frozen=True, repr=False)
class DerivedKeys:
    payload: bytes
    locator: bytes
    start_selection: bytes


@dataclass(frozen=True)
class Bundle:
    encrypted_package: bytes = field(repr=False)
    sidecar: bytes = field(repr=False)
    recovery_code: str = field(repr=False)


@dataclass(frozen=True)
class VerifiedPackage:
    record: Mapping[str, Any]
    content: bytes


@dataclass(frozen=True)
class VerifiedBundle:
    record: Mapping[str, Any]
    content: bytes
    locator: Mapping[str, Any]


def _freeze(value: Any) -> Any:
    if type(value) is dict:
        return MappingProxyType({key: _freeze(item) for key, item in value.items()})
    if type(value) is list:
        return tuple(_freeze(item) for item in value)
    return value


def sha256_hex(data: bytes) -> str:
    if type(data) is not bytes:
        raise ValueError("SHA-256 input must be bytes")
    return hashlib.sha256(data).hexdigest()


def generate_ed25519_private_key() -> Ed25519PrivateKey:
    return Ed25519PrivateKey.generate()


def _password_bytes(password: str | bytes) -> bytes:
    if type(password) is str:
        encoded = password.encode("utf-8")
    elif type(password) is bytes:
        encoded = password
    else:
        raise ValueError("password must be text or bytes")
    if not encoded:
        raise ValueError("password must not be empty")
    return encoded


def export_private_key_pem(
    private_key: Ed25519PrivateKey, password: str | bytes
) -> bytes:
    if not isinstance(private_key, Ed25519PrivateKey):
        raise KeyFormatError("private key must be an Ed25519 private key")
    return private_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.BestAvailableEncryption(_password_bytes(password)),
    )


def import_private_key_pem(data: bytes, password: str | bytes) -> Ed25519PrivateKey:
    if type(data) is not bytes:
        raise KeyFormatError("private key PEM must be bytes")
    try:
        key = serialization.load_pem_private_key(data, password=_password_bytes(password))
    except (TypeError, ValueError) as exc:
        raise KeyFormatError("private key PEM or password is invalid") from exc
    if not isinstance(key, Ed25519PrivateKey):
        raise KeyFormatError("private key PEM is not an Ed25519 private key")
    return key


def export_public_key_pem(public_key: Ed25519PublicKey) -> bytes:
    if not isinstance(public_key, Ed25519PublicKey):
        raise KeyFormatError("public key must be an Ed25519 public key")
    return public_key.public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    )


def import_public_key_pem(data: bytes) -> Ed25519PublicKey:
    if type(data) is not bytes:
        raise KeyFormatError("public key PEM must be bytes")
    try:
        key = serialization.load_pem_public_key(data)
    except (TypeError, ValueError) as exc:
        raise KeyFormatError("public key PEM is invalid") from exc
    if not isinstance(key, Ed25519PublicKey):
        raise KeyFormatError("public key PEM is not an Ed25519 public key")
    return key


def public_key_fingerprint(public_key: Ed25519PublicKey) -> str:
    if not isinstance(public_key, Ed25519PublicKey):
        raise KeyFormatError("public key must be an Ed25519 public key")
    raw = public_key.public_bytes(
        serialization.Encoding.Raw,
        serialization.PublicFormat.Raw,
    )
    return sha256_hex(raw)


def sign_bytes(
    private_key: Ed25519PrivateKey, data: bytes, domain: bytes
) -> bytes:
    if not isinstance(private_key, Ed25519PrivateKey):
        raise KeyFormatError("private key must be an Ed25519 private key")
    if type(data) is not bytes or type(domain) is not bytes or not domain:
        raise ValueError("signature data and nonempty domain must be bytes")
    return private_key.sign(domain + data)


def verify_bytes(
    public_key: Ed25519PublicKey,
    data: bytes,
    signature: bytes,
    domain: bytes,
) -> None:
    if not isinstance(public_key, Ed25519PublicKey):
        raise KeyFormatError("public key must be an Ed25519 public key")
    if type(data) is not bytes or type(domain) is not bytes or not domain:
        raise ValueError("signature data and nonempty domain must be bytes")
    if type(signature) is not bytes or len(signature) != SIGNATURE_BYTES:
        raise SignatureVerificationError("signature must be exactly 64 bytes")
    try:
        public_key.verify(signature, domain + data)
    except InvalidSignature as exc:
        raise SignatureVerificationError("signature verification failed") from exc


def generate_recovery_secret() -> bytes:
    return secrets.token_bytes(32)


def encode_recovery_code(secret: bytes) -> str:
    if type(secret) is not bytes or len(secret) != 32:
        raise RecoveryError("recovery secret must be exactly 32 bytes")
    hexadecimal = secret.hex()
    return "STEGLOC1-" + "-".join(
        hexadecimal[index : index + 8] for index in range(0, 64, 8)
    )


def decode_recovery_code(code: str) -> bytes:
    if type(code) is not str or _RECOVERY_CODE.fullmatch(code) is None:
        raise RecoveryError("recovery code is invalid")
    return bytes.fromhex(code.removeprefix("STEGLOC1-").replace("-", ""))


def generate_salt() -> bytes:
    return secrets.token_bytes(16)


def _require_bytes(value: bytes, length: int, name: str) -> None:
    if type(value) is not bytes or len(value) != length:
        raise ValueError(f"{name} must be exactly {length} bytes")


def derive_keys(secret: bytes, salt: bytes) -> DerivedKeys:
    _require_bytes(secret, 32, "recovery secret")
    _require_bytes(salt, 16, "salt")

    def derive(label: bytes) -> bytes:
        return HKDF(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            info=label,
        ).derive(secret)

    return DerivedKeys(
        payload=derive(_HKDF_LABELS["payload"]),
        locator=derive(_HKDF_LABELS["locator"]),
        start_selection=derive(_HKDF_LABELS["start_selection"]),
    )


def encrypt_payload(plaintext: bytes, key: bytes) -> bytes:
    if type(plaintext) is not bytes:
        raise ValueError("payload plaintext must be bytes")
    if len(plaintext) > MAX_SIGNED_PACKAGE_BYTES:
        raise ValueError("payload plaintext length exceeds the v1 bound")
    _require_bytes(key, 32, "payload key")
    nonce = secrets.token_bytes(12)
    try:
        return nonce + AESGCM(key).encrypt(nonce, plaintext, PAYLOAD_AAD)
    except OverflowError as exc:
        raise ValueError("payload plaintext length exceeds the AES-GCM bound") from exc


def decrypt_payload(encrypted: bytes, key: bytes) -> bytes:
    if (
        type(encrypted) is not bytes
        or len(encrypted) < 28
        or len(encrypted) > MAX_ENCRYPTED_ENVELOPE_BYTES
    ):
        if type(encrypted) is bytes and len(encrypted) > MAX_ENCRYPTED_ENVELOPE_BYTES:
            raise AuthenticationError("payload length exceeds the v1 bound")
        raise AuthenticationError("payload authentication failed")
    _require_bytes(key, 32, "payload key")
    try:
        return AESGCM(key).decrypt(encrypted[:12], encrypted[12:], PAYLOAD_AAD)
    except (InvalidTag, OverflowError) as exc:
        raise AuthenticationError("payload authentication failed") from exc


def create_signed_package(
    record: dict[str, Any], content: bytes, private_key: Ed25519PrivateKey
) -> bytes:
    record_bytes = serialize_record(record)
    if record["content"]["byte_length"] != len(content):
        raise ConsistencyError("record content byte length does not match content")
    if record["content"]["sha256"] != sha256_hex(content):
        raise IntegrityError("record content digest does not match content")
    if record["signer_fingerprint"] != public_key_fingerprint(private_key.public_key()):
        raise ConsistencyError("record signer fingerprint does not match private key")
    expected_length = measure_encrypted_envelope_length(record, len(content))
    if record["encoded_byte_length"] != format_uint64(expected_length):
        raise ConsistencyError("record encoded byte length does not match envelope")
    signature = sign_bytes(private_key, record_bytes, RECORD_SIGNATURE_DOMAIN)
    return pack_signed_package(record_bytes, signature, content)


def verify_signed_package(
    package: bytes, public_key: Ed25519PublicKey
) -> VerifiedPackage:
    parts = unpack_signed_package(package)
    try:
        verify_bytes(
            public_key,
            parts.record_bytes,
            parts.signature,
            RECORD_SIGNATURE_DOMAIN,
        )
    except SignatureVerificationError as exc:
        raise SignatureVerificationError("record signature verification failed") from exc

    # Parsing occurs only after the exact received record bytes are authenticated.
    record = parse_record(parts.record_bytes)
    if record["signer_fingerprint"] != public_key_fingerprint(public_key):
        raise ConsistencyError("record signer fingerprint does not match public key")
    if record["content"]["byte_length"] != len(parts.content):
        raise ConsistencyError("record content byte length does not match content")
    if record["content"]["sha256"] != sha256_hex(parts.content):
        raise IntegrityError("record content digest does not match content")
    return VerifiedPackage(record=_freeze(record), content=parts.content)


def locator_from_record(
    record: dict[str, Any], encrypted_package: bytes
) -> dict[str, str]:
    serialize_record(record)
    if type(encrypted_package) is not bytes:
        raise ValueError("encrypted package must be bytes")
    return {
        "carrier_descriptor": record["carrier_descriptor"],
        "depth": record["depth"],
        "encoded_byte_length": record["encoded_byte_length"],
        "encrypted_package_sha256": sha256_hex(encrypted_package),
        "media_id": record["media_id"],
        "protocol": record["protocol"],
        "start_slot": record["start_slot"],
    }


def create_sidecar(
    locator: dict[str, Any],
    private_key: Ed25519PrivateKey,
    locator_key: bytes,
    salt: bytes,
) -> bytes:
    _require_bytes(locator_key, 32, "locator key")
    _require_bytes(salt, 16, "salt")
    locator_bytes = serialize_locator(locator)
    signature = sign_bytes(private_key, locator_bytes, LOCATOR_SIGNATURE_DOMAIN)
    plaintext = locator_bytes + signature
    nonce = secrets.token_bytes(12)
    header = _SIDECAR_HEADER.pack(
        _SIDECAR_MAGIC,
        _SIDECAR_VERSION,
        salt,
        nonce,
    )
    ciphertext = AESGCM(locator_key).encrypt(nonce, plaintext, header)
    return header + ciphertext


def _parse_sidecar(sidecar: bytes) -> tuple[bytes, bytes, bytes, bytes]:
    if type(sidecar) is not bytes or len(sidecar) < _SIDECAR_HEADER.size:
        raise ProtocolError("sidecar header is truncated")
    magic, version, salt, nonce = _SIDECAR_HEADER.unpack_from(sidecar)
    if magic != _SIDECAR_MAGIC:
        raise ProtocolError("sidecar magic is invalid")
    if version != _SIDECAR_VERSION:
        raise ProtocolError("sidecar version is unsupported")
    if not _MIN_SIDECAR_BYTES <= len(sidecar) <= _MAX_SIDECAR_BYTES:
        raise ProtocolError("sidecar total length is outside the v1 bound")
    return salt, nonce, sidecar[: _SIDECAR_HEADER.size], sidecar[_SIDECAR_HEADER.size :]


def _decrypt_and_verify_locator(
    sidecar: bytes,
    locator_key: bytes,
    public_key: Ed25519PublicKey,
) -> dict[str, Any]:
    _require_bytes(locator_key, 32, "locator key")
    _, nonce, header, ciphertext = _parse_sidecar(sidecar)
    try:
        plaintext = AESGCM(locator_key).decrypt(nonce, ciphertext, header)
    except InvalidTag as exc:
        raise RecoveryError("recovery material or locator is invalid") from exc
    if not SIGNATURE_BYTES < len(plaintext) <= MAX_LOCATOR_BYTES + SIGNATURE_BYTES:
        raise RecoveryError("recovery material or locator is invalid")
    locator_bytes = plaintext[:-SIGNATURE_BYTES]
    signature = plaintext[-SIGNATURE_BYTES:]
    try:
        verify_bytes(public_key, locator_bytes, signature, LOCATOR_SIGNATURE_DOMAIN)
    except SignatureVerificationError as exc:
        raise SignatureVerificationError("locator signature verification failed") from exc
    return parse_locator(locator_bytes)


def create_bundle(
    record: dict[str, Any],
    content: bytes,
    private_key: Ed25519PrivateKey,
    *,
    secret: bytes | None = None,
    salt: bytes | None = None,
) -> Bundle:
    secret = generate_recovery_secret() if secret is None else secret
    salt = generate_salt() if salt is None else salt
    _require_bytes(secret, 32, "recovery secret")
    _require_bytes(salt, 16, "salt")
    keys = derive_keys(secret, salt)
    signed_package = create_signed_package(record, content, private_key)
    encrypted_package = encrypt_payload(signed_package, keys.payload)
    if record["encoded_byte_length"] != format_uint64(len(encrypted_package)):
        raise ConsistencyError("record encoded byte length does not match ciphertext")
    locator = locator_from_record(record, encrypted_package)
    return Bundle(
        encrypted_package=encrypted_package,
        sidecar=create_sidecar(locator, private_key, keys.locator, salt),
        recovery_code=encode_recovery_code(secret),
    )


def verify_bundle(
    encrypted_package: bytes,
    sidecar: bytes,
    recovery_code: str,
    public_key: Ed25519PublicKey,
) -> VerifiedBundle:
    secret = decode_recovery_code(recovery_code)
    salt, _, _, _ = _parse_sidecar(sidecar)
    keys = derive_keys(secret, salt)

    # Trust is established in this order: locator AEAD, locator signature,
    # ciphertext digest, payload AEAD, exact record signature, then consistency.
    locator = _decrypt_and_verify_locator(sidecar, keys.locator, public_key)
    if locator["encrypted_package_sha256"] != sha256_hex(encrypted_package):
        raise IntegrityError("encrypted package digest does not match locator")
    signed_package = decrypt_payload(encrypted_package, keys.payload)
    verified = verify_signed_package(signed_package, public_key)

    compared_fields = (
        "carrier_descriptor",
        "depth",
        "encoded_byte_length",
        "media_id",
        "protocol",
        "start_slot",
    )
    if any(locator[field] != verified.record[field] for field in compared_fields):
        raise ConsistencyError("locator and record identity or placement disagree")
    if locator["encoded_byte_length"] != format_uint64(len(encrypted_package)):
        raise ConsistencyError("signed encoded byte length does not match ciphertext")
    return VerifiedBundle(
        record=verified.record,
        content=verified.content,
        locator=_freeze(locator),
    )
