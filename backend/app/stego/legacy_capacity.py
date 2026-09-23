"""Legacy capacity estimates and safe start-slot selection."""
import hashlib
import hmac
import uuid
from .legacy_types import CapacityError, StartLocationError
from .legacy_record import HEADER_SLOTS, ZERO_HASH, canonical_json, make_record, package_size, _limit

def header_slot(n_slots):
    """The header lives in the last HEADER_SLOTS slots (never the top-left corner)."""
    return n_slots - HEADER_SLOTS

def usable_payload_slots(n_slots):
    """Slots 1 .. header_slot-1 can hold the payload (slot 0 = top-left is never used)."""
    return max(0, header_slot(n_slots) - 1)

def max_package_bytes(n_slots, n_lsb):
    return usable_payload_slots(n_slots) * n_lsb // 8

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
