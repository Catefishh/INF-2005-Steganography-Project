"""Stable public entry point for the legacy STG1 workflow."""
from .legacy_types import CapacityError, StartLocationError, Verdict
from .legacy_record import (PROTOCOL, MAGIC, SALT_BYTES, HEADER_PLAIN, HEADER_BYTES, HEADER_SLOTS,
    PACKAGE_OVERHEAD, ZERO_HASH, MAX_TEXT_FIELD, _limit, _pack, _unpack, canonical_json, make_record, package_size)
from .legacy_capacity import (header_slot, usable_payload_slots, max_package_bytes,
    estimate_package_bytes as _lsb_estimate, choose_start, resolve_manual_start)
from .legacy_report import popcount_total, psnr
from .legacy_embed import hide as _lsb_hide
from .legacy_verify import open_header, verify as _lsb_verify
from .security import KeyFormatError
from . import dct_protocol, lsb
from .dct_codec import DctCarrier, HEADER_BYTES as DCT_HEADER_BYTES, HEADER_SLOTS as DCT_HEADER_SLOTS
from .covers import load_cover


def detect_method(cover):
    """Recognize framing without credentials; never downgrade a recognized DCT file."""
    dct_magic = b""
    if cover.kind == "image":
        dct = DctCarrier(cover.export())
        if dct.n_slots >= DCT_HEADER_SLOTS:
            dct_magic = dct.read_bytes(4, dct.n_slots - DCT_HEADER_SLOTS)
    lsb_magic = b""
    if cover.n_slots >= HEADER_SLOTS:
        lsb_magic = lsb.decode(cover.slots, 4, 1, header_slot(cover.n_slots))
    dct_found = dct_magic[:3] == b"DCT"
    lsb_found = lsb_magic == MAGIC
    if dct_found and lsb_found:
        return "ambiguous"
    if dct_found:
        return "dct" if dct_magic == dct_protocol.MAGIC else "unsupported_dct"
    if lsb_found:
        return "lsb"
    return None


def estimate_package_bytes(*args, method="lsb", **kwargs):
    if method == "dct":
        return dct_protocol.estimate_package_bytes(*args, **kwargs)
    if method != "lsb":
        raise ValueError("Unsupported embedding method.")
    return _lsb_estimate(*args, **kwargs)


def hide(*args, method="lsb", **kwargs):
    if method == "dct":
        if (any(kwargs.get(name) is not None for name in ("start_slot", "start_x", "start_y", "start_seconds"))
                or kwargs.get("start_mode", "auto") != "auto" or kwargs.get("n_lsb", 1) != 1
                or len(args) > 8 and args[8] != 1 or len(args) > 9 and args[9] != "auto"):
            raise ValueError("Manual LSB controls are not supported for DCT embedding.")
        return dct_protocol.hide(*args[:8], team=kwargs.get("team", ""))
    if method != "lsb":
        raise ValueError("Unsupported embedding method.")
    return _lsb_hide(*args, **kwargs)


def verify(stego_data, passphrase, public_key_pem, **manual):
    try:
        method = detect_method(load_cover(stego_data))
    except ValueError:
        return _lsb_verify(stego_data, passphrase, public_key_pem, **manual)
    if method == "dct":
        return dct_protocol.verify(stego_data, passphrase, public_key_pem, **manual)
    if method in ("ambiguous", "unsupported_dct"):
        summary = "Conflicting DCT and LSB headers." if method == "ambiguous" else "Unsupported DCT format version."
        return {"verdict": Verdict.CANNOT_VERIFY, "summary": summary, "steps": [], "info": {"method": method},
                "record": None, "record_trusted": False, "content": None}
    return _lsb_verify(stego_data, passphrase, public_key_pem, **manual)

__all__ = ["CapacityError", "HEADER_SLOTS", "KeyFormatError", "StartLocationError", "Verdict",
           "estimate_package_bytes", "hide", "max_package_bytes", "open_header", "verify"]
