"""Hide (sender A) and verify (receiver B) - brief section 7, Required Security Workflow.

What is hidden inside the cover
-------------------------------

  slot 0 ........ start .................... start+span ..... header ... end
  |   untouched   |  PAYLOAD (n LSBs, AES)   |    untouched   | HEADER (1 LSB) |

HEADER (65 bytes, always 1 LSB, in the last 520 slots of the cover)
    "STG1" | salt (16) | AES-GCM( start slot | payload length | n_lsb )
    The header location is fixed so the decoder can always find it. The payload
    start written inside it is random and encrypted, so without the passphrase
    nobody can locate, read or move the payload.

PAYLOAD (starts at the secret start slot, uses the chosen n LSBs)
    AES-GCM( len(record) | record JSON | len(signature) | signature | content )

RECORD (JSON, FR3): media ID, timestamp, nonce, team metadata, SHA-256 of the
    cover, SHA-256 of the content, LSB count and start location. The SHA-256 of
    the record is signed with the sender's RSA private key (FR4).
"""

import hashlib
import hmac
import json
import os
import struct
import uuid
from datetime import datetime, timezone

import numpy as np

from . import lsb
from .covers import load_cover
from .security import (InvalidTag, KeyFormatError, decrypt, derive_keys, encrypt, fingerprint,
                       load_private_key, load_public_key, sha256_hex, sign_digest, verify_digest)

PROTOCOL = "stegloc/2"
MAGIC = b"STG1"
SALT_BYTES = 16
HEADER_PLAIN = struct.Struct(">QQB")  # start slot, payload length, n_lsb
HEADER_BYTES = len(MAGIC) + SALT_BYTES + 12 + HEADER_PLAIN.size + 16  # 65
HEADER_SLOTS = HEADER_BYTES * 8  # the header always uses 1 LSB per slot
PACKAGE_OVERHEAD = 12 + 16 + 4 + 2  # AES nonce + tag, record length, signature length
ZERO_HASH = "0" * 64
MAX_TEXT_FIELD = 200


class CapacityError(ValueError):
    """The payload does not fit in the cover."""


class StartLocationError(ValueError):
    """A manually chosen start location is not usable."""


class Verdict:
    AUTHENTIC = "Authentic"
    TAMPERED = "Tampered"
    SIGNATURE_INVALID = "Signature Invalid"
    PAYLOAD_MISSING = "Payload Missing"
    WRONG_START = "Wrong Start Location"
    CANNOT_VERIFY = "Cannot Verify"


# ----------------------------------------------------------------- helpers --

