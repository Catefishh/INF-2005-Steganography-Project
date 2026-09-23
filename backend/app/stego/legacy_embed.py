"""Sender workflow: validate, sign, encrypt, embed."""
import hashlib
import os
import uuid
from datetime import datetime, timezone
from . import lsb
from .covers import load_cover
from .security import derive_keys, encrypt, fingerprint, load_private_key, sha256_hex, sign_digest
from .legacy_types import CapacityError, StartLocationError
from .legacy_record import MAGIC, SALT_BYTES, HEADER_PLAIN, HEADER_SLOTS, ZERO_HASH, _limit, make_record, package_size, canonical_json, _pack
from .legacy_capacity import header_slot, max_package_bytes, choose_start, resolve_manual_start
from .legacy_report import build_report

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

    report = build_report(cover, cover_data, cover_filename, stego, original_slots, package,
                          n_lsb, start_mode, start, header_pos, span, total, available,
                          record, record_digest, signature, signer, salt, content_hash,
                          cover_hash, media_id, timestamp, nonce, private_key)
    return stego, cover, report
