import copy

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from backend.app.stego.protocol import (
    CARRIER_HASH_PLACEHOLDER,
    HASH_ALGORITHM,
    PROTOCOL_ID,
    SIGNATURE_ALGORITHM,
    ProtocolError,
    format_uint64,
    measure_encrypted_envelope_length,
    serialize_locator,
    serialize_record,
)
from backend.app.stego.security import (
    AuthenticationError,
    ConsistencyError,
    IntegrityError,
    KeyFormatError,
    RecoveryError,
    SignatureVerificationError,
    create_bundle,
    create_sidecar,
    decode_recovery_code,
    decrypt_payload,
    derive_keys,
    encode_recovery_code,
    encrypt_payload,
    export_private_key_pem,
    export_public_key_pem,
    generate_ed25519_private_key,
    generate_recovery_secret,
    generate_salt,
    import_private_key_pem,
    import_public_key_pem,
    locator_from_record,
    public_key_fingerprint,
    sha256_hex,
    sign_bytes,
    verify_bundle,
    verify_bytes,
)


def private_key(seed: int = 1) -> Ed25519PrivateKey:
    return Ed25519PrivateKey.from_private_bytes(bytes([seed]) * 32)


def base_record(content: bytes, key: Ed25519PrivateKey | None = None) -> dict[str, object]:
    key = key or private_key()
    record = {
        "carrier_descriptor": "png:rgb8:640x480",
        "carrier_sha256": CARRIER_HASH_PLACEHOLDER,
        "content": {
            "byte_length": len(content),
            "filename": "evidence-雪.bin",
            "media_type": "application/octet-stream",
            "sha256": sha256_hex(content),
        },
        "created_at": "2026-09-13T12:34:56Z",
        "depth": "03",
        "encoded_byte_length": "00000000000000000000",
        "hash_algorithm": HASH_ALGORITHM,
        "media_id": "12345678-1234-5678-9234-567812345678",
        "nonce": "00112233445566778899aabbccddeeff",
        "protocol": PROTOCOL_ID,
        "signature_algorithm": SIGNATURE_ALGORITHM,
        "signer_fingerprint": public_key_fingerprint(key.public_key()),
        "start_slot": "00000000000000000042",
        "team": {"course": "INF-2005", "group": "7"},
    }
    record["encoded_byte_length"] = format_uint64(
        measure_encrypted_envelope_length(record, len(content))
    )
    return record


