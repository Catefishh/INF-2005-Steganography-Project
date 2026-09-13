"""Deterministic v1 record, locator, and signed-package serialization."""

from __future__ import annotations

import json
import re
import struct
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any


PROTOCOL_ID = "stegloc-v1"
HASH_ALGORITHM = "sha256"
SIGNATURE_ALGORITHM = "ed25519"
CARRIER_HASH_PLACEHOLDER = "0" * 64

SIGNED_PACKAGE_MAGIC = b"STGP"
SIGNED_PACKAGE_VERSION = 1
SIGNED_PACKAGE_FLAGS = 0
SIGNATURE_BYTES = 64
AES_GCM_OVERHEAD_BYTES = 12 + 16

MAX_RECORD_BYTES = 16_384
MAX_LOCATOR_BYTES = 4_096
MAX_CONTENT_BYTES = 100 * 1024 * 1024
MAX_FILENAME_BYTES = 255
MAX_MEDIA_TYPE_BYTES = 127
MAX_DESCRIPTOR_BYTES = 512
MAX_TEAM_ENTRIES = 16
MAX_TEAM_KEY_BYTES = 32
MAX_TEAM_VALUE_BYTES = 128
MAX_UINT64 = 2**64 - 1

_PACKAGE_HEADER = struct.Struct(">4sBBIQ")
MAX_SIGNED_PACKAGE_BYTES = (
    _PACKAGE_HEADER.size + MAX_RECORD_BYTES + SIGNATURE_BYTES + MAX_CONTENT_BYTES
)
MAX_ENCRYPTED_ENVELOPE_BYTES = AES_GCM_OVERHEAD_BYTES + MAX_SIGNED_PACKAGE_BYTES
_LOWER_HEX_32 = re.compile(r"[0-9a-f]{32}\Z")
_LOWER_HEX_64 = re.compile(r"[0-9a-f]{64}\Z")
_UTC_TIMESTAMP = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\Z")
_UINT64_TEXT = re.compile(r"[0-9]{20}\Z")

_RECORD_FIELDS = {
    "carrier_descriptor",
    "carrier_sha256",
    "content",
    "created_at",
    "depth",
    "encoded_byte_length",
    "hash_algorithm",
    "media_id",
    "nonce",
    "protocol",
    "signature_algorithm",
    "signer_fingerprint",
    "start_slot",
    "team",
}
_CONTENT_FIELDS = {"byte_length", "filename", "media_type", "sha256"}
_LOCATOR_FIELDS = {
    "carrier_descriptor",
    "depth",
    "encoded_byte_length",
    "encrypted_package_sha256",
    "media_id",
    "protocol",
    "start_slot",
}


class ProtocolError(ValueError):
    """An input does not conform to the frozen v1 wire protocol."""


@dataclass(frozen=True)
class SignedPackageParts:
    record_bytes: bytes
    signature: bytes
    content: bytes


def canonical_json(value: Any) -> bytes:
    """Serialize JSON as UTF-8 with sorted keys and no insignificant spaces."""
    try:
        return json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise ValueError("value is not canonical JSON data") from exc


def format_depth(depth: int) -> str:
    if type(depth) is not int or not 1 <= depth <= 8:
        raise ValueError("depth must be an integer from 1 through 8")
    return f"{depth:02d}"


def format_uint64(value: int) -> str:
    if type(value) is not int or not 0 <= value <= MAX_UINT64:
        raise ValueError("value must be an unsigned 64-bit integer")
    return f"{value:020d}"


def _require_object(value: Any, fields: set[str], name: str) -> dict[str, Any]:
    if type(value) is not dict:
        raise ProtocolError(f"{name} must be an object")
    if set(value) != fields:
        raise ProtocolError(f"{name} fields do not match the v1 schema")
    if not all(type(key) is str for key in value):
        raise ProtocolError(f"{name} field names must be strings")
    return value


def _require_text(value: Any, name: str, maximum: int, *, ascii_only: bool = False) -> str:
    if type(value) is not str:
        raise ProtocolError(f"{name} must be a string")
    try:
        encoded = value.encode("ascii" if ascii_only else "utf-8")
    except UnicodeEncodeError as exc:
        raise ProtocolError(f"{name} must be ASCII") from exc
    if not encoded or len(encoded) > maximum:
        raise ProtocolError(f"{name} length is outside the v1 bounds")
    return value


