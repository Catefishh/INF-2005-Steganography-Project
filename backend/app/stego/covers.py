"""Cover objects: turn an image or a WAV file into a flat array of slots.

Image (lecture: `for row in image: for pixel in row: r, g, b = ...`)
    Every R, G and B byte is one slot, in the same order as the lecture loop:
    row by row, pixel by pixel, R then G then B. Alpha (transparency) is never
    changed. Any image Pillow can open is accepted (PNG, BMP, JPEG, GIF, WEBP,
    TIFF ...) but the stego image is always saved losslessly (BMP stays BMP,
    everything else becomes PNG), because lossy compression destroys LSBs.

Audio
    Only uncompressed PCM WAV. A 16-bit sample is stored little-endian as
    [low byte, high byte]; the low byte is the slot. The WAV file is patched in
    place, so every header and chunk is kept and the file size never changes.
"""

import hashlib
import io
import struct

import numpy as np
from PIL import Image, UnidentifiedImageError

from . import lsb


class CoverError(ValueError):
    """The file cannot be used as a cover object."""


LOSSY_IMAGE_FORMATS = {"JPEG", "MPO"}


def _clear_regions(slots, regions):
    """regions = [(start, count, n_lsb), ...] -> zero those LSBs in `slots`."""
    for start, count, n_lsb in regions:
        lsb.clear_lsbs(slots, n_lsb, start, count)


class ImageCover:
    kind = "image"

    def __init__(self, data):
        try:
            image = Image.open(io.BytesIO(data))
            image.seek(0)  # animated GIF/WEBP: first frame only
            self.source_format = image.format or "unknown"
            image.load()
        except (UnidentifiedImageError, OSError, ValueError, EOFError, Image.DecompressionBombError) as exc:
            raise CoverError(
                "Unsupported file. Use an image (PNG, BMP, JPEG, GIF, WEBP, TIFF) "
                "or an uncompressed PCM WAV audio file."
            ) from exc

        if image.mode.startswith("I;16") or image.mode == "I":
            # 16-bit greyscale: keep the top 8 bits, then copy to R, G and B.
            grey = (np.clip(np.array(image, dtype=np.int64), 0, 65535) >> 8).astype(np.uint8)
            pixels = np.stack([grey, grey, grey], axis=-1)
        elif image.has_transparency_data:
            pixels = np.array(image.convert("RGBA"), dtype=np.uint8)
        else:
            pixels = np.array(image.convert("RGB"), dtype=np.uint8)

        self.height, self.width = pixels.shape[0], pixels.shape[1]
        self.alpha = pixels[:, :, 3].copy() if pixels.shape[2] == 4 else None
        self.rgb = np.ascontiguousarray(pixels[:, :, :3])
        self.slots = self.rgb.reshape(-1)  # a view: changing slots changes rgb
        self.mode = "RGBA" if self.alpha is not None else "RGB"
        self.output_format = "BMP" if self.source_format == "BMP" else "PNG"

    @property
    def n_slots(self):
        return len(self.slots)

    @property
    def descriptor(self):
        return f"image:{self.width}x{self.height}:{self.mode}"

    @property
    def extension(self):
        return ".bmp" if self.output_format == "BMP" else ".png"

    @property
    def mime(self):
        return "image/bmp" if self.output_format == "BMP" else "image/png"

    def export(self):
        if self.alpha is None:
            pixels = self.rgb
        else:
            pixels = np.dstack([self.rgb, self.alpha])
        out = io.BytesIO()
        Image.fromarray(pixels).save(out, format=self.output_format)
        return out.getvalue()

    def stable_hash(self, regions):
        """SHA-256 of the pixels with the hidden-data LSBs set to 0.

        Hiding data only changes those LSBs, so the cover and the stego image give
        the same hash. Changing any other bit (or the alpha channel) changes it.
        """
        rgb = self.rgb.copy()
        _clear_regions(rgb.reshape(-1), regions)
        digest = hashlib.sha256(self.descriptor.encode("utf-8"))
        digest.update(rgb.tobytes())
        if self.alpha is not None:
            digest.update(self.alpha.tobytes())
        return digest.hexdigest()

    def location(self, slot):
        pixel, channel = divmod(slot, 3)
        y, x = divmod(pixel, self.width)
        name = "RGB"[channel]
        return {"slot": slot, "x": x, "y": y, "channel": name,
                "text": f"pixel ({x}, {y}) channel {name}"}

    def slot_from_xy(self, x, y):
        if not (0 <= x < self.width and 0 <= y < self.height):
            raise ValueError(f"Pixel ({x}, {y}) is outside the {self.width}x{self.height} image.")
        return (y * self.width + x) * 3

    def info(self):
        return {"kind": self.kind, "format": self.source_format, "output_format": self.output_format,
                "descriptor": self.descriptor, "n_slots": self.n_slots, "width": self.width,
                "height": self.height, "mode": self.mode,
                "lossy_source": self.source_format in LOSSY_IMAGE_FORMATS}


