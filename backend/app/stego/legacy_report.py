"""Presenter-facing evidence for a completed legacy embed."""
import numpy as np
from . import lsb

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

def build_report(cover, cover_data, cover_filename, stego, original_slots, package,
                 n_lsb, start_mode, start, header_pos, span, total, available,
                 record, record_digest, signature, signer, salt, content_hash,
                 cover_hash, media_id, timestamp, nonce, private_key):
    """Build the existing evidence report after embedding."""
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
    return report