def _require_uuid(value: Any, name: str = "media_id") -> None:
    if type(value) is not str:
        raise ProtocolError(f"{name} must be a canonical UUID string")
    try:
        parsed = uuid.UUID(value)
    except (ValueError, AttributeError) as exc:
        raise ProtocolError(f"{name} must be a canonical UUID string") from exc
    if str(parsed) != value:
        raise ProtocolError(f"{name} must be a canonical lowercase UUID string")


def _require_hex(value: Any, name: str, pattern: re.Pattern[str]) -> None:
    if type(value) is not str or pattern.fullmatch(value) is None:
        raise ProtocolError(f"{name} must be fixed-width lowercase hexadecimal")


def _require_uint64_text(value: Any, name: str) -> None:
    if type(value) is not str or _UINT64_TEXT.fullmatch(value) is None:
        raise ProtocolError(f"{name} must be exactly 20 decimal digits")
    if int(value) > MAX_UINT64:
        raise ProtocolError(f"{name} exceeds an unsigned 64-bit integer")


def _validate_common_placement(value: dict[str, Any]) -> None:
    _require_text(value["carrier_descriptor"], "carrier_descriptor", MAX_DESCRIPTOR_BYTES)
    if type(value["depth"]) is not str or value["depth"] not in {
        format_depth(depth) for depth in range(1, 9)
    }:
        raise ProtocolError("depth must be a two-digit value from 01 through 08")
    _require_uint64_text(value["start_slot"], "start_slot")
    _require_uint64_text(value["encoded_byte_length"], "encoded_byte_length")
    _require_uuid(value["media_id"])
    if value["protocol"] != PROTOCOL_ID:
        raise ProtocolError(f"protocol must be {PROTOCOL_ID}")


def validate_record(record: Any) -> dict[str, Any]:
    record = _require_object(record, _RECORD_FIELDS, "record")
    _validate_common_placement(record)
    _require_hex(record["carrier_sha256"], "carrier_sha256", _LOWER_HEX_64)
    _require_hex(record["signer_fingerprint"], "signer_fingerprint", _LOWER_HEX_64)
    _require_hex(record["nonce"], "nonce", _LOWER_HEX_32)

    if record["hash_algorithm"] != HASH_ALGORITHM:
        raise ProtocolError(f"hash_algorithm must be {HASH_ALGORITHM}")
    if record["signature_algorithm"] != SIGNATURE_ALGORITHM:
        raise ProtocolError(f"signature_algorithm must be {SIGNATURE_ALGORITHM}")

    created_at = record["created_at"]
    if type(created_at) is not str or _UTC_TIMESTAMP.fullmatch(created_at) is None:
        raise ProtocolError("created_at must use UTC YYYY-MM-DDTHH:MM:SSZ form")
    try:
        datetime.strptime(created_at, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError as exc:
        raise ProtocolError("created_at is not a valid UTC timestamp") from exc

    content = _require_object(record["content"], _CONTENT_FIELDS, "content")
    _require_text(content["filename"], "content.filename", MAX_FILENAME_BYTES)
    _require_text(
        content["media_type"],
        "content.media_type",
        MAX_MEDIA_TYPE_BYTES,
        ascii_only=True,
    )
    byte_length = content["byte_length"]
    if type(byte_length) is not int or not 0 <= byte_length <= MAX_CONTENT_BYTES:
        raise ProtocolError("content.byte_length is outside the v1 bounds")
    _require_hex(content["sha256"], "content.sha256", _LOWER_HEX_64)

    team = record["team"]
    if type(team) is not dict or len(team) > MAX_TEAM_ENTRIES:
        raise ProtocolError("team must be a bounded metadata object")
    for key, item in team.items():
        _require_text(key, "team key", MAX_TEAM_KEY_BYTES)
        _require_text(item, f"team.{key}", MAX_TEAM_VALUE_BYTES)
    return record


def serialize_record(record: Any) -> bytes:
    encoded = canonical_json(validate_record(record))
    if len(encoded) > MAX_RECORD_BYTES:
        raise ProtocolError("record length exceeds the v1 bound")
    return encoded


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise ProtocolError("duplicate JSON object field")
        value[key] = item
    return value


def _reject_json_constant(value: str) -> None:
    raise ProtocolError(f"nonstandard JSON constant {value} is forbidden")


def _parse_canonical_object(data: bytes, maximum: int, name: str) -> dict[str, Any]:
    if type(data) is not bytes:
        raise ProtocolError(f"{name} bytes must be bytes")
    if not data or len(data) > maximum:
        raise ProtocolError(f"{name} length is outside the v1 bound")
    try:
        value = json.loads(
            data.decode("utf-8"),
            object_pairs_hook=_reject_duplicate_keys,
            parse_constant=_reject_json_constant,
        )
    except ProtocolError:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError, RecursionError) as exc:
        raise ProtocolError(f"{name} is not valid UTF-8 JSON") from exc
    if type(value) is not dict:
        raise ProtocolError(f"{name} must be a JSON object")
    try:
        canonical = canonical_json(value)
    except (ValueError, RecursionError) as exc:
        raise ProtocolError(f"{name} contains unsupported JSON data") from exc
    if canonical != data:
        raise ProtocolError(f"{name} is not in canonical JSON form")
    return value