def test_sha256_helper_has_known_vector() -> None:
    assert sha256_hex(b"abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"


def test_ed25519_generation_pem_round_trip_and_sign_verify() -> None:
    generated = generate_ed25519_private_key()
    private_pem = export_private_key_pem(generated, "correct horse battery staple")
    public_pem = export_public_key_pem(generated.public_key())
    restored_private = import_private_key_pem(private_pem, "correct horse battery staple")
    restored_public = import_public_key_pem(public_pem)
    signature = sign_bytes(restored_private, b"message", b"test/domain/v1\x00")

    assert b"ENCRYPTED PRIVATE KEY" in private_pem
    assert public_key_fingerprint(restored_public) == public_key_fingerprint(generated.public_key())
    verify_bytes(restored_public, b"message", signature, b"test/domain/v1\x00")


@pytest.mark.parametrize("password", [b"", ""])
def test_private_pem_export_rejects_empty_password(password) -> None:
    with pytest.raises(ValueError, match="password"):
        export_private_key_pem(private_key(), password)


def test_malformed_keys_and_wrong_private_password_have_clear_errors() -> None:
    encrypted = export_private_key_pem(private_key(), "right-password")

    with pytest.raises(KeyFormatError, match="private key"):
        import_private_key_pem(encrypted, "wrong-password")
    with pytest.raises(KeyFormatError, match="public key"):
        import_public_key_pem(b"not a key")


def test_signature_rejects_wrong_key_and_changed_exact_bytes() -> None:
    signature = sign_bytes(private_key(1), b'{"a":1}', b"record-domain\x00")

    with pytest.raises(SignatureVerificationError, match="signature"):
        verify_bytes(private_key(2).public_key(), b'{"a":1}', signature, b"record-domain\x00")
    with pytest.raises(SignatureVerificationError, match="signature"):
        verify_bytes(private_key(1).public_key(), b'{ "a":1}', signature, b"record-domain\x00")


def test_ed25519_matches_rfc_8032_test_vector_2() -> None:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

    private = Ed25519PrivateKey.from_private_bytes(
        bytes.fromhex("4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb")
    )
    public = Ed25519PublicKey.from_public_bytes(
        bytes.fromhex("3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c")
    )
    expected_signature = bytes.fromhex(
        "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da"
        "085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00"
    )

    # sign_bytes signs domain || data; this split presents RFC 8032's 0x72 message.
    signature = sign_bytes(private, b"", b"\x72")

    assert signature == expected_signature
    verify_bytes(public, b"", expected_signature, b"\x72")


def test_recovery_secret_code_and_salt_are_strict_and_random() -> None:
    first = generate_recovery_secret()
    second = generate_recovery_secret()
    code = encode_recovery_code(first)

    assert len(first) == 32
    assert first != second
    assert code.startswith("STEGLOC1-")
    assert decode_recovery_code(code) == first
    assert len(generate_salt()) == 16
    assert generate_salt() != generate_salt()

    for invalid in (code.lower(), code[:-1], code.replace("-", "_", 1), "STEGLOC1-" + "g" * 64):
        with pytest.raises(RecoveryError, match="recovery code"):
            decode_recovery_code(invalid)


def test_hkdf_derives_three_distinct_repeatable_keys() -> None:
    secret = bytes(range(32))
    salt = bytes(range(16))

    first = derive_keys(secret, salt)
    second = derive_keys(secret, salt)

    assert len({first.payload, first.locator, first.start_selection}) == 3
    assert first == second
    assert all(len(value) == 32 for value in (first.payload, first.locator, first.start_selection))
    assert "00" * 8 not in repr(first)


def test_hkdf_has_hard_coded_v1_context_vectors() -> None:
    keys = derive_keys(bytes(range(32)), bytes(range(16)))

    assert keys.payload.hex() == "c384af6db83be0df509b92a24d3a505875f0eea15b2cd7cb0f7345f9df03044e"
    assert keys.locator.hex() == "6519935cb558e00d0f0d0fa09ae570db5032e6552508eff62f44d9e16d9b6723"
    assert keys.start_selection.hex() == "daeba8a49c678ac5e713c1ec579a5e65d43a8c51abcdedbaefb6b837fe7cea68"


def test_payload_aes_gcm_round_trip_uses_distinct_nonces() -> None:
    key = derive_keys(bytes(32), bytes(16)).payload
    first = encrypt_payload(b"secret payload", key)
    second = encrypt_payload(b"secret payload", key)

    assert first != second
    assert first[:12] != second[:12]
    assert decrypt_payload(first, key) == b"secret payload"
    assert decrypt_payload(second, key) == b"secret payload"


def test_payload_decrypts_hard_coded_aes_gcm_aad_and_framing_vector() -> None:
    encrypted = bytes.fromhex(
        "000102030405060708090a0b"
        "1476b37ca98aa13bfb70b7fbd0901402e2b2a74295182b13"
        "4a82d54c9cbd5073216b00f8f3a66b2158"
    )

    assert decrypt_payload(encrypted, bytes(range(32))) == b"Stegloc v1 payload vector"


def test_payload_rejects_wrong_key_and_altered_ciphertext() -> None:
    ciphertext = encrypt_payload(b"secret payload", bytes(32))

    for candidate, key in ((ciphertext, bytes([1]) * 32), (ciphertext[:-1] + bytes([ciphertext[-1] ^ 1]), bytes(32))):
        with pytest.raises(AuthenticationError, match="payload"):
            decrypt_payload(candidate, key)


def test_payload_crypto_rejects_aggregate_oversize_before_aes(monkeypatch) -> None:
    from backend.app.stego import security

    monkeypatch.setattr(security, "MAX_SIGNED_PACKAGE_BYTES", 4, raising=False)
    with pytest.raises(ValueError, match="payload plaintext length"):
        encrypt_payload(b"12345", bytes(32))

    monkeypatch.setattr(security, "MAX_ENCRYPTED_ENVELOPE_BYTES", 28, raising=False)
    with pytest.raises(AuthenticationError, match="payload length"):
        decrypt_payload(bytes(29), bytes(32))


def test_bundle_round_trip_verifies_locator_then_exact_record_and_content() -> None:
    content = b"small content"
    key = private_key()
    secret = bytes(range(32))
    bundle = create_bundle(base_record(content, key), content, key, secret=secret, salt=bytes(range(16)))

    verified = verify_bundle(
        bundle.encrypted_package,
        bundle.sidecar,
        bundle.recovery_code,
        key.public_key(),
    )

    assert verified.content == content
    assert verified.record["media_id"] == "12345678-1234-5678-9234-567812345678"
    assert verified.locator["start_slot"] == verified.record["start_slot"]


def test_bundle_repr_redacts_recovery_code_and_ciphertexts() -> None:
    content = b"secret content"
    key = private_key()
    bundle = create_bundle(
        base_record(content, key), content, key, secret=bytes(32), salt=bytes(16)
    )

    rendered = repr(bundle)

    assert bundle.recovery_code not in rendered
    assert repr(bundle.encrypted_package) not in rendered
    assert repr(bundle.sidecar) not in rendered


def test_verified_record_and_locator_are_deeply_immutable() -> None:
    content = b"content"
    key = private_key()
    bundle = create_bundle(
        base_record(content, key), content, key, secret=bytes(32), salt=bytes(16)
    )
    verified = verify_bundle(
        bundle.encrypted_package,
        bundle.sidecar,
        bundle.recovery_code,
        key.public_key(),
    )

    with pytest.raises(TypeError):
        verified.record["content"]["filename"] = "changed.bin"
    with pytest.raises(TypeError):
        verified.locator["start_slot"] = "00000000000000000000"


def test_bundle_rejects_wrong_public_key() -> None:
    content = b"content"
    key = private_key(1)
    bundle = create_bundle(base_record(content, key), content, key, secret=bytes(32), salt=bytes(16))

    with pytest.raises(SignatureVerificationError, match="locator signature"):
        verify_bundle(bundle.encrypted_package, bundle.sidecar, bundle.recovery_code, private_key(2).public_key())


def test_wrong_code_and_corrupt_locator_ciphertext_share_ambiguous_error() -> None:
    content = b"content"
    key = private_key()
    bundle = create_bundle(base_record(content, key), content, key, secret=bytes(32), salt=bytes(16))
    wrong_code = encode_recovery_code(bytes([1]) * 32)
    corrupt_sidecar = bundle.sidecar[:-1] + bytes([bundle.sidecar[-1] ^ 1])

    for sidecar, code in ((bundle.sidecar, wrong_code), (corrupt_sidecar, bundle.recovery_code)):
        with pytest.raises(RecoveryError, match="recovery material or locator is invalid"):
            verify_bundle(bundle.encrypted_package, sidecar, code, key.public_key())


def test_altered_payload_ciphertext_is_reported_as_digest_mismatch() -> None:
    content = b"content"
    key = private_key()
    bundle = create_bundle(base_record(content, key), content, key, secret=bytes(32), salt=bytes(16))
    altered = bundle.encrypted_package[:-1] + bytes([bundle.encrypted_package[-1] ^ 1])

    with pytest.raises(IntegrityError, match="encrypted package digest"):
        verify_bundle(altered, bundle.sidecar, bundle.recovery_code, key.public_key())


def test_sidecar_swap_is_detected_even_with_same_recovery_material() -> None:
    key = private_key()
    secret = bytes(32)
    salt = bytes(16)
    first = create_bundle(base_record(b"one", key), b"one", key, secret=secret, salt=salt)
    second_record = base_record(b"two", key)
    second_record["media_id"] = "87654321-4321-5678-9234-567812345678"
    second = create_bundle(second_record, b"two", key, secret=secret, salt=salt)

    with pytest.raises(IntegrityError, match="encrypted package digest"):
        verify_bundle(first.encrypted_package, second.sidecar, first.recovery_code, key.public_key())


def test_sidecar_wire_shape_has_no_encoded_ciphertext_length() -> None:
    key = private_key()
    salt = bytes(range(16))
    locator_key = derive_keys(bytes(32), salt).locator
    record = base_record(b"content", key)
    locator = locator_from_record(record, b"encrypted package")

    sidecar = create_sidecar(locator, key, locator_key, salt)

    assert sidecar[:21] == b"STGL\x01" + salt
    assert len(sidecar[21:33]) == 12
    assert len(sidecar) == 33 + len(serialize_locator(locator)) + 64 + 16


def test_sidecar_encryption_uses_a_fresh_nonce() -> None:
    key = private_key()
    salt = bytes(range(16))
    locator_key = derive_keys(bytes(32), salt).locator
    locator = locator_from_record(base_record(b"content", key), b"encrypted package")

    first = create_sidecar(locator, key, locator_key, salt)
    second = create_sidecar(locator, key, locator_key, salt)

    assert first[21:33] != second[21:33]


def sidecar_for_locator_change(bundle, record, key, secret, salt, change):
    locator = locator_from_record(record, bundle.encrypted_package)
    change(locator)
    return create_sidecar(locator, key, derive_keys(secret, salt).locator, salt)


@pytest.mark.parametrize(
    "change",
    [
        lambda locator: locator.__setitem__("media_id", "87654321-4321-5678-9234-567812345678"),
        lambda locator: locator.__setitem__("depth", "08"),
        lambda locator: locator.__setitem__("start_slot", "00000000000000000043"),
        lambda locator: locator.__setitem__("encoded_byte_length", "00000000000000009999"),
        lambda locator: locator.__setitem__("carrier_descriptor", "png:rgba8:640x480"),
    ],
)
def test_locator_and_record_identity_or_placement_disagreement_is_rejected(change) -> None:
    content = b"content"
    key = private_key()
    secret = bytes(32)
    salt = bytes(16)
    record = base_record(content, key)
    bundle = create_bundle(record, content, key, secret=secret, salt=salt)
    sidecar = sidecar_for_locator_change(bundle, record, key, secret, salt, change)

    with pytest.raises(ConsistencyError, match="locator and record"):
        verify_bundle(bundle.encrypted_package, sidecar, bundle.recovery_code, key.public_key())


def test_validly_signed_wrong_ciphertext_digest_is_rejected() -> None:
    content = b"content"
    key = private_key()
    secret = bytes(32)
    salt = bytes(16)
    record = base_record(content, key)
    bundle = create_bundle(record, content, key, secret=secret, salt=salt)
    sidecar = sidecar_for_locator_change(
        bundle,
        record,
        key,
        secret,
        salt,
        lambda locator: locator.__setitem__("encrypted_package_sha256", "00" * 32),
    )

    with pytest.raises(IntegrityError, match="encrypted package digest"):
        verify_bundle(bundle.encrypted_package, sidecar, bundle.recovery_code, key.public_key())


def test_exact_record_bytes_are_verified_before_malformed_fields_are_trusted() -> None:
    from backend.app.stego.protocol import pack_signed_package, unpack_signed_package
    from backend.app.stego.security import RECORD_SIGNATURE_DOMAIN, verify_signed_package

    content = b"content"
    key = private_key()
    record_bytes = serialize_record(base_record(content, key))
    signature = sign_bytes(key, record_bytes, RECORD_SIGNATURE_DOMAIN)
    package = bytearray(pack_signed_package(record_bytes, signature, content))
    parts = unpack_signed_package(bytes(package))
    package[18 + parts.record_bytes.index(b"INF-2005")] ^= 1

    with pytest.raises(SignatureVerificationError, match="record signature"):
        verify_signed_package(bytes(package), key.public_key())


def test_bundle_rejects_unknown_sidecar_version_and_length_limits() -> None:
    content = b"content"
    key = private_key()
    bundle = create_bundle(base_record(content, key), content, key, secret=bytes(32), salt=bytes(16))
    unknown_version = bundle.sidecar[:4] + b"\x02" + bundle.sidecar[5:]
    too_short = bundle.sidecar[: 33 + 80]
    too_long = bundle.sidecar + bytes(33 + 4_176 - len(bundle.sidecar) + 1)

    with pytest.raises(ProtocolError, match="sidecar version"):
        verify_bundle(bundle.encrypted_package, unknown_version, bundle.recovery_code, key.public_key())
    for malformed in (too_short, too_long):
        with pytest.raises(ProtocolError, match="sidecar.*length"):
            verify_bundle(bundle.encrypted_package, malformed, bundle.recovery_code, key.public_key())


def test_create_bundle_rejects_record_content_and_signer_mismatches() -> None:
    key = private_key()
    for change in (
        lambda record: record["content"].__setitem__("byte_length", 99),
        lambda record: record["content"].__setitem__("sha256", "00" * 32),
        lambda record: record.__setitem__("signer_fingerprint", "00" * 32),
        lambda record: record.__setitem__("encoded_byte_length", "00000000000000000001"),
    ):
        record = base_record(b"content", key)
        change(record)
        with pytest.raises((ConsistencyError, IntegrityError)):
            create_bundle(record, b"content", key, secret=bytes(32), salt=bytes(16))


def test_create_bundle_rejects_over_limit_record_before_encryption(monkeypatch) -> None:
    from backend.app.stego import security

    record = base_record(b"content")
    record["content"]["byte_length"] = 100 * 1024 * 1024 + 1
    encryption_reached = False

    def fail_if_called(*args, **kwargs):
        nonlocal encryption_reached
        encryption_reached = True
        raise AssertionError("encryption must not be reached")

    monkeypatch.setattr(security, "encrypt_payload", fail_if_called)

    with pytest.raises(ProtocolError, match="content.byte_length"):
        create_bundle(record, b"content", private_key(), secret=bytes(32), salt=bytes(16))
    assert encryption_reached is False
