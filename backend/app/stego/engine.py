"""Stable public entry point for the legacy STG1 workflow."""
from .legacy_types import CapacityError, StartLocationError, Verdict
from .legacy_record import (PROTOCOL, MAGIC, SALT_BYTES, HEADER_PLAIN, HEADER_BYTES, HEADER_SLOTS,
    PACKAGE_OVERHEAD, ZERO_HASH, MAX_TEXT_FIELD, _limit, _pack, _unpack, canonical_json, make_record, package_size)
from .legacy_capacity import (header_slot, usable_payload_slots, max_package_bytes,
    estimate_package_bytes, choose_start, resolve_manual_start)
from .legacy_report import popcount_total, psnr
from .legacy_embed import hide
from .legacy_verify import open_header, verify
from .security import KeyFormatError

__all__ = ["CapacityError", "HEADER_SLOTS", "KeyFormatError", "StartLocationError", "Verdict",
           "estimate_package_bytes", "hide", "max_package_bytes", "open_header", "verify"]
