"""Receiver workflow: locate, decrypt, authenticate, and classify."""
import hashlib
import json
import struct
from . import lsb
from .covers import load_cover
from .security import InvalidTag, KeyFormatError, decrypt, derive_keys, fingerprint, load_public_key, sha256_hex, verify_digest
from .legacy_types import Verdict, StartLocationError
from .legacy_capacity import header_slot, resolve_manual_start
from .legacy_record import MAGIC, SALT_BYTES, HEADER_PLAIN, HEADER_BYTES, HEADER_SLOTS, canonical_json, _unpack

STEP_TITLES = [
    ("load", "Read stego file and public key"),
    ("header", "Find hidden header (1 LSB, end of cover)"),
    ("unlock", "Decrypt start location with passphrase"),
    ("extract", "Extract payload bits (LSB decoding)"),
    ("decrypt", "Decrypt and authenticate payload (AES-GCM)"),
    ("signature", "Verify RSA signature with public key"),
    ("payload_hash", "Recompute payload SHA-256"),
    ("cover_hash", "Recompute cover SHA-256"),
]


class _Trace:
    def __init__(self):
        self.steps = {key: {"id": key, "title": title, "status": "skipped", "detail": ""} for key, title in STEP_TITLES}
        self.info = {}
        self.record = None
        self.record_trusted = False
        self.content = None

    def ok(self, key, detail):
        self.steps[key].update(status="passed", detail=detail)

    def result(self, verdict, summary, failed=None):
        if failed:
            self.steps[failed].update(status="failed", detail=summary)
        return {"verdict": verdict, "summary": summary, "steps": [self.steps[key] for key, _ in STEP_TITLES],
                "info": self.info, "record": self.record, "record_trusted": self.record_trusted,
                "content": self.content}


def open_header(cover, passphrase):
    """Read and decrypt the header. Returns a dict or raises (used by the attack lab too)."""
    header_pos = header_slot(cover.n_slots)
    header = lsb.decode(cover.slots, HEADER_BYTES, 1, header_pos)
    if header[:4] != MAGIC:
        raise LookupError("no header")
    salt = header[4:4 + SALT_BYTES]
    keys = derive_keys(passphrase, salt)
    start, length, n_lsb = HEADER_PLAIN.unpack(decrypt(keys["header"], header[4 + SALT_BYTES:], MAGIC + salt))
    return {"header_pos": header_pos, "salt": salt, "keys": keys, "start": start, "length": length, "n_lsb": n_lsb}


