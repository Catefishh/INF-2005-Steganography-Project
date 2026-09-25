"""Version 1 DCT image carrier: one bit per complete 8x8 RGB channel block."""
import hashlib
import io
from itertools import chain
import struct

import numpy as np
from PIL import Image

from .covers import CoverError, ImageCover

HEADER_BYTES = 128
HEADER_SLOTS = HEADER_BYTES * 8
_AXIS = np.arange(8)
_COS = np.cos(np.pi * (2 * _AXIS[None, :] + 1) * _AXIS[:, None] / 16)
_COS[0] *= 1 / np.sqrt(8)
_COS[1:] *= np.sqrt(2 / 8)
_A, _B = (2, 3), (3, 2)


class DctCarrier:
    extension = ".png"
    mime = "image/png"
    kind = "image"

    def __init__(self, data):
        cover = ImageCover(data)
        self.rgb = cover.rgb.copy()
        self.alpha = cover.alpha
        self.width, self.height = cover.width, cover.height
        self.mode = cover.mode
        self.source_format = cover.source_format
        self.blocks_x, self.blocks_y = self.width // 8, self.height // 8
        self.n_slots = self.blocks_x * self.blocks_y * 3
        self.descriptor = cover.descriptor

    @property
    def capacity_bytes(self):
        return max(0, self.n_slots - HEADER_SLOTS - 1) // 8

    def _position(self, slot):
        block, channel = divmod(slot, 3)
        by, bx = divmod(block, self.blocks_x)
        return by * 8, bx * 8, channel

    def _block(self, slot):
        y, x, channel = self._position(slot)
        return self.rgb[y:y + 8, x:x + 8, channel]

    def _bit(self, slot):
        coefficients = _COS @ self._block(slot).astype(np.float64) @ _COS.T
        return int(coefficients[_A] > coefficients[_B])

    def read_bytes(self, length, start):
        if type(length) is not int or type(start) is not int or length < 0 or start < 0 or start + length * 8 > self.n_slots:
            raise ValueError("DCT byte range is outside the carrier")
        return bytes(sum(self._bit(start + byte * 8 + bit) << (7 - bit) for bit in range(8))
                     for byte in range(length))

    def _write_bit(self, slot, bit, separation, source):
        y, x, channel = self._position(slot)
        coefficients = _COS @ source.astype(np.float64) @ _COS.T
        difference = coefficients[_A] - coefficients[_B]
        target = separation if bit else -separation
        adjustment = (target - difference) / 2
        coefficients[_A] += adjustment
        coefficients[_B] -= adjustment
        self.rgb[y:y + 8, x:x + 8, channel] = np.clip(np.rint(_COS.T @ coefficients @ _COS), 0, 255).astype(np.uint8)

    def export(self):
        pixels = self.rgb if self.alpha is None else np.dstack((self.rgb, self.alpha))
        output = io.BytesIO()
        Image.fromarray(pixels).save(output, format="PNG")
        return output.getvalue()

    def embed_ranges(self, ranges):
        targets = {}
        for start, data in ranges:
            if type(start) is not int or type(data) is not bytes or start < 0 or start + len(data) * 8 > self.n_slots:
                raise ValueError("DCT write range is outside the carrier")
            for offset, byte in enumerate(data):
                for bit in range(8):
                    slot = start + offset * 8 + bit
                    if slot in targets:
                        raise ValueError("DCT write ranges overlap")
                    targets[slot] = (byte >> (7 - bit)) & 1
        originals = {slot: self._block(slot).copy() for slot in targets}
        failing = set(targets)
        for separation in (32, 64, 128, 256):
            for slot in failing:
                self._write_bit(slot, targets[slot], separation, originals[slot])
            output = self.export()
            reopened = DctCarrier(output)
            failing = {slot for slot, bit in targets.items() if reopened._bit(slot) != bit}
            if not failing and all(reopened.read_bytes(len(data), start) == data for start, data in ranges):
                return output
        raise CoverError("DCT coefficients could not survive PNG reconstruction. Try a larger or more varied image.")

    def coverage(self, start, package_bytes):
        if type(start) is not int or type(package_bytes) is not int:
            raise ValueError("DCT placement requires integer slots and byte length")
        header = self.n_slots - HEADER_SLOTS
        span = package_bytes * 8
        if start < 1 or package_bytes < 0 or start + span > header or header < 1:
            raise ValueError("DCT placement is outside the carrier")
        protected = self.width * self.height * 3 - (span + HEADER_SLOTS) * 64
        return {"protected_rgb_values": protected,
                "total_rgb_values": self.width * self.height * 3,
                "alpha_values": self.width * self.height if self.alpha is not None else 0,
                "description": "No RGB cover-integrity coverage; all alpha values covered" if protected == 0 else
                               "RGB values outside occupied channel blocks, plus every alpha value"}

    def stable_hash(self, start, package_bytes):
        self.coverage(start, package_bytes)
        mask = np.ones(self.rgb.shape, dtype=bool)
        for slot in chain(range(start, start + package_bytes * 8), range(self.n_slots - HEADER_SLOTS, self.n_slots)):
            y, x, channel = self._position(slot)
            mask[y:y + 8, x:x + 8, channel] = False
        digest = hashlib.sha256(b"stegloc-dct-v1-coverage\0")
        digest.update(struct.pack(">QQBQQQQ", self.width, self.height, int(self.alpha is not None),
                                  start, package_bytes * 8, self.n_slots - HEADER_SLOTS, HEADER_SLOTS))
        digest.update(self.rgb[mask].tobytes())
        if self.alpha is not None:
            digest.update(self.alpha.tobytes())
        return digest.hexdigest()
