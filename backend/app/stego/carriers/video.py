"""Exact-size LSB carrier for one-stream, uncompressed 24-bit AVI files."""
from __future__ import annotations

import hashlib
import struct
from dataclasses import dataclass

from .. import lsb
from ...cancellation import check as cancel_check

MAX_AVI_BYTES = 64 * 1024 * 1024


class VideoError(ValueError):
    pass


def _chunks(data: bytes, start: int, end: int):
    cursor = start
    while cursor < end:
        if cursor + 8 > end:
            raise VideoError("AVI chunk header is truncated")
        name, size = struct.unpack_from("<4sI", data, cursor)
        body = cursor + 8
        finish = body + size
        padded = finish + (size & 1)
        if finish > end or padded > end:
            raise VideoError("AVI chunk exceeds container bounds")
        yield name, body, finish, size
        cursor = padded


def _lists(data: bytes, start: int, end: int, kind: bytes):
    found = []
    for name, body, finish, _ in _chunks(data, start, end):
        if name == b"LIST" and finish - body >= 4 and data[body:body + 4] == kind:
            found.append((body + 4, finish))
    return found


@dataclass
class VideoAdapter:
    original: bytes
    width: int
    height: int
    frame_count: int
    rate: int
    scale: int
    frame_offsets: list[int]
    stride: int
    top_down: bool
    _slots: bytearray

    @property
    def descriptor(self) -> str:
        return f"avi:bgr24:{self.width}x{self.height}:{self.frame_count}f:{self.rate}/{self.scale}"

    @property
    def eligible_slots(self) -> int:
        return len(self._slots)

    def slots(self) -> bytearray:
        return self._slots

    def embed(self, payload: bytes, depth: int, start: int = 0) -> None:
        lsb.embed(self._slots, payload, depth, start)

    def extract(self, length: int, depth: int, start: int = 0) -> bytes:
        return lsb.extract(self._slots, length, depth, start)

    def export(self) -> bytes:
        return self.export_slots(self._slots)

    def export_slots(self, slots: bytearray) -> bytes:
        result = bytearray(self.original)
        row_bytes = self.width * 3
        frame_slots = row_bytes * self.height
        for frame, start in enumerate(self.frame_offsets):
            cancel_check()
            for y in range(self.height):
                physical = y if self.top_down else self.height - 1 - y
                offset = start + physical * self.stride
                source = frame * frame_slots + y * row_bytes
                result[offset:offset + row_bytes] = slots[source:source + row_bytes]
        return bytes(result)

    def physical_offset(self, index: int) -> int:
        if not 0 <= index < self.eligible_slots:
            raise lsb.CapacityError("AVI slot is outside frame data")
        row_bytes = self.width * 3
        frame, within = divmod(index, row_bytes * self.height)
        y, x_byte = divmod(within, row_bytes)
        physical = y if self.top_down else self.height - 1 - y
        return self.frame_offsets[frame] + physical * self.stride + x_byte

    def slot_for(self, frame: int, x: int, y: int, channel: int = 0) -> int:
        if not (0 <= frame < self.frame_count and 0 <= x < self.width and
                0 <= y < self.height and 0 <= channel < 3):
            raise VideoError("AVI start frame, pixel or B/G/R channel is out of range")
        return ((frame * self.height + y) * self.width + x) * 3 + channel

    def location(self, index: int) -> tuple[int, int, int, int]:
        if not 0 <= index < self.eligible_slots:
            raise VideoError("AVI slot is out of range")
        pixel, channel = divmod(index, 3)
        frame_row, x = divmod(pixel, self.width)
        frame, y = divmod(frame_row, self.height)
        return frame, x, y, channel


