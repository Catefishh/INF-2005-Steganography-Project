"""Hashing, RSA digital signatures and AES encryption.

Week 1 recap:
  * HASHING     - SHA-256 turns any data into a fixed-length digest (one-way).
  * ASYMMETRIC  - RSA: the sender signs with the PRIVATE key and anyone can
                  verify with the PUBLIC key.
  * SYMMETRIC   - AES: the same key encrypts and decrypts. The key is derived
                  from the shared passphrase, so only people who know the
                  passphrase can read the hidden payload or its start location.

Signing works on the SHA-256 digest ("hash, then sign"):
    digest    = SHA-256(record)
    signature = RSA-PSS-sign(private_key, digest)
    valid     = RSA-PSS-verify(public_key, digest, signature)
A hash cannot be "unhashed"; the receiver recomputes the digest and checks it
against the signature.
"""

import hashlib
import os

from cryptography.exceptions import InvalidSignature, InvalidTag, UnsupportedAlgorithm
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa, utils
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

PBKDF2_ITERATIONS = 200_000
NONCE_BYTES = 12
TAG_BYTES = 16


class KeyFormatError(ValueError):
    """A PEM key is missing, malformed, of the wrong type or needs a password."""


def sha256_hex(data):
    return hashlib.sha256(data).hexdigest()


# ---------------------------------------------------------------- RSA keys --

def generate_rsa_keys(key_size=2048):
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=key_size)
    private_pem = private_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    public_pem = private_key.public_key().public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    return private_pem, public_pem


def load_private_key(pem, password=None):
    if not pem or not pem.strip():
        raise KeyFormatError("A private key is required to sign. Generate or load one on the Keys page.")
    try:
        key = serialization.load_pem_private_key(pem, password=password or None)
    except TypeError as exc:
        if password:
            raise KeyFormatError("This private key is not password-protected; leave the key password empty.") from exc
        raise KeyFormatError("This private key is password-protected; enter its password.") from exc
    except (ValueError, UnsupportedAlgorithm) as exc:
        raise KeyFormatError("Private key is not a valid PEM key (or the key password is wrong).") from exc
    if not isinstance(key, rsa.RSAPrivateKey):
        raise KeyFormatError("Private key must be an RSA key.")
    return key


def load_public_key(pem):
    if not pem or not pem.strip():
        raise KeyFormatError("The sender's public key is required to verify the signature.")
    if b"PRIVATE KEY" in pem:
        raise KeyFormatError("This is a PRIVATE key. The receiver must only use the sender's PUBLIC key.")
    try:
        key = serialization.load_pem_public_key(pem)
    except (ValueError, UnsupportedAlgorithm) as exc:
        raise KeyFormatError("Public key is not a valid PEM key.") from exc
    if not isinstance(key, rsa.RSAPublicKey):
        raise KeyFormatError("Public key must be an RSA key.")
    return key


def fingerprint(public_key):
    """SHA-256 of the DER-encoded public key, as hex."""
    der = public_key.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    return sha256_hex(der)


def _pss():
    return padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=padding.PSS.MAX_LENGTH)


def sign_digest(private_key, digest):
    """Sign a 32-byte SHA-256 digest with the RSA private key (RSA-PSS)."""
    return private_key.sign(digest, _pss(), utils.Prehashed(hashes.SHA256()))


def verify_digest(public_key, digest, signature):
    """True if `signature` was made over `digest` by the matching private key."""
    try:
        public_key.verify(signature, digest, _pss(), utils.Prehashed(hashes.SHA256()))
        return True
    except (InvalidSignature, ValueError):
        return False


# ------------------------------------------------------- passphrase + AES --

def derive_keys(passphrase, salt):
    """Passphrase -> three independent 256-bit keys with PBKDF2-HMAC-SHA256."""
    if not passphrase:
        raise ValueError("A passphrase is required.")
    material = hashlib.pbkdf2_hmac("sha256", passphrase.encode("utf-8"), salt, PBKDF2_ITERATIONS, dklen=96)
    return {"header": material[:32], "payload": material[32:64], "start": material[64:]}


def encrypt(key, plaintext, associated_data):
    """AES-256-GCM. Output = nonce (12) + ciphertext + tag (16)."""
    nonce = os.urandom(NONCE_BYTES)
    return nonce + AESGCM(key).encrypt(nonce, plaintext, associated_data)


def decrypt(key, blob, associated_data):
    """Raises InvalidTag if the key is wrong or any bit of `blob` was changed."""
    if len(blob) < NONCE_BYTES + TAG_BYTES:
        raise InvalidTag()
    return AESGCM(key).decrypt(blob[:NONCE_BYTES], blob[NONCE_BYTES:], associated_data)
