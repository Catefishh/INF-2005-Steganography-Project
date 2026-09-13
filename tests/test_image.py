import io
import struct

import pytest
from PIL import Image

from backend.app.stego.carriers.image import (
    ImageError,
    inspect_image,
    canonical_hash,
)


def png(mode="RGB", size=(9, 5)):
    image = Image.new(mode, size)
    for y in range(size[1]):
        for x in range(size[0]):
            image.putpixel((x, y), ((x * 17) % 256, (y * 31) % 256, 73, 200) if mode == "RGBA" else ((x * 17) % 256, (y * 31) % 256, 73))
    out = io.BytesIO(); image.save(out, format="PNG"); return out.getvalue()


def bmp(width=5, height=3, top_down=False):
    row = width * 3
    stride = (row + 3) & ~3
    pixels = bytearray()
    for physical_y in range(height):
        logical_y = physical_y if top_down else height - 1 - physical_y
        for x in range(width): pixels += bytes((90, logical_y + 2, x + 1))
        pixels += b"\0" * (stride - row)
    dib = struct.pack("<IiiHHIIiiII", 40, width, -height if top_down else height, 1, 24, 0, len(pixels), 0, 0, 0, 0)
    return b"BM" + struct.pack("<IHHI", 14 + 40 + len(pixels), 0, 0, 54) + dib + pixels


@pytest.mark.parametrize("mode", ["RGB", "RGBA"])
@pytest.mark.parametrize("k", range(1, 9))
def test_png_logical_slots_round_trip_and_metadata(mode, k):
    original = png(mode)
    adapter = inspect_image(original)
    slots = adapter.slots()
    before = bytes(slots)
    adapter.embed(b"hello", k, 7)
    output = adapter.export()
    reread = inspect_image(output)
    assert reread.extract(5, k, 7) == b"hello"
    assert len(output) != 0
    assert reread.width == 9 and reread.height == 5
    if mode == "RGBA": assert reread.alpha_bytes() == adapter.alpha_bytes()
    assert bytes(slots[:7]) == before[:7]


@pytest.mark.parametrize("top_down", [False, True])
@pytest.mark.parametrize("k", range(1, 9))
def test_bmp_padded_rows_orientations_are_exact_size_and_round_trip(top_down, k):
    original = bmp(top_down=top_down)
    adapter = inspect_image(original)
    adapter.embed(b"x", k, 2)
    output = adapter.export()
    assert len(output) == len(original)
    assert inspect_image(output).extract(1, k, 2) == b"x"


def test_canonical_hash_masks_only_occupied_bits_and_png_metadata_is_excluded():
    data = png()
    adapter = inspect_image(data)
    first = canonical_hash(adapter, 3, 4, 4)
    adapter.embed(b"x", 3, 4)
    assert canonical_hash(adapter, 3, 4, 4) == first
    image = Image.open(io.BytesIO(data)); out = io.BytesIO(); image.save(out, format="PNG", comment="different")
    assert canonical_hash(inspect_image(out.getvalue()), 3, 4, 4) == first


def test_png_alpha_only_tamper_changes_canonical_hash():
    original = png("RGBA")
    image = Image.open(io.BytesIO(original)).convert("RGBA")
    pixels = list(image.get_flattened_data())
    pixels[0] = (*pixels[0][:3], (pixels[0][3] + 1) % 256)
    image.putdata(pixels)
    out = io.BytesIO(); image.save(out, format="PNG")
    assert canonical_hash(inspect_image(out.getvalue()), 3, 4, 4) != canonical_hash(inspect_image(original), 3, 4, 4)


def test_png_rejects_16_bit_and_trns_inputs():
    image = Image.new("I;16", (2, 2), 7)
    out = io.BytesIO(); image.save(out, format="PNG")
    with pytest.raises(ImageError): inspect_image(out.getvalue())

    image = Image.new("P", (2, 2)); image.putdata([0, 1, 0, 1]); image.info["transparency"] = bytes([0, 255])
    out = io.BytesIO(); image.save(out, format="PNG")
    with pytest.raises(ImageError): inspect_image(out.getvalue())


def test_bmp_rejects_declared_file_and_image_sizes_that_do_not_match():
    original = bytearray(bmp())
    original[2:6] = struct.pack("<I", len(original) + 1)
    with pytest.raises(ImageError): inspect_image(bytes(original))
    original = bytearray(bmp())
    original[34:38] = struct.pack("<I", 1)
    with pytest.raises(ImageError): inspect_image(bytes(original))


@pytest.mark.parametrize("bad", [b"", b"GIF89a", b"BM" + b"\0" * 52])
def test_unsupported_or_malformed_images_are_rejected(bad):
    with pytest.raises(ImageError): inspect_image(bad)