def parse_record(data: bytes) -> dict[str, Any]:
    return validate_record(_parse_canonical_object(data, MAX_RECORD_BYTES, "record"))


def validate_locator(locator: Any) -> dict[str, Any]:
    locator = _require_object(locator, _LOCATOR_FIELDS, "locator")
    _validate_common_placement(locator)
    _require_hex(
        locator["encrypted_package_sha256"],
        "encrypted_package_sha256",
        _LOWER_HEX_64,
    )
    return locator


def serialize_locator(locator: Any) -> bytes:
    encoded = canonical_json(validate_locator(locator))
    if len(encoded) > MAX_LOCATOR_BYTES:
        raise ProtocolError("locator length exceeds the v1 bound")
    return encoded


def parse_locator(data: bytes) -> dict[str, Any]:
    return validate_locator(_parse_canonical_object(data, MAX_LOCATOR_BYTES, "locator"))


def pack_signed_package(record_bytes: bytes, signature: bytes, content: bytes) -> bytes:
    if type(record_bytes) is not bytes or not 0 < len(record_bytes) <= MAX_RECORD_BYTES:
        raise ProtocolError("record length is outside the v1 bound")
    if type(signature) is not bytes or len(signature) != SIGNATURE_BYTES:
        raise ProtocolError("signature must be exactly 64 bytes")
    if type(content) is not bytes or len(content) > MAX_CONTENT_BYTES:
        raise ProtocolError("content length is outside the v1 bound")
    return (
        _PACKAGE_HEADER.pack(
            SIGNED_PACKAGE_MAGIC,
            SIGNED_PACKAGE_VERSION,
            SIGNED_PACKAGE_FLAGS,
            len(record_bytes),
            len(content),
        )
        + record_bytes
        + signature
        + content
    )


def unpack_signed_package(data: bytes) -> SignedPackageParts:
    if type(data) is not bytes:
        raise ProtocolError("signed package must be bytes")
    if len(data) > MAX_SIGNED_PACKAGE_BYTES:
        raise ProtocolError("signed package length exceeds the v1 bound")
    if len(data) < _PACKAGE_HEADER.size:
        raise ProtocolError("signed package header is truncated")
    magic, version, flags, record_length, content_length = _PACKAGE_HEADER.unpack_from(data)
    if magic != SIGNED_PACKAGE_MAGIC:
        raise ProtocolError("signed package magic is invalid")
    if version != SIGNED_PACKAGE_VERSION:
        raise ProtocolError("signed package version is unsupported")
    if flags != SIGNED_PACKAGE_FLAGS:
        raise ProtocolError("signed package flags are unsupported")
    if not 0 < record_length <= MAX_RECORD_BYTES:
        raise ProtocolError("signed package record length is outside the v1 bound")
    if content_length > MAX_CONTENT_BYTES:
        raise ProtocolError("signed package content length is outside the v1 bound")

    expected = _PACKAGE_HEADER.size + record_length + SIGNATURE_BYTES + content_length
    if len(data) != expected:
        raise ProtocolError("signed package length is malformed or truncated")
    record_end = _PACKAGE_HEADER.size + record_length
    signature_end = record_end + SIGNATURE_BYTES
    return SignedPackageParts(
        record_bytes=data[_PACKAGE_HEADER.size:record_end],
        signature=data[record_end:signature_end],
        content=data[signature_end:],
    )


def measure_encrypted_envelope_length(record: Any, content_length: int) -> int:
    if type(content_length) is not int or not 0 <= content_length <= MAX_CONTENT_BYTES:
        raise ProtocolError("content length is outside the v1 bound")
    record_length = len(serialize_record(record))
    package_length = _PACKAGE_HEADER.size + record_length + SIGNATURE_BYTES + content_length
    return AES_GCM_OVERHEAD_BYTES + package_length
