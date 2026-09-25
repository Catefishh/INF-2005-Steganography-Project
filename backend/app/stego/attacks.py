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
from .engine import MAGIC, Verdict, _pack, _unpack, canonical_json, open_header, verify, detect_method
from .security import decrypt, encrypt, generate_rsa_keys, sha256_hex


def _scenario(key, title, change, expected, result, file=None):
    return {"id": key, "title": title, "change": change, "expected": expected, "verdict": result["verdict"],
            "summary": result["summary"], "as_expected": result["verdict"] in expected, "file": file,
            "payload_hash": result.get("info", {}).get("payload_hash"),
            "stages": [{"id": step["id"], "status": step["status"]} for step in result.get("steps", [])]}


def _flip_slot_bit(stego, slot):
    cover = load_cover(stego)
    cover.slots[slot] ^= 1
    return cover.export(), cover.location(slot)["text"]


def run_suite(stego, passphrase, public_pem, original_cover=None, on_case=None, check=None,
              stop_on_failed_baseline=False, include_hash_mismatch=False):
    """Returns (scenarios, files) where files maps scenario id -> tampered bytes."""
    class CaseList(list):
        def append(self, case):
            if check:
                check()
            super().append(case)
            if on_case:
                on_case(dict(case))
    scenarios, files = CaseList(), {}
    base = verify(stego, passphrase, public_pem)
    scenarios.append(_scenario("baseline", "Unmodified stego file", "nothing - correct passphrase and public key",
                               [Verdict.AUTHENTIC], base))
    if stop_on_failed_baseline and base["verdict"] != Verdict.AUTHENTIC:
        return scenarios, files
    cover = load_cover(stego)
    ext = cover.extension
    if detect_method(cover) == "dct":
        scenarios.append(_scenario("wrong_passphrase", "Wrong passphrase", "receiver types a different passphrase",
                                   [Verdict.CANNOT_VERIFY], verify(stego, passphrase + "-wrong", public_pem)))
        _, other_public = generate_rsa_keys()
        scenarios.append(_scenario("wrong_key", "Wrong public key", "verify with an unrelated RSA key",
                                   [Verdict.SIGNATURE_INVALID], verify(stego, passphrase, other_public)))
        if original_cover:
            scenarios.append(_scenario("clean_cover", "Original cover (no payload)", "verify the cover before embedding",
                                       [Verdict.PAYLOAD_MISSING], verify(original_cover, passphrase, public_pem)))
        from .dct_codec import DctCarrier
        changed = DctCarrier(stego)
        changed.rgb[0, 0, 0] ^= 1  # slot 0 is reserved, outside all embedding blocks
        altered = changed.export()
        files["flip_cover_bit"] = ("tampered_non_embedding_pixel.png", altered)
        scenarios.append(_scenario("flip_cover_bit", "Non-embedding pixel changed", "flip one RGB bit outside occupied DCT blocks",
                                   [Verdict.TAMPERED], verify(altered, passphrase, public_pem), "flip_cover_bit"))
        if base["verdict"] == Verdict.AUTHENTIC:
            start = base["info"]["start"]["slot"]
            payload = DctCarrier(stego)
            first_byte = payload.read_bytes(1, start)[0]
            altered = payload.embed_ranges([(start, bytes([first_byte ^ 0x80]))])
            files["flip_payload_bit"] = ("tampered_dct_payload_bit.png", altered)
            scenarios.append(_scenario("flip_payload_bit", "DCT payload bit changed",
                                       "invert the first encoded bit of the encrypted payload",
                                       [Verdict.TAMPERED], verify(altered, passphrase, public_pem), "flip_payload_bit"))
        for name, title in (("wrong_start", "Manual LSB start"),
                            ("lsb_noise", "LSB overwrite"), ("forged_payload", "LSB package forgery")):
            scenarios.append({"id": name, "title": title, "change": "LSB-only attack is unsupported for DCT",
                              "expected": [], "verdict": "Unsupported", "summary": "This attack assumes pixel LSB framing.",
                              "as_expected": True, "file": None, "stages": []})
        if cover.kind == "image":
            image = Image.open(io.BytesIO(stego)).convert("RGB")
            jpeg = io.BytesIO()
            image.save(jpeg, format="JPEG", quality=90)
            back = io.BytesIO()
            Image.open(io.BytesIO(jpeg.getvalue())).save(back, format="PNG")
            files["jpeg"] = ("tampered_jpeg_q90.png", back.getvalue())
            scenarios.append(_scenario("jpeg", "JPEG re-compression (quality 90)", "save as JPEG, then PNG",
                                       [Verdict.PAYLOAD_MISSING, Verdict.CANNOT_VERIFY, Verdict.TAMPERED],
                                       verify(back.getvalue(), passphrase, public_pem), "jpeg"))
        return scenarios, files

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
    if include_hash_mismatch:
        scenarios.append(_scenario("corrected_start", "Corrected start location",
                                   f"retry the same file at authenticated slot {start:,}", [Verdict.AUTHENTIC],
                                   verify(stego, passphrase, public_pem, start_slot=start)))

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
        # Keep the signed record and signature intact, but re-encrypt changed plaintext.
        # This reaches the payload SHA-256 check, unlike a raw LSB flip (AES-GCM fails first).
        if include_hash_mismatch:
            mismatch_package = encrypt(opened["keys"]["payload"], _pack(record_json, signature, forged_content), associated)
            mismatch = load_cover(stego)
            lsb.encode(mismatch.slots, mismatch_package, n_lsb, start)
            mismatch_bytes = mismatch.export()
            files["payload_hash_mismatch"] = ("payload_hash_mismatch" + ext, mismatch_bytes)
            mismatch_result = verify(mismatch_bytes, passphrase, public_pem)
            scenarios.append(_scenario("payload_hash_mismatch", "Signed SHA-256 mismatch",
                                       "same-length plaintext changed; original signed digest retained and payload re-encrypted",
                                       [Verdict.TAMPERED], mismatch_result, "payload_hash_mismatch"))
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
