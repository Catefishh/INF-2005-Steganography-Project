import io

import numpy as np
import pytest
from PIL import Image

from backend.app.stego.covers import CoverError, ImageCover, load_cover


def image_bytes(mode="RGB", size=(40, 30), fmt="PNG", seed=1):
    rng = np.random.default_rng(seed)
    channels = {"RGB": 3, "RGBA": 4}.get(mode)
    if channels:
        array = rng.integers(0, 256, (size[1], size[0], channels), dtype=np.uint8)
        image = Image.fromarray(array)
    else:
        image = Image.new(mode, size)
    out = io.BytesIO()
    image.save(out, format=fmt)
    return out.getvalue()


def test_slot_order_matches_lecture_loop():
    data = image_bytes()
    cover = load_cover(data)
    array = np.array(Image.open(io.BytesIO(data)))
    assert cover.slots[:6].tolist() == array[0, 0].tolist() + array[0, 1].tolist()
    assert cover.location(3 * 41 + 2) == {"slot": 125, "x": 1, "y": 1, "channel": "B", "text": "pixel (1, 1) channel B"}
    assert cover.slot_from_xy(1, 1) == 123


def test_png_rgba_export_keeps_alpha_and_slots():
    cover = load_cover(image_bytes("RGBA"))
    cover.slots[5] ^= 1
    again = load_cover(cover.export())
    assert again.mode == "RGBA"
    assert np.array_equal(again.rgb, cover.rgb)
    assert np.array_equal(again.alpha, cover.alpha)


def test_bmp_stays_bmp_with_same_size():
    data = image_bytes(fmt="BMP")
    cover = load_cover(data)
    cover.slots[0] ^= 1
    out = cover.export()
    assert out[:2] == b"BM" and len(out) == len(data)


def test_jpeg_is_accepted_but_output_is_png():
    cover = load_cover(image_bytes(fmt="JPEG"))
    assert cover.info()["lossy_source"] is True
    assert cover.export()[:8] == b"\x89PNG\r\n\x1a\n"


def test_palette_and_16_bit_images_are_converted():
    assert load_cover(image_bytes("P")).mode == "RGB"
    image = Image.fromarray(np.full((4, 4), 0x1234, dtype=np.uint16))
    out = io.BytesIO()
    image.save(out, format="PNG")
    cover = load_cover(out.getvalue())
    assert cover.rgb[0, 0].tolist() == [0x12, 0x12, 0x12]


def test_stable_hash_ignores_only_masked_bits():
    cover = load_cover(image_bytes())
    regions = [(10, 20, 3)]
    before = cover.stable_hash(regions)
    cover.slots[15] ^= 0b111
    assert cover.stable_hash(regions) == before
    cover.slots[15] ^= 0b1000
    assert cover.stable_hash(regions) != before
    cover.slots[15] ^= 0b1000
    cover.slots[40] ^= 1
    assert cover.stable_hash(regions) != before


def test_rejects_non_images():
    with pytest.raises(CoverError):
        load_cover(b"hello world, not an image")
    with pytest.raises(CoverError, match="MP3"):
        load_cover(b"ID3\x04" + b"\0" * 20)
    with pytest.raises(CoverError):
        ImageCover(b"")
