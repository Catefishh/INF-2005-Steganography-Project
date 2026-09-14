import hashlib
import os

import pytest

from backend.app.stego.security import (InvalidTag, KeyFormatError, decrypt, derive_keys, encrypt, fingerprint,
                                        generate_rsa_keys, load_private_key, load_public_key, sign_digest,
                                        verify_digest)


@pytest.fixture(scope="module")
def keys():
    return generate_rsa_keys()


def test_hash_then_sign_then_verify(keys):
    private_pem, public_pem = keys
    private, public = load_private_key(private_pem), load_public_key(public_pem)
    digest = hashlib.sha256(b"record").digest()
    signature = sign_digest(private, digest)
    assert len(signature) == 256
    assert verify_digest(public, digest, signature)
    assert not verify_digest(public, hashlib.sha256(b"record!").digest(), signature)
    other = load_public_key(generate_rsa_keys()[1])
    assert not verify_digest(other, digest, signature)
    assert fingerprint(public) == fingerprint(private.public_key())


def test_key_loading_errors(keys):
    private_pem, public_pem = keys
    with pytest.raises(KeyFormatError, match="PRIVATE"):
        load_public_key(private_pem)
    with pytest.raises(KeyFormatError, match="not password-protected"):
        load_private_key(private_pem, b"pw")
    with pytest.raises(KeyFormatError):
        load_private_key(b"-----BEGIN PRIVATE KEY-----\nnope\n-----END PRIVATE KEY-----")
    with pytest.raises(KeyFormatError):
        load_public_key(b"")


def test_passphrase_keys_and_aes_gcm():
    salt = os.urandom(16)
    keys = derive_keys("correct horse", salt)
    assert len({keys["header"], keys["payload"], keys["start"]}) == 3
    assert derive_keys("correct horse", salt) == keys
    blob = encrypt(keys["payload"], b"secret", b"aad")
    assert decrypt(keys["payload"], blob, b"aad") == b"secret"
    tampered = bytearray(blob)
    tampered[-1] ^= 1
    with pytest.raises(InvalidTag):
        decrypt(keys["payload"], bytes(tampered), b"aad")
    with pytest.raises(InvalidTag):
        decrypt(derive_keys("wrong", salt)["payload"], blob, b"aad")
    with pytest.raises(ValueError):
        derive_keys("", salt)
