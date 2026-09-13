import copy
import json

import pytest

from backend.app.stego.protocol import (
    CARRIER_HASH_PLACEHOLDER,
    HASH_ALGORITHM,
    MAX_CONTENT_BYTES,
    MAX_FILENAME_BYTES,
    MAX_RECORD_BYTES,
    MAX_TEAM_ENTRIES,
    MAX_TEAM_KEY_BYTES,
    MAX_TEAM_VALUE_BYTES,
    PROTOCOL_ID,
    SIGNATURE_ALGORITHM,
    ProtocolError,
    canonical_json,
    format_depth,
    format_uint64,
    measure_encrypted_envelope_length,
    pack_signed_package,
    parse_locator,
    parse_record,
    serialize_locator,
    serialize_record,
    unpack_signed_package,
)


def valid_record(content: bytes = b"") -> dict[str, object]:
    import hashlib

    return {
        "carrier_descriptor": "png:rgb8:640x480",
        "carrier_sha256": CARRIER_HASH_PLACEHOLDER,
        "content": {
            "byte_length": len(content),
            "filename": "payload.bin",
            "media_type": "application/octet-stream",
            "sha256": hashlib.sha256(content).hexdigest(),
        },
        "created_at": "2026-09-13T12:34:56Z",
        "depth": "01",
        "encoded_byte_length": "00000000000000000000",
        "hash_algorithm": HASH_ALGORITHM,
        "media_id": "12345678-1234-5678-9234-567812345678",
        "nonce": "00112233445566778899aabbccddeeff",
        "protocol": PROTOCOL_ID,
        "signature_algorithm": SIGNATURE_ALGORITHM,
        "signer_fingerprint": "ab" * 32,
        "start_slot": "00000000000000000000",
        "team": {"course": "INF-2005", "group": "7"},
    }


def valid_locator() -> dict[str, str]:
    return {
        "carrier_descriptor": "png:rgb8:640x480",
        "depth": "01",
        "encoded_byte_length": "00000000000000001234",
        "encrypted_package_sha256": "cd" * 32,
        "media_id": "12345678-1234-5678-9234-567812345678",
        "protocol": PROTOCOL_ID,
        "start_slot": "00000000000000000042",
    }


def test_canonical_json_has_hard_coded_utf8_sorted_compact_vector() -> None:
    assert canonical_json({"z": 0, "name": "雪"}) == (
        b'{"name":"\xe9\x9b\xaa","z":0}'
    )


def test_canonical_json_rejects_nan() -> None:
    with pytest.raises(ValueError, match="JSON"):
        canonical_json({"bad": float("nan")})


def test_record_parser_rejects_nonstandard_nan_as_protocol_error() -> None:
    encoded = serialize_record(valid_record()).replace(b'"byte_length":0', b'"byte_length":NaN')

    with pytest.raises(ProtocolError, match="JSON"):
        parse_record(encoded)


def test_record_parser_normalizes_huge_integer_value_error() -> None:
    encoded = serialize_record(valid_record()).replace(
        b'"byte_length":0', b'"byte_length":' + b"9" * 5_000
    )

    with pytest.raises(ProtocolError, match="valid.*JSON") as caught:
        parse_record(encoded)
    assert len(str(caught.value)) < 100


def test_record_parser_normalizes_deep_nesting_recursion_error() -> None:
    encoded = b'{"x":' + b"[" * 5_000 + b"0" + b"]" * 5_000 + b"}"

    with pytest.raises(ProtocolError, match="valid.*JSON") as caught:
        parse_record(encoded)
    assert len(str(caught.value)) < 100


def test_empty_content_record_round_trip_and_deterministic_order() -> None:
    encoded = serialize_record(valid_record())

    assert encoded == canonical_json(valid_record())
    assert list(json.loads(encoded).keys()) == sorted(valid_record())
    assert parse_record(encoded) == valid_record()


def test_unicode_filename_round_trip_uses_utf8() -> None:
    record = valid_record(b"small")
    record["content"]["filename"] = "evidence-雪.png"

    encoded = serialize_record(record)

    assert "雪".encode() in encoded
    assert parse_record(encoded) == record


