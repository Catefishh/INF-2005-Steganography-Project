"""Strict PNG/BMP carrier adapter."""
from __future__ import annotations

import hashlib
import io
import struct
from dataclasses import dataclass

from PIL import Image, UnidentifiedImageError

from .. import lsb
from ...cancellation import check as cancel_check

MAX_PIXELS = 100_000_000


class ImageError(ValueError):
    pass


def _check_bytes(data: bytes) -> None:
    if type(data) is not bytes or not data:
        raise ImageError("image data must be nonempty bytes")


@dataclass
class ImageAdapter:
    original: bytes
    kind: str
    width: int
    height: int
    mode: str
    _slots: bytearray
    _exporter: object
    exact_size: bool

    @property
    def descriptor(self) -> str:
        return f"{self.kind}:{'rgba8' if self.mode == 'RGBA' else 'rgb8'}:{self.width}x{self.height}"

    @property
    def eligible_slots(self) -> int:
        return len(self._slots)

    def slots(self) -> bytearray:
        return self._slots

    def alpha_bytes(self) -> bytes:
        if self.mode != "RGBA": return b""
        return bytes(self._exporter[3::4]) if isinstance(self._exporter, bytearray) else bytes(self._alpha)

    def embed(self, payload: bytes, depth: int, start: int = 0) -> None:
        lsb.embed(self._slots, payload, depth, start)

    def extract(self, length: int, depth: int, start: int = 0) -> bytes:
        return lsb.extract(self._slots, length, depth, start)

    def export(self) -> bytes:
        if self.kind == "bmp":
            result = bytes(self._raw)
            if len(result) != len(self.original): raise ImageError("BMP export changed byte length")
            return result
        if self.mode == "RGBA":
            pixels = bytearray()
            for i in range(self.width * self.height):
                cancel_check()
                pixels += self._slots[i * 3:i * 3 + 3] + self._alpha[i:i + 1]
        else:
            pixels = self._slots
        image = Image.frombytes(self.mode, (self.width, self.height), bytes(pixels))
        out = io.BytesIO(); image.save(out, format="PNG"); return out.getvalue()


def _bmp(data: bytes) -> ImageAdapter:
    if len(data) < 54 or data[:2] != b"BM": raise ImageError("invalid BMP signature or header")
    try:
        size, _, _, offset = struct.unpack_from("<IHHI", data, 2)
        dib, width, height, planes, bits, compression, image_size, _, _, _, _ = struct.unpack_from("<IiiHHIIiiII", data, 14)
    except struct.error as exc: raise ImageError("truncated BMP header") from exc
    if dib != 40 or width <= 0 or height == 0 or planes != 1 or bits != 24 or compression != 0:
        raise ImageError("BMP must be uncompressed 24-bit BI_RGB")
    height_abs = abs(height); stride = (width * 3 + 3) & ~3
    required = offset + stride * height_abs
    if (size and size != len(data)) or image_size not in (0, stride * height_abs):
        raise ImageError("BMP declared size does not match pixel data")
    if height_abs > MAX_PIXELS // width or offset < 54 or required > len(data) or required != len(data):
        raise ImageError("BMP dimensions or pixel data are unsafe")
    raw = bytearray(data); logical = bytearray()
    for y in range(height_abs):
        cancel_check()
        physical = y if height < 0 else height_abs - 1 - y
        base = offset + physical * stride
        for x in range(width):
            cancel_check()
            p = base + x * 3; logical.extend((raw[p + 2], raw[p + 1], raw[p]))
    adapter = ImageAdapter(data, "bmp", width, height_abs, "RGB", logical, None, True)
    adapter._raw = raw; adapter._offset = offset; adapter._stride = stride; adapter._top_down = height < 0
    adapter._exporter = logical
    # Keep logical mutation and raw storage synchronized at export time.
    def export() -> bytes:
        for y in range(height_abs):
            cancel_check()
            physical = y if height < 0 else height_abs - 1 - y
            base = offset + physical * stride
            for x in range(width):
                cancel_check()
                s = (y * width + x) * 3; p = base + x * 3
                adapter._raw[p:p + 3] = bytes((adapter._slots[s + 2], adapter._slots[s + 1], adapter._slots[s]))
        return bytes(adapter._raw)
    adapter.export = export
    return adapter


def _png(data: bytes) -> ImageAdapter:
    if len(data) < 33 or data[12:16] != b"IHDR":
        raise ImageError("PNG is missing its IHDR header")
    bit_depth = data[24]
    color_type = data[25]
    if bit_depth != 8 or color_type not in (2, 6):
        raise ImageError("PNG must be 8-bit RGB or RGBA")
    # A tRNS chunk changes RGB transparency semantics that RGB export cannot
    # preserve; reject it rather than silently changing visible content.
    cursor = 8
    while cursor + 12 <= len(data):
        chunk_length = struct.unpack_from(">I", data, cursor)[0]
        chunk_end = cursor + 12 + chunk_length
        if chunk_end > len(data):
            raise ImageError("PNG chunk is truncated")
        if data[cursor + 4:cursor + 8] == b"tRNS":
            raise ImageError("PNG tRNS transparency is unsupported")
        cursor = chunk_end
    try:
        image = Image.open(io.BytesIO(data))
        if image.format != "PNG" or image.n_frames != 1: raise ImageError("PNG must be non-animated")
        if image.mode not in ("RGB", "RGBA"): raise ImageError("PNG must be 8-bit RGB or RGBA")
        if image.width <= 0 or image.height <= 0 or image.width * image.height > MAX_PIXELS: raise ImageError("PNG dimensions are unsafe")
        image.load(); mode = image.mode; pixels = bytearray(image.tobytes())
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        if isinstance(exc, ImageError): raise
        raise ImageError("invalid PNG") from exc
    rgb = bytearray()
    for count, i in enumerate(range(0, len(pixels), 4 if mode == "RGBA" else 3)):
        if count % 4096 == 0: cancel_check()
        rgb += pixels[i:i + 3]
    adapter = ImageAdapter(data, "png", image.width, image.height, mode, rgb, pixels, False)
    adapter._alpha = pixels[3::4] if mode == "RGBA" else b""
    return adapter


def inspect_image(data: bytes) -> ImageAdapter:
    _check_bytes(data)
    if data[:2] == b"BM": return _bmp(data)
    if data[:8] == b"\x89PNG\r\n\x1a\n": return _png(data)
    raise ImageError("unsupported image signature")


def canonical_hash(adapter: ImageAdapter, depth: int, length: int, start: int) -> str:
    slots = bytearray(adapter.slots())
    lsb.mask_slots(slots, length, depth, start)
    if adapter.kind == "bmp":
        raw = bytearray(adapter.original)
        for y in range(adapter.height):
            cancel_check()
            physical = y if adapter._top_down else adapter.height - 1 - y
            base = adapter._offset + physical * adapter._stride
            for x in range(adapter.width):
                cancel_check()
                s = (y * adapter.width + x) * 3; p = base + x * 3
                raw[p:p + 3] = bytes((slots[s + 2], slots[s + 1], slots[s]))
        body = bytes(raw); domain = b"stegloc/v1/carrier/bmp-exact\x00"
    else:
        if adapter.mode == "RGBA":
            body_bytes = bytearray()
            for index in range(adapter.width * adapter.height):
                cancel_check()
                body_bytes += slots[index * 3:index * 3 + 3]
                body_bytes.append(adapter._alpha[index])
            body = bytes(body_bytes)
        else:
            body = bytes(slots)
        domain = f"stegloc/v1/carrier/{adapter.descriptor}\x00".encode()
    return hashlib.sha256(domain + body).hexdigest()