def verify(stego_data, passphrase, public_key_pem, start_slot=None, start_x=None, start_y=None,
           start_seconds=None):
    trace = _Trace()

    # 1. Load
    try:
        cover = load_cover(stego_data)
        public_key = load_public_key(public_key_pem)
        if not passphrase:
            raise ValueError("A passphrase is required.")
    except ValueError as exc:  # CoverError and KeyFormatError are ValueErrors
        return trace.result(Verdict.CANNOT_VERIFY, str(exc), failed="load")
    trace.info["cover"] = cover.info()
    trace.ok("load", f"{cover.descriptor} - {cover.n_slots:,} slots - public key {fingerprint(public_key)[:16]}...")

    # 2. Header
    header_pos = header_slot(cover.n_slots)
    if header_pos < 2:
        return trace.result(Verdict.PAYLOAD_MISSING, "This file is too small to contain a hidden payload.", "header")
    trace.info["header"] = cover.location(header_pos)
    try:
        opened = open_header(cover, passphrase)
    except LookupError:
        return trace.result(Verdict.PAYLOAD_MISSING,
                            f"No hidden header at {cover.location(header_pos)['text']}. The file carries no payload "
                            "from this tool, or its LSBs were overwritten (e.g. re-compression or editing).",
                            "header")
    except InvalidTag:
        trace.ok("header", f"'STG1' header found at {cover.location(header_pos)['text']}")
        return trace.result(Verdict.CANNOT_VERIFY,
                            "The header could not be decrypted: wrong passphrase, or the header bits were altered.",
                            "unlock")
    trace.ok("header", f"'STG1' header found at {cover.location(header_pos)['text']}")

    start, length, n_lsb = opened["start"], opened["length"], opened["n_lsb"]
    keys, associated = opened["keys"], MAGIC + opened["salt"]
    if not 1 <= n_lsb <= 8:
        return trace.result(Verdict.CANNOT_VERIFY, "The decrypted header contains an invalid LSB count.", "unlock")
    span = lsb.slots_needed(length, n_lsb)
    if start < 1 or start + span > header_pos:
        return trace.result(Verdict.CANNOT_VERIFY, "The decrypted header points outside the cover.", "unlock")
    trace.info.update(start=cover.location(start), n_lsb=n_lsb, package_bytes=length, span_slots=span)
    trace.ok("unlock", f"start {cover.location(start)['text']} - {n_lsb} LSB(s) - {length:,} bytes")

    # 3. Extract (optionally from a manually entered start, to show a wrong start location)
    try:
        override = resolve_manual_start(cover, start_slot, start_x, start_y, start_seconds)
    except StartLocationError as exc:
        return trace.result(Verdict.WRONG_START, str(exc), "extract")
    read_start = start if override is None else override
    if read_start < 0 or read_start + span > cover.n_slots:
        return trace.result(Verdict.WRONG_START,
                            f"Start slot {read_start:,} is outside the cover for a {span:,}-slot payload.", "extract")
    package = lsb.decode(cover.slots, length, n_lsb, read_start)
    source = "manually entered start" if override is not None else "start from header"
    trace.ok("extract", f"{length:,} bytes from {span:,} slots at {cover.location(read_start)['text']} ({source})")

    # 4. Decrypt + authenticate
    try:
        plain = decrypt(keys["payload"], package, associated)
    except InvalidTag:
        if override is not None and read_start != start:
            try:
                decrypt(keys["payload"], lsb.decode(cover.slots, length, n_lsb, start), associated)
                return trace.result(
                    Verdict.WRONG_START,
                    f"The bytes at {cover.location(read_start)['text']} are not the payload (AES-GCM authentication "
                    f"failed). The authenticated header points to {cover.location(start)['text']}, where the payload "
                    "is intact.", "decrypt")
            except InvalidTag:
                pass
        return trace.result(Verdict.TAMPERED,
                            "AES-GCM authentication failed: hidden payload bits were modified after embedding.",
                            "decrypt")
    try:
        record_json, signature, content = _unpack(plain)
        record = json.loads(record_json)
        expected_hash = record["payload"]["sha256"]
        expected_size = record["payload"]["size"]
        cover_record = record["cover"]
        embedding = record["embedding"]
    except (struct.error, ValueError, KeyError, TypeError):
        return trace.result(Verdict.CANNOT_VERIFY, "The decrypted payload is not a valid record.", "decrypt")
    trace.record = record
    trace.ok("decrypt", f"authentication tag valid - record {len(record_json)} B, signature {len(signature)} B, "
                        f"payload {len(content):,} B")

    # 5. Signature: hash the record again and verify with the public key
    digest = hashlib.sha256(record_json).digest()
    given = fingerprint(public_key)
    if not verify_digest(public_key, digest, signature):
        claimed = str(record.get("signer_fingerprint", ""))
        if claimed != given:
            why = (f"The record was signed by key {claimed[:16]}..., but you supplied key {given[:16]}... "
                   "(wrong sender / public key).")
        else:
            why = "The key matches the claimed signer, so the signed record itself was altered (forged)."
        return trace.result(Verdict.SIGNATURE_INVALID, f"RSA signature is not valid. {why}", "signature")
    trace.record_trusted = True
    trace.ok("signature", f"valid - SHA-256(record) {digest.hex()[:24]}... - signer {given[:16]}...")

    # 6. Payload hash
    actual_hash = sha256_hex(content)
    if actual_hash != expected_hash or len(content) != expected_size:
        return trace.result(Verdict.TAMPERED, f"Payload SHA-256 {actual_hash[:16]}... does not match the signed "
                                              f"value {str(expected_hash)[:16]}....", "payload_hash")
    trace.ok("payload_hash", f"match {actual_hash}")

    # 7. Cover hash (and the signed placement must match the header)
    if (embedding.get("lsb_bits") != n_lsb or embedding.get("start_slot") != f"{start:020d}"
            or embedding.get("header_slot") != f"{header_pos:020d}" or cover_record.get("descriptor") != cover.descriptor):
        return trace.result(Verdict.TAMPERED, "The signed record's cover type or LSB placement does not match "
                                              "this file.", "cover_hash")
    cover_hash = cover.stable_hash([(start, span, n_lsb), (header_pos, HEADER_SLOTS, 1)])
    if cover_hash != cover_record.get("sha256"):
        return trace.result(Verdict.TAMPERED, "Cover SHA-256 mismatch: pixels/samples outside the hidden data were "
                                              "changed after signing.", "cover_hash")
    trace.ok("cover_hash", f"match {cover_hash}")

    trace.content = content
    return trace.result(Verdict.AUTHENTIC, "Signature valid and both hashes match: the payload and the cover are "
                                           "exactly as the signer protected them.")


__all__ = ["CapacityError", "HEADER_SLOTS", "KeyFormatError", "StartLocationError", "Verdict", "estimate_package_bytes",
           "hide", "max_package_bytes", "open_header", "verify"]
