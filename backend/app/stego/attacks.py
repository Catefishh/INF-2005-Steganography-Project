"""Attack simulation module (brief section 8, optional challenge).

Starts from a stego file that verifies as Authentic, makes one change at a time
and runs the normal verifier on the result. The tampered files can be downloaded
as sample files for the submission.
"""

import io
import json

import numpy as np
from PIL import Image

from . import lsb
from .covers import load_cover
from .engine import MAGIC, Verdict, _pack, _unpack, canonical_json, open_header, verify
from .security import decrypt, encrypt, generate_rsa_keys, sha256_hex


def _scenario(key, title, change, expected, result, file=None):
    return {"id": key, "title": title, "change": change, "expected": expected, "verdict": result["verdict"],
            "summary": result["summary"], "as_expected": result["verdict"] in expected, "file": file}


def _flip_slot_bit(stego, slot):
    cover = load_cover(stego)
    cover.slots[slot] ^= 1
    return cover.export(), cover.location(slot)["text"]


def run_suite(stego, passphrase, public_pem, original_cover=None):
    """Returns (scenarios, files) where files maps scenario id -> tampered bytes."""
    scenarios, files = [], {}
    base = verify(stego, passphrase, public_pem)
    scenarios.append(_scenario("baseline", "Unmodified stego file", "nothing - correct passphrase and public key",
                               [Verdict.AUTHENTIC], base))
    cover = load_cover(stego)
    ext = cover.extension

    # Wrong passphrase
    scenarios.append(_scenario("wrong_passphrase", "Wrong passphrase", "receiver types a different passphrase",
                               [Verdict.CANNOT_VERIFY], verify(stego, passphrase + "-wrong", public_pem)))

    # Wrong public key (someone else's key)
    _, other_public = generate_rsa_keys()
    scenarios.append(_scenario("wrong_key", "Wrong public key", "verify with a freshly generated, unrelated RSA key",
                               [Verdict.SIGNATURE_INVALID], verify(stego, passphrase, other_public)))

    # One bit of the cover outside the hidden data (slot 0 is never used)
    tampered, where = _flip_slot_bit(stego, 0)
    files["flip_cover_bit"] = ("tampered_cover_bit" + ext, tampered)
    scenarios.append(_scenario("flip_cover_bit", "1 bit changed in the cover", f"flip the LSB at {where}",
                               [Verdict.TAMPERED], verify(tampered, passphrase, public_pem), "flip_cover_bit"))

    if original_cover:
        scenarios.append(_scenario("clean_cover", "Original cover (no payload)", "verify the cover before embedding",
                                   [Verdict.PAYLOAD_MISSING], verify(original_cover, passphrase, public_pem)))

    # Scenarios below need the location of the payload, i.e. a working passphrase.
    try:
        opened = open_header(cover, passphrase)
    except Exception:
        return scenarios, files
    start, length, n_lsb = opened["start"], opened["length"], opened["n_lsb"]

    tampered, where = _flip_slot_bit(stego, start)
    files["flip_payload_bit"] = ("tampered_payload_bit" + ext, tampered)
    scenarios.append(_scenario("flip_payload_bit", "1 bit changed inside the payload", f"flip the LSB at {where}",
                               [Verdict.TAMPERED], verify(tampered, passphrase, public_pem), "flip_payload_bit"))

    override = start + 1
    scenarios.append(_scenario("wrong_start", "Wrong start location", f"extract from slot {override:,} instead of "
                               f"{start:,} ({cover.location(override)['text']})", [Verdict.WRONG_START],
                               verify(stego, passphrase, public_pem, start_slot=override)))

    noisy = load_cover(stego)
    rng = np.random.default_rng(2005)
    noisy.slots[:] = (noisy.slots & 0xFE) | rng.integers(0, 2, noisy.n_slots, dtype=np.uint8)
    files["lsb_noise"] = ("tampered_lsb_noise" + ext, noisy.export())
    scenarios.append(_scenario("lsb_noise", "LSB plane overwritten", "replace every slot's LSB with random bits",
                               [Verdict.PAYLOAD_MISSING, Verdict.CANNOT_VERIFY],
                               verify(files["lsb_noise"][1], passphrase, public_pem), "lsb_noise"))

    # Attacker who knows the passphrase swaps the hidden content but cannot re-sign.
    associated = MAGIC + opened["salt"]
    plain = decrypt(opened["keys"]["payload"], lsb.decode(cover.slots, length, n_lsb, start), associated)
    record_json, signature, content = _unpack(plain)
    if content:
        forged_content = bytes([content[0] ^ 0xFF]) + content[1:]
        record = json.loads(record_json)
        record["payload"]["sha256"] = sha256_hex(forged_content)
        forged_package = encrypt(opened["keys"]["payload"], _pack(canonical_json(record), signature, forged_content),
                                 associated)
        forged = load_cover(stego)
        lsb.encode(forged.slots, forged_package, n_lsb, start)
        files["forged_payload"] = ("forged_payload" + ext, forged.export())
        scenarios.append(_scenario("forged_payload", "Passphrase leaked: content swapped",
                                   "attacker decrypts, changes the payload, updates its hash, re-encrypts",
                                   [Verdict.SIGNATURE_INVALID], verify(files["forged_payload"][1], passphrase, public_pem),
                                   "forged_payload"))

    if cover.kind == "image":
        image = Image.open(io.BytesIO(stego)).convert("RGB")
        jpeg = io.BytesIO()
        image.save(jpeg, format="JPEG", quality=90)
        back = io.BytesIO()
        Image.open(io.BytesIO(jpeg.getvalue())).save(back, format="PNG")
        files["jpeg"] = ("tampered_jpeg_q90.png", back.getvalue())
        scenarios.append(_scenario("jpeg", "JPEG re-compression (quality 90)", "save as JPEG, then back to PNG",
                                   [Verdict.PAYLOAD_MISSING, Verdict.CANNOT_VERIFY],
                                   verify(files["jpeg"][1], passphrase, public_pem), "jpeg"))
    else:
        edited = load_cover(stego)
        width, channels = edited.sample_width, edited.channels
        first = edited.frames // 2
        count = max(1, min(edited.sample_rate // 20, edited.frames - first))  # 50 ms
        frame_bytes = width * channels
        region = edited.raw[edited.data_offset + first * frame_bytes:edited.data_offset + (first + count) * frame_bytes]
        loud, quiet = (b"\xff", b"\x00") if width == 1 else (b"\xff" * (width - 1) + b"\x7f", b"\x00" * (width - 1) + b"\x80")
        pattern = b"".join((loud if (i // 20) % 2 == 0 else quiet) * channels for i in range(count))
        region[:] = np.frombuffer(pattern, dtype=np.uint8)
        files["click"] = ("tampered_click.wav", edited.export())
        scenarios.append(_scenario("click", "50 ms of audio overwritten", "replace 50 ms in the middle with a loud "
                                   "square wave", [Verdict.TAMPERED], verify(files["click"][1], passphrase, public_pem),
                                   "click"))
    return scenarios, files
