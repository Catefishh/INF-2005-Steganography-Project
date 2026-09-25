import io
import hashlib
import json
import struct

import numpy as np
import pytest
from PIL import Image

from backend.app.stego.dct_codec import DctCarrier
from backend.app.stego.covers import CoverError
from backend.app.stego import engine
from backend.app.stego.security import generate_rsa_keys
from backend.app.stego.security import decrypt, derive_keys, encrypt, sign_digest
from backend.app.stego.legacy_record import _pack, _unpack, canonical_json


def image_bytes(pixels):
    output = io.BytesIO()
    Image.fromarray(pixels).save(output, format="PNG")
    return output.getvalue()


@pytest.fixture(scope="module")
def keys():
    return generate_rsa_keys()


@pytest.mark.parametrize("pixels", [
    np.zeros((512, 512, 3), dtype=np.uint8),
    np.full((512, 512, 3), 255, dtype=np.uint8),
    np.full((512, 512, 3), 128, dtype=np.uint8),
    np.random.default_rng(4).integers(0, 256, (517, 523, 3), dtype=np.uint8),
    np.random.default_rng(5).integers(0, 256, (512, 512, 4), dtype=np.uint8),
], ids=["black", "white", "gray", "textured-edges", "rgba"])
def test_png_roundtrip_and_preserved_edges_alpha(pixels, keys):
    original = image_bytes(pixels)
    private, public = keys
    output, carrier, report = engine.hide(original, "cover.png", b"\0secret\xff", "secret.bin",
                                           "application/octet-stream", "passphrase", private, None, method="dct")
    assert output.startswith(b"\x89PNG")
    from backend.app.stego.covers import load_cover
    assert engine.detect_method(load_cover(output)) == "dct"
    result = engine.verify(output, "passphrase", public)
    assert result["verdict"] == "Authentic", result["summary"]
    assert result["content"] == b"\0secret\xff"
    decoded = np.asarray(Image.open(io.BytesIO(output)))
    assert decoded.shape == pixels.shape
    assert np.array_equal(decoded[carrier.blocks_y * 8:, :, :], pixels[carrier.blocks_y * 8:, :, :])
    assert np.array_equal(decoded[:, carrier.blocks_x * 8:, :], pixels[:, carrier.blocks_x * 8:, :])
    if pixels.shape[2] == 4:
        assert np.array_equal(decoded[:, :, 3], pixels[:, :, 3])
    assert report["coverage"]["protected_rgb_values"] >= 0


def test_capacity_bounds_and_wrong_credentials(keys):
    small = image_bytes(np.zeros((32, 32, 3), dtype=np.uint8))
    assert DctCarrier(small).capacity_bytes == 0
    private, public = keys
    with pytest.raises(ValueError, match="larger image"):
        engine.hide(small, "tiny.png", b"x", "x", "text/plain", "pw", private, None, method="dct")
    carrier = image_bytes(np.full((512, 512, 3), 128, dtype=np.uint8))
    output, _, _ = engine.hide(carrier, "cover.png", b"x", "x", "text/plain", "pw", private, None, method="dct")
    assert engine.verify(output, "bad", public)["content"] is None
    _, other = generate_rsa_keys()
    assert engine.verify(output, "pw", other)["verdict"] == "Signature Invalid"
    assert engine.verify(output, "pw", public, start_slot=1)["content"] is None
    altered = DctCarrier(output)
    altered.rgb[0, 0, 0] ^= 1
    assert engine.verify(altered.export(), "pw", public)["verdict"] == "Tampered"