class AudioCover:
    kind = "audio"

    def __init__(self, data):
        if len(data) < 12 or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
            raise CoverError("Audio covers must be WAV (RIFF/WAVE) files.")

        fmt = None
        data_offset = None
        data_size = 0
        pos = 12
        while pos + 8 <= len(data):  # walk the RIFF chunks
            chunk_id = data[pos:pos + 4]
            size = int.from_bytes(data[pos + 4:pos + 8], "little")
            body = pos + 8
            if chunk_id == b"fmt " and size >= 16 and body + 16 <= len(data):
                tag, channels, rate, _byte_rate, block_align, bits = struct.unpack_from("<HHIIHH", data, body)
                if tag == 0xFFFE and size >= 40 and body + 40 <= len(data):
                    tag = struct.unpack_from("<H", data, body + 24)[0]  # WAVE_FORMAT_EXTENSIBLE sub-format
                fmt = (tag, channels, rate, block_align, bits)
            elif chunk_id == b"data" and data_offset is None:
                data_offset = body
                data_size = min(size, len(data) - body)
            pos = body + size + (size & 1)

        if fmt is None or data_offset is None:
            raise CoverError("WAV file is missing its fmt or data chunk.")
        tag, channels, rate, block_align, bits = fmt
        if tag == 3:
            raise CoverError("Floating-point WAV is not supported. Export the audio as 16-bit or 24-bit PCM WAV.")
        if tag != 1:
            raise CoverError("Only uncompressed PCM WAV is supported (this WAV uses a compressed codec).")
        if bits not in (8, 16, 24, 32) or channels < 1 or rate < 1 or block_align != channels * bits // 8:
            raise CoverError("Unsupported PCM WAV layout (need 8/16/24/32-bit integer samples).")

        usable = data_size - data_size % block_align
        if usable == 0:
            raise CoverError("WAV file contains no audio samples.")

        self.channels = channels
        self.sample_rate = rate
        self.bits = bits
        self.sample_width = bits // 8
        self.frames = usable // block_align
        self.data_offset = data_offset
        self.data_length = usable
        self.raw = np.frombuffer(data, dtype=np.uint8).copy()  # the whole file
        self.slots = self._slot_view(self.raw)

    def _slot_view(self, raw):
        # Every sample_width-th byte of the data chunk = low byte of every sample.
        return raw[self.data_offset:self.data_offset + self.data_length:self.sample_width]

    @property
    def n_slots(self):
        return len(self.slots)

    @property
    def descriptor(self):
        return f"audio:wav:{self.channels}ch:{self.bits}bit:{self.sample_rate}hz:{self.frames}f"

    extension = ".wav"
    mime = "audio/wav"
    output_format = "WAV"

    def export(self):
        return self.raw.tobytes()

    def stable_hash(self, regions):
        """SHA-256 of the whole WAV file with the hidden-data LSBs set to 0."""
        raw = self.raw.copy()
        _clear_regions(self._slot_view(raw), regions)
        digest = hashlib.sha256(self.descriptor.encode("utf-8"))
        digest.update(raw.tobytes())
        return digest.hexdigest()

    def location(self, slot):
        frame, channel = divmod(slot, self.channels)
        seconds = frame / self.sample_rate
        return {"slot": slot, "frame": frame, "channel": channel + 1, "seconds": seconds,
                "text": f"{seconds:.3f} s (sample {frame}, channel {channel + 1})"}

    def slot_from_seconds(self, seconds):
        frame = int(round(seconds * self.sample_rate))
        if not 0 <= frame < self.frames:
            raise ValueError(f"{seconds} s is outside the {self.frames / self.sample_rate:.3f} s audio.")
        return frame * self.channels

    def info(self):
        return {"kind": self.kind, "format": "WAV", "output_format": "WAV", "descriptor": self.descriptor,
                "n_slots": self.n_slots, "channels": self.channels, "sample_rate": self.sample_rate,
                "bits": self.bits, "frames": self.frames, "duration": self.frames / self.sample_rate,
                "lossy_source": False}


def load_cover(data):
    """Pick the right cover class from the file's first bytes."""
    if not data:
        raise CoverError("The file is empty.")
    if data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return AudioCover(data)
    if data[:3] == b"ID3" or (len(data) > 1 and data[0] == 0xFF and (data[1] & 0xE0) == 0xE0):
        raise CoverError("MP3 is lossy and would destroy the hidden bits. Convert the audio to PCM WAV first.")
    if data[4:8] == b"ftyp":
        raise CoverError("MP4/MOV/M4A cannot be a cover (lossy codec). It can still be hidden as the payload.")
    return ImageCover(data)