def canonical_json(obj):
    """Same record -> same bytes -> same SHA-256 (sorted keys, no spaces)."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def header_slot(n_slots):
    """The header lives in the last HEADER_SLOTS slots (never the top-left corner)."""
    return n_slots - HEADER_SLOTS


def usable_payload_slots(n_slots):
    """Slots 1 .. header_slot-1 can hold the payload (slot 0 = top-left is never used)."""
    return max(0, header_slot(n_slots) - 1)


def max_package_bytes(n_slots, n_lsb):
    return usable_payload_slots(n_slots) * n_lsb // 8


def _limit(text, name):
    text = (text or "").strip()
    if len(text) > MAX_TEXT_FIELD:
        raise ValueError(f"{name} is too long (maximum {MAX_TEXT_FIELD} characters).")
    return text


def make_record(cover_kind, descriptor, cover_filename, payload_filename, payload_type, payload_size,
                payload_sha256, team, signer_fingerprint, n_lsb, start, header_pos, cover_sha256,
                media_id, timestamp, nonce):
    # start_slot / header_slot are fixed-width strings so the record length does
    # not change when the placeholder start is replaced by the real one.
    return {
        "protocol": PROTOCOL,
        "media_id": media_id,
        "timestamp": timestamp,
        "nonce": nonce,
        "team": team,
        "signer_fingerprint": signer_fingerprint,
        "cover": {"type": cover_kind, "descriptor": descriptor, "filename": cover_filename,
                  "sha256": cover_sha256},
        "payload": {"filename": payload_filename, "media_type": payload_type, "size": payload_size,
                    "sha256": payload_sha256},
        "embedding": {"method": "LSB replacement", "lsb_bits": n_lsb, "start_slot": f"{start:020d}",
                      "header_slot": f"{header_pos:020d}"},
        "algorithms": {"hash": "SHA-256", "signature": "RSA-PSS (SHA-256)", "encryption": "AES-256-GCM",
                       "key_derivation": "PBKDF2-HMAC-SHA256"},
    }


def package_size(record_bytes, signature_bytes, content_bytes):
    return PACKAGE_OVERHEAD + record_bytes + signature_bytes + content_bytes


def estimate_package_bytes(cover_kind, descriptor, cover_filename, payload_filename, payload_type,
                           payload_size, team="", key_bits=2048):
    """Exact number of bytes the encrypted payload will take (for the capacity meter)."""
    record = make_record(cover_kind, descriptor, _limit(cover_filename, "Cover filename"),
                         _limit(payload_filename, "Payload filename"), _limit(payload_type, "Payload type"),
                         payload_size, ZERO_HASH, _limit(team, "Team"), ZERO_HASH, 1, 0, 0, ZERO_HASH,
                         str(uuid.UUID(int=0)), "2000-01-01T00:00:00Z", "0" * 32)
    return package_size(len(canonical_json(record)), (key_bits + 7) // 8, payload_size)


def choose_start(start_key, salt, descriptor, n_slots, span):
    """Secret pseudo-random start slot: HMAC-SHA256(start_key, salt | descriptor | span).

    Valid starts are 1 .. header_slot - span, so the payload never touches the
    top-left slot or the header. (The modulo bias is below 2^-190, negligible.)
    """
    count = header_slot(n_slots) - span  # number of values in 1 .. header_slot - span
    if count < 1:
        raise CapacityError("The payload does not fit in this cover.")
    message = salt + descriptor.encode("utf-8") + span.to_bytes(8, "big")
    number = int.from_bytes(hmac.new(start_key, message, hashlib.sha256).digest(), "big")
    return 1 + number % count


def resolve_manual_start(cover, start_slot=None, start_x=None, start_y=None, start_seconds=None):
    """Turn user input (slot, pixel x/y or seconds) into a slot index, or None."""
    try:
        if start_slot is not None:
            return int(start_slot)
        if cover.kind == "image" and start_x is not None and start_y is not None:
            return cover.slot_from_xy(int(start_x), int(start_y))
        if cover.kind == "audio" and start_seconds is not None:
            return cover.slot_from_seconds(float(start_seconds))
    except ValueError as exc:
        raise StartLocationError(str(exc)) from exc
    return None


def _pack(record_json, signature, content):
    return (struct.pack(">I", len(record_json)) + record_json
            + struct.pack(">H", len(signature)) + signature + content)


def _unpack(package):
    (record_len,) = struct.unpack_from(">I", package, 0)
    record_end = 4 + record_len
    (sig_len,) = struct.unpack_from(">H", package, record_end)
    sig_end = record_end + 2 + sig_len
    if sig_end > len(package):
        raise ValueError("package is truncated")
    return package[4:record_end], package[record_end + 2:sig_end], package[sig_end:]


def popcount_total(values):
    table = np.array([bin(i).count("1") for i in range(256)], dtype=np.uint8)
    return int(table[values].sum(dtype=np.int64))


def psnr(original, changed, peak):
    diff = original.astype(np.int32) - changed.astype(np.int32)
    mse = float(np.mean(diff * diff)) if len(diff) else 0.0
    if mse == 0:
        return None, 0.0
    return 10 * np.log10(peak * peak / mse), mse


# -------------------------------------------------------------------- hide --

def hide(cover_data, cover_filename, content, payload_filename, payload_type, passphrase, private_key_pem,
         key_password=None, n_lsb=1, start_mode="auto", start_slot=None, start_x=None, start_y=None,
         start_seconds=None, team=""):
    lsb.check_n_lsb(n_lsb)
    if not passphrase:
        raise ValueError("A passphrase is required. It protects the start location and the payload.")
    cover = load_cover(cover_data)
    private_key = load_private_key(private_key_pem, key_password)
    signer = fingerprint(private_key.public_key())
    team = _limit(team, "Team")
    cover_filename = _limit(cover_filename, "Cover filename") or "cover"
    payload_filename = _limit(payload_filename, "Payload filename") or "payload.bin"
    payload_type = _limit(payload_type, "Payload type") or "application/octet-stream"

    header_pos = header_slot(cover.n_slots)
    media_id = str(uuid.uuid4())
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    nonce = os.urandom(16).hex()
    content_hash = sha256_hex(content)

    def record_for(start, cover_hash):
        return make_record(cover.kind, cover.descriptor, cover_filename, payload_filename, payload_type,
                           len(content), content_hash, team, signer, n_lsb, start, max(header_pos, 0),
                           cover_hash, media_id, timestamp, nonce)

    # 1. Capacity check (is the payload larger than the cover can hold?)
    signature_bytes = (private_key.key_size + 7) // 8
    total = package_size(len(canonical_json(record_for(0, ZERO_HASH))), signature_bytes, len(content))
    available = max_package_bytes(cover.n_slots, n_lsb)
    if header_pos < 2 or total > available:
        raise CapacityError(
            f"Payload too large: it needs {total:,} bytes but this cover holds {max(available, 0):,} bytes "
            f"with {n_lsb} LSB(s). Use a bigger cover, more LSBs or a smaller payload.")
    span = lsb.slots_needed(total, n_lsb)

    # 2. Start location
    salt = os.urandom(SALT_BYTES)
    keys = derive_keys(passphrase, salt)
    if start_mode == "manual":
        start = resolve_manual_start(cover, start_slot, start_x, start_y, start_seconds)
        if start is None:
            raise StartLocationError("Manual start selected: enter a start location.")
        if start == 0:
            raise StartLocationError("Choose a start other than the top-left corner / very first sample (slot 0).")
        if start < 0 or start + span > header_pos:
            last = header_pos - span
            raise StartLocationError(
                f"The payload needs {span:,} slots; from that start it would run into the header. "
                f"Pick a start between {cover.location(1)['text']} and {cover.location(last)['text']}.")
    else:
        start = choose_start(keys["start"], salt, cover.descriptor, cover.n_slots, span)

    # 3. Hash the cover (with the LSBs that will carry data set to 0)
    regions = [(start, span, n_lsb), (header_pos, HEADER_SLOTS, 1)]
    cover_hash = cover.stable_hash(regions)

    # 4. Build the record, hash it and sign the hash
    record = record_for(start, cover_hash)
    record_json = canonical_json(record)
    record_digest = hashlib.sha256(record_json).digest()
    signature = sign_digest(private_key, record_digest)

    # 5. Encrypt record + signature + content, and the header
    associated = MAGIC + salt
    package = encrypt(keys["payload"], _pack(record_json, signature, content), associated)
    if len(package) != total:
        raise RuntimeError("internal error: package size changed")
    header = MAGIC + salt + encrypt(keys["header"], HEADER_PLAIN.pack(start, total, n_lsb), associated)

    # 6. LSB replacement
    original_slots = cover.slots.copy()
    lsb.encode(cover.slots, package, n_lsb, start)
    lsb.encode(cover.slots, header, 1, header_pos)
    stego = cover.export()

    # ---- report for the GUI
    peak = 255 if cover.kind == "image" else (1 << cover.bits) - 1
    psnr_db, mse = psnr(original_slots, cover.slots, peak)
    binary = "".join(lsb.to_bin(package[:8]))
    lecture_rows = []
    for i in range(min(8, span)):
        slot = start + i
        lecture_rows.append({
            "slot": slot, "location": cover.location(slot)["text"],
            "before": int(original_slots[slot]), "after": int(cover.slots[slot]),
            "before_bin": lsb.to_bin(int(original_slots[slot])), "after_bin": lsb.to_bin(int(cover.slots[slot])),
            "payload_bits": binary[i * n_lsb:(i + 1) * n_lsb],
        })

    report = {
        "cover": {**cover.info(), "file_size": len(cover_data), "filename": cover_filename},
        "stego_size": len(stego),
        "size_unchanged": len(stego) == len(cover_data),
        "n_lsb": n_lsb,
        "start_mode": "manual" if start_mode == "manual" else "auto",
        "start": cover.location(start),
        "header": cover.location(header_pos),
        "span_slots": span,
        "package_bytes": total,
        "capacity_bytes": available,
        "capacity_used_percent": 100 * total / available,
        "bits_changed": popcount_total(original_slots ^ cover.slots),
        "slots_changed": int(np.count_nonzero(original_slots != cover.slots)),
        "psnr_db": psnr_db,
        "mse": mse,
        "record": record,
        "record_sha256": record_digest.hex(),
        "signature_hex": signature.hex(),
        "signer_fingerprint": signer,
        "salt_hex": salt.hex(),
        "lecture_rows": lecture_rows,
        "steps": [
            {"title": "Load cover object", "detail": f"{cover.descriptor} - {cover.n_slots:,} slots"},
            {"title": "Capacity check", "detail": f"needs {total:,} of {available:,} bytes at {n_lsb} LSB(s)"},
            {"title": "SHA-256 of payload", "value": content_hash},
            {"title": "SHA-256 of cover (hidden-data LSBs zeroed)", "value": cover_hash},
            {"title": "Build record", "detail": f"media ID {media_id} - {timestamp} - nonce {nonce}"},
            {"title": "SHA-256 of record", "value": record_digest.hex()},
            {"title": f"Sign digest with RSA-{private_key.key_size} private key (PSS)",
             "value": signature.hex()[:96] + "...", "detail": f"signer fingerprint {signer[:32]}..."},
            {"title": "Derive AES keys from passphrase", "detail": f"PBKDF2-HMAC-SHA256, 200,000 rounds, salt {salt.hex()}"},
            {"title": "Encrypt record + signature + payload (AES-256-GCM)", "detail": f"{total:,} bytes"},
            {"title": "Choose start location",
             "detail": ("secret HMAC-SHA256(passphrase key, salt) -> " if start_mode != "manual" else "manual -> ")
             + cover.location(start)["text"]},
            {"title": f"LSB replacement ({n_lsb} bit(s))",
             "detail": f"payload in {span:,} slots, header (1 LSB) at {cover.location(header_pos)['text']}"},
        ],
    }
    return stego, cover, report


# ------------------------------------------------------------------ verify --

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