def inspect_video(data: bytes) -> VideoAdapter:
    if not isinstance(data, bytes) or not 12 <= len(data) <= MAX_AVI_BYTES:
        raise VideoError("AVI input is empty or oversized")
    if data[:4] != b"RIFF" or data[8:12] != b"AVI " or struct.unpack_from("<I", data, 4)[0] != len(data) - 8:
        raise VideoError("AVI requires one classic RIFF AVI container")
    top = list(_chunks(data, 12, len(data)))
    if any(name == b"RIFF" for name, _, _, _ in top):
        raise VideoError("OpenDML or nested RIFF AVI is unsupported")
    hdrl = _lists(data, 12, len(data), b"hdrl")
    movi = _lists(data, 12, len(data), b"movi")
    if len(hdrl) != 1 or len(movi) != 1:
        raise VideoError("AVI requires exactly one header and movie list")
    hdrl_chunks = list(_chunks(data, *hdrl[0]))
    if any(name == b"LIST" and data[body:body + 4] == b"odml" for name, body, _, _ in hdrl_chunks):
        raise VideoError("OpenDML AVI is unsupported")
    headers = [(body, finish) for name, body, finish, _ in hdrl_chunks if name == b"avih"]
    if len(headers) != 1:
        raise VideoError("AVI requires exactly one main header")
    header = {b"avih": headers[0]}
    if b"avih" not in header or header[b"avih"][1] - header[b"avih"][0] < 56:
        raise VideoError("AVI main header is missing")
    avih = header[b"avih"][0]
    declared_frames, streams, main_width, main_height = struct.unpack_from("<I4xI4xII", data, avih + 16)
    streams_list = _lists(data, *hdrl[0], b"strl")
    if streams != 1 or len(streams_list) != 1:
        raise VideoError("AVI must contain one video stream and no audio")
    stream_chunks = list(_chunks(data, *streams_list[0]))
    if sum(name == b"strh" for name, _, _, _ in stream_chunks) != 1 or sum(name == b"strf" for name, _, _, _ in stream_chunks) != 1:
        raise VideoError("AVI requires one stream header and format")
    stream = {name: (body, finish) for name, body, finish, _ in stream_chunks if name in (b"strh", b"strf")}
    if b"strh" not in stream or b"strf" not in stream or stream[b"strh"][1] - stream[b"strh"][0] < 56 or stream[b"strf"][1] - stream[b"strf"][0] < 40:
        raise VideoError("AVI video stream headers are missing")
    strh = stream[b"strh"][0]
    if data[strh:strh + 4] != b"vids":
        raise VideoError("AVI stream must be video")
    scale, rate, stream_frames = struct.unpack_from("<II4xI", data, strh + 20)
    strf = stream[b"strf"][0]
    dib_size, width, height, planes, bits, compression, image_size = struct.unpack_from("<IiiHHII", data, strf)
    if dib_size != 40 or width <= 0 or height == 0 or planes != 1 or bits != 24 or compression != 0:
        raise VideoError("AVI frames must use uncompressed 24-bit BI_RGB")
    if width != main_width or abs(height) != main_height or not scale or not rate or declared_frames != stream_frames or not declared_frames:
        raise VideoError("AVI dimensions, timing or frame counts disagree")
    stride = (width * 3 + 3) & ~3
    frame_bytes = stride * abs(height)
    if width * abs(height) > 100_000_000 or frame_bytes * declared_frames > MAX_AVI_BYTES or image_size not in (0, frame_bytes):
        raise VideoError("AVI frame dimensions are unsafe")
    frames = [(body, finish, size) for name, body, finish, size in _chunks(data, *movi[0]) if name == b"00db"]
    if len(frames) != declared_frames or any(size != frame_bytes for _, _, size in frames):
        raise VideoError("AVI frame count or raw frame size is invalid")
    if any(name not in (b"00db", b"JUNK") for name, _, _, _ in _chunks(data, *movi[0])):
        raise VideoError("AVI movie list contains unsupported chunks")
    indexes = [(body, finish) for name, body, finish, _ in top if name == b"idx1"]
    if len(indexes) > 1:
        raise VideoError("AVI has multiple indexes")
    if indexes:
        start, end = indexes[0]
        if end - start != declared_frames * 16:
            raise VideoError("AVI index length does not match frame count")
        for i, (_, _, size) in enumerate(frames):
            name, _, _, indexed_size = struct.unpack_from("<4sIII", data, start + i * 16)
            if name != b"00db" or indexed_size != size:
                raise VideoError("AVI index does not match video frames")
    frame_offsets = []
    slots = bytearray()
    for body, _, _ in frames:
        cancel_check()
        frame_offsets.append(body)
        for y in range(abs(height)):
            physical = y if height < 0 else abs(height) - 1 - y
            base = body + physical * stride
            slots.extend(data[base:base + width * 3])
    return VideoAdapter(data, width, abs(height), declared_frames, rate, scale, frame_offsets,
                        stride, height < 0, slots)


def canonical_hash(adapter: VideoAdapter, depth: int, length: int, start: int) -> str:
    masked = bytearray(adapter.slots())
    lsb.mask_slots(masked, length, depth, start)
    result = adapter.export_slots(masked)
    return hashlib.sha256(b"stegloc/v1/carrier/avi-exact\0" + result).hexdigest()