def test_schema_valid_unicode_record_has_hard_coded_fixed_width_golden_vector() -> None:
    record = {
        "carrier_descriptor": "x",
        "carrier_sha256": "0" * 64,
        "content": {
            "byte_length": 0,
            "filename": "雪",
            "media_type": "x",
            "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        },
        "created_at": "2026-09-13T12:34:56Z",
        "depth": "08",
        "encoded_byte_length": "18446744073709551615",
        "hash_algorithm": "sha256",
        "media_id": "12345678-1234-5678-9234-567812345678",
        "nonce": "00112233445566778899aabbccddeeff",
        "protocol": "stegloc-v1",
        "signature_algorithm": "ed25519",
        "signer_fingerprint": "abababababababababababababababababababababababababababababababab",
        "start_slot": "18446744073709551615",
        "team": {},
    }
    expected = (
        b'{"carrier_descriptor":"x","carrier_sha256":"00000000000000000000000000000000'
        b'00000000000000000000000000000000","content":{"byte_length":0,"filename":"'
        b'\xe9\x9b\xaa","media_type":"x","sha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4'
        b'649b934ca495991b7852b855"},"created_at":"2026-09-13T12:34:56Z","depth":"08",'
        b'"encoded_byte_length":"18446744073709551615","hash_algorithm":"sha256",'
        b'"media_id":"12345678-1234-5678-9234-567812345678","nonce":"0011223344556677'
        b'8899aabbccddeeff","protocol":"stegloc-v1","signature_algorithm":"ed25519",'
        b'"signer_fingerprint":"abababababababababababababababababababababababababababababababab",'
        b'"start_slot":"18446744073709551615","team":{}}'
    )

    assert serialize_record(record) == expected
    assert parse_record(expected) == record


def test_fixed_width_placement_formatters() -> None:
    assert format_depth(1) == "01"
    assert format_depth(8) == "08"
    assert format_uint64(0) == "00000000000000000000"
    assert format_uint64(2**64 - 1) == "18446744073709551615"

    for value in (0, 1, 99, 2**64 - 1):
        assert len(format_uint64(value)) == 20

    for value in (0, 9):
        with pytest.raises(ValueError):
            format_depth(value)
    for value in (-1, 2**64):
        with pytest.raises(ValueError):
            format_uint64(value)


@pytest.mark.parametrize("digits", ["٠" * 20, "０" * 20])
@pytest.mark.parametrize("field", ["start_slot", "encoded_byte_length"])
def test_fixed_width_decimal_fields_reject_non_ascii_digits(
    field: str, digits: str
) -> None:
    record = valid_record()
    record[field] = digits

    assert len(digits.encode("utf-8")) != 20
    with pytest.raises(ProtocolError, match="20 decimal digits"):
        serialize_record(record)
    with pytest.raises(ProtocolError, match="20 decimal digits"):
        measure_encrypted_envelope_length(record, 0)


def test_signed_package_has_hard_coded_big_endian_frame_vector() -> None:
    signature = bytes(64)
    frame = pack_signed_package(b"{}", signature, b"")
    expected = bytes.fromhex(
        "5354475001000000000200000000000000007b7d"
        + "00" * 64
    )

    assert frame == expected
    assert unpack_signed_package(frame).record_bytes == b"{}"


def test_small_content_signed_package_round_trip() -> None:
    record_bytes = serialize_record(valid_record(b"abc"))
    signature = bytes(range(64))

    parts = unpack_signed_package(pack_signed_package(record_bytes, signature, b"abc"))

    assert parts.record_bytes == record_bytes
    assert parts.signature == signature
    assert parts.content == b"abc"


@pytest.mark.parametrize(
    "cut",
    [0, 3, 5, 9, 17, 18, 19, 81, 82, 83, 84],
)
def test_signed_package_rejects_truncation_at_each_section(cut: int) -> None:
    frame = pack_signed_package(b"{}", bytes(64), b"abc")

    with pytest.raises(ProtocolError, match="truncated|length"):
        unpack_signed_package(frame[:cut])


def test_signed_package_rejects_trailing_or_malformed_lengths() -> None:
    frame = pack_signed_package(b"{}", bytes(64), b"abc")
    malformed_record_length = frame[:6] + (MAX_RECORD_BYTES + 1).to_bytes(4, "big") + frame[10:]
    malformed_content_length = frame[:10] + (MAX_CONTENT_BYTES + 1).to_bytes(8, "big") + frame[18:]

    for malformed in (frame + b"x", malformed_record_length, malformed_content_length):
        with pytest.raises(ProtocolError):
            unpack_signed_package(malformed)


@pytest.mark.parametrize("offset,value", [(4, 2), (5, 1)])
def test_signed_package_rejects_unknown_version_or_flags(offset: int, value: int) -> None:
    frame = bytearray(pack_signed_package(b"{}", bytes(64), b""))
    frame[offset] = value

    with pytest.raises(ProtocolError, match="version|flags"):
        unpack_signed_package(bytes(frame))


def test_record_accepts_documented_maximum_field_bounds() -> None:
    record = valid_record()
    record["content"]["filename"] = "x" * MAX_FILENAME_BYTES
    record["team"] = {
        ("k" * (MAX_TEAM_KEY_BYTES - len(str(i))) + str(i)): "v" * MAX_TEAM_VALUE_BYTES
        for i in range(MAX_TEAM_ENTRIES)
    }

    assert parse_record(serialize_record(record)) == record


def test_v1_content_and_aggregate_envelope_limits_are_100_mib() -> None:
    from backend.app.stego.protocol import (
        MAX_ENCRYPTED_ENVELOPE_BYTES,
        MAX_SIGNED_PACKAGE_BYTES,
    )

    assert MAX_CONTENT_BYTES == 100 * 1024 * 1024
    assert MAX_SIGNED_PACKAGE_BYTES == 18 + MAX_RECORD_BYTES + 64 + MAX_CONTENT_BYTES
    assert MAX_ENCRYPTED_ENVELOPE_BYTES == MAX_SIGNED_PACKAGE_BYTES + 28

    record = valid_record()
    record["content"]["byte_length"] = MAX_CONTENT_BYTES
    serialize_record(record)
    record["content"]["byte_length"] += 1
    with pytest.raises(ProtocolError, match="content.byte_length"):
        serialize_record(record)


@pytest.mark.parametrize(
    "change",
    [
        lambda r: r["content"].__setitem__("filename", "x" * (MAX_FILENAME_BYTES + 1)),
        lambda r: r["team"].__setitem__("k" * (MAX_TEAM_KEY_BYTES + 1), "v"),
        lambda r: r["team"].__setitem__("key", "v" * (MAX_TEAM_VALUE_BYTES + 1)),
        lambda r: r.__setitem__("team", {str(i): "v" for i in range(MAX_TEAM_ENTRIES + 1)}),
        lambda r: r.__setitem__("depth", "09"),
        lambda r: r.__setitem__("start_slot", "1"),
        lambda r: r.__setitem__("encoded_byte_length", "0" * 19),
    ],
)
def test_record_rejects_over_bounds_and_noncanonical_fixed_width_values(change) -> None:
    record = valid_record()
    change(record)

    with pytest.raises(ProtocolError):
        serialize_record(record)


@pytest.mark.parametrize(
    "change,match",
    [
        (lambda r: r.__setitem__("extra", True), "fields"),
        (lambda r: r.__setitem__("protocol", "stegloc-v2"), "protocol"),
        (lambda r: r.__setitem__("hash_algorithm", "sha512"), "hash"),
        (lambda r: r.__setitem__("signature_algorithm", "rsa"), "signature"),
        (lambda r: r.__setitem__("media_id", 3), "media_id"),
        (lambda r: r.__setitem__("created_at", "2026-09-13T12:34:56+00:00"), "created_at"),
        (lambda r: r.__setitem__("nonce", "AA" * 16), "nonce"),
        (lambda r: r.__setitem__("carrier_sha256", "AB" * 32), "carrier_sha256"),
    ],
)
def test_record_rejects_unknown_fields_types_algorithms_and_noncanonical_values(
    change, match: str
) -> None:
    record = valid_record()
    change(record)

    with pytest.raises(ProtocolError, match=match):
        serialize_record(record)


def test_record_parser_rejects_oversized_buffer_before_json() -> None:
    with pytest.raises(ProtocolError, match="record length"):
        parse_record(b"{" + b" " * MAX_RECORD_BYTES)


def test_locator_serialization_is_bounded_deterministic_and_strict() -> None:
    encoded = serialize_locator(valid_locator())

    assert encoded == canonical_json(valid_locator())
    assert parse_locator(encoded) == valid_locator()

    for change in (
        lambda value: value.__setitem__("extra", "no"),
        lambda value: value.__setitem__("protocol", "stegloc-v2"),
        lambda value: value.__setitem__("depth", "00"),
        lambda value: value.__setitem__("encrypted_package_sha256", "FF" * 32),
    ):
        locator = valid_locator()
        change(locator)
        with pytest.raises(ProtocolError):
            serialize_locator(locator)


def test_fixed_width_final_values_do_not_change_record_package_or_envelope_length() -> None:
    placeholder = valid_record(b"abc")
    final = copy.deepcopy(placeholder)
    final["carrier_sha256"] = "fe" * 32
    final["depth"] = "08"
    final["start_slot"] = "18446744073709551615"
    final["encoded_byte_length"] = "00000000000000123456"

    placeholder_record = serialize_record(placeholder)
    final_record = serialize_record(final)
    placeholder_package = pack_signed_package(placeholder_record, bytes(64), b"abc")
    final_package = pack_signed_package(final_record, bytes(64), b"abc")

    assert len(placeholder_record) == len(final_record)
    assert len(placeholder_package) == len(final_package)
    assert measure_encrypted_envelope_length(placeholder, 3) == len(placeholder_package) + 28
    assert measure_encrypted_envelope_length(placeholder, 3) == measure_encrypted_envelope_length(final, 3)