def test_bit_preserving_edit_inside_occupied_block_is_outside_cover_hash(keys):
    private, public = keys
    carrier = image_bytes(np.full((512, 512, 3), 128, dtype=np.uint8))
    output, _, report = engine.hide(carrier, "cover.png", b"x", "x", "text/plain", "pw", private, None, method="dct")
    start = report["start"]["slot"]
    before = DctCarrier(output)
    expected = before._bit(start)
    y, x, channel = before._position(start)
    found = False
    for delta in (-1, 1, -2, 2):
        changed = DctCarrier(output)
        value = int(changed.rgb[y, x, channel]) + delta
        if not 0 <= value <= 255:
            continue
        changed.rgb[y, x, channel] = value
        if changed._bit(start) == expected:
            assert engine.verify(changed.export(), "pw", public)["verdict"] == "Authentic"
            found = True
            break
    assert found


@pytest.mark.parametrize("field", ["start_slot", "width"])
def test_signed_placement_or_dimensions_mismatch_releases_no_content(keys, field):
    private_pem, public = keys
    from backend.app.stego.security import load_private_key
    private = load_private_key(private_pem)
    carrier = image_bytes(np.full((512, 512, 3), 128, dtype=np.uint8))
    output, _, report = engine.hide(carrier, "cover.png", b"x", "x", "text/plain", "pw", private_pem, None, method="dct")
    changed = DctCarrier(output)
    header_slot = changed.n_slots - 1024
    header = changed.read_bytes(128, header_slot)
    salt = header[4:20]
    keys_derived = derive_keys("pw", salt)
    start, length, _ = struct.unpack(">QQQ", decrypt(keys_derived["header"], header[20:72], header[:20]))
    record_bytes, _, content = _unpack(decrypt(keys_derived["payload"], changed.read_bytes(length, start), header[:20]))
    record = json.loads(record_bytes)
    if field == "start_slot":
        record["embedding"][field] = f"{start + 1:020d}"
    else:
        record["cover"][field] = f"{changed.width + 1:020d}"
    edited_record = canonical_json(record)
    assert len(edited_record) == len(record_bytes)
    signature = sign_digest(private, hashlib.sha256(edited_record).digest())
    package = encrypt(keys_derived["payload"], _pack(edited_record, signature, content), header[:20])
    assert len(package) == length
    forged = changed.embed_ranges([(start, package)])
    result = engine.verify(forged, "pw", public)
    assert result["verdict"] == "Tampered"
    assert result["content"] is None


def test_authenticated_but_out_of_bounds_header_releases_no_content(keys):
    private, public = keys
    source = image_bytes(np.full((512, 512, 3), 128, dtype=np.uint8))
    output, _, _ = engine.hide(source, "cover.png", b"x", "x", "text/plain", "pw", private, None, method="dct")
    carrier = DctCarrier(output)
    header_slot = carrier.n_slots - 1024
    header = carrier.read_bytes(128, header_slot)
    salt = header[4:20]
    keys_derived = derive_keys("pw", salt)
    invalid = header[:20] + encrypt(keys_derived["header"], struct.pack(">QQQ", 1, carrier.capacity_bytes + 1, carrier.n_slots), header[:20]) + bytes(56)
    changed = carrier.embed_ranges([(header_slot, invalid)])
    result = engine.verify(changed, "pw", public)
    assert result["verdict"] == "Cannot Verify"
    assert result["content"] is None


def test_changed_encrypted_package_releases_no_content(keys):
    private, public = keys
    source = image_bytes(np.full((512, 512, 3), 128, dtype=np.uint8))
    output, _, report = engine.hide(source, "cover.png", b"x", "x", "text/plain", "pw", private, None, method="dct")
    carrier = DctCarrier(output)
    start = report["start"]["slot"]
    first = carrier.read_bytes(1, start)
    changed = carrier.embed_ranges([(start, bytes([first[0] ^ 1]))])
    result = engine.verify(changed, "pw", public)
    assert result["verdict"] == "Tampered"
    assert result["content"] is None


def test_unstable_carrier_fails_without_output(monkeypatch):
    carrier = DctCarrier(image_bytes(np.zeros((512, 512, 3), dtype=np.uint8)))
    monkeypatch.setattr(carrier, "_write_bit", lambda *args: None)
    with pytest.raises(CoverError, match="could not survive"):
        carrier.embed_ranges([(1, b"\xff")])
