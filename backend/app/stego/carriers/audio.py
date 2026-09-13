"""Strict RIFF/WAVE PCM carrier adapter."""
from __future__ import annotations

import hashlib
import struct
from dataclasses import dataclass

from .. import lsb
from ...cancellation import check as cancel_check

MAX_AUDIO_BYTES = 256 * 1024 * 1024


class AudioError(ValueError):
    pass


@dataclass
class AudioAdapter:
    original: bytes
    sample_rate: int
    channels: int
    bits_per_sample: int
    data_offset: int
    data_end: int
    sample_offsets: range
    _slots: bytearray

    @property
    def descriptor(self) -> str:
        return f"wav:pcm{self.bits_per_sample}:{self.channels}ch:{self.sample_rate}hz"

    @property
    def eligible_slots(self) -> int:
        return len(self._slots)

    @property
    def duration(self) -> float:
        return self.eligible_slots / self.channels / self.sample_rate

    @property
    def sample_width(self) -> int:
        return self.bits_per_sample // 8

    @property
    def frames(self) -> int:
        return self.eligible_slots // self.channels

    @property
    def file_size(self) -> int:
        return len(self.original)

    def clone(self) -> bytes:
        return self.export()

    def patch(self) -> bytes:
        return self.export()

    def slots(self) -> bytearray:
        return self._slots

    def get_slot(self, index: int) -> int:
        return self._slots[index]

    def set_slot(self, index: int, value: int) -> None:
        if type(value) is not int or not 0 <= value <= 255:
            raise ValueError("slot value must be an integer from 0 through 255")
        self._slots[index] = value

    def embed(self, payload: bytes, depth: int, start: int = 0) -> None:
        lsb.embed(self._slots, payload, depth, start)

    def extract(self, length: int, depth: int, start: int = 0) -> bytes:
        return lsb.extract(self._slots, length, depth, start)

    def export(self) -> bytes:
        result = bytearray(self.original)
        for index, offset in enumerate(self.sample_offsets):
            if index % 4096 == 0: cancel_check()
            result[offset] = self._slots[index]
        if len(result) != len(self.original):
            raise AudioError("WAV export changed byte length")
        return bytes(result)


def _chunk(data: bytes, cursor: int) -> tuple[bytes, bytes, int]:
    if cursor + 8 > len(data):
        raise AudioError("WAV chunk header is truncated")
    name, size = struct.unpack_from("<4sI", data, cursor)
    end = cursor + 8 + size
    padded_end = end + (size & 1)
    if end < cursor or padded_end > len(data):
        raise AudioError("WAV chunk exceeds file bounds")
    return name, data[cursor + 8:end], padded_end


def inspect_audio(data: bytes) -> AudioAdapter:
    if type(data) is not bytes or not data or len(data) > MAX_AUDIO_BYTES:
        raise AudioError("WAV input is empty or oversized")
    if len(data) < 12 or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise AudioError("WAV signature is invalid")
    riff_size = struct.unpack_from("<I", data, 4)[0]
    if riff_size != len(data) - 8:
        raise AudioError("RIFF size does not match file length")
    cursor = 12; fmt = None; audio_data = None
    while cursor < len(data):
        name, payload, cursor = _chunk(data, cursor)
        if name == b"fmt ":
            if fmt is not None or len(payload) < 16:
                raise AudioError("WAV fmt chunk is invalid")
            fmt = struct.unpack_from("<HHIIHH", payload)
            if len(payload) != 16:
                raise AudioError("WAV format extensions are unsupported")
        elif name == b"data":
            if audio_data is not None:
                raise AudioError("WAV has multiple data chunks")
            audio_data = (cursor - len(payload) - 8 - (len(payload) & 1), payload)
    if fmt is None or audio_data is None:
        raise AudioError("WAV requires fmt and data chunks")
    code, channels, rate, byte_rate, block_align, bits = fmt
    if code != 1 or channels not in (1, 2) or rate <= 0 or bits not in (8, 16, 24, 32):
        raise AudioError("WAV must be integer PCM mono or stereo")
    width = bits // 8
    if block_align != channels * width or byte_rate != rate * block_align:
        raise AudioError("WAV format fields are inconsistent")
    data_start, payload = audio_data
    payload_start = data_start + 8
    if len(payload) == 0 or len(payload) % block_align:
        raise AudioError("WAV data is not an integral number of frames")
    frames = len(payload) // block_align
    if frames > (2**64 - 1) // channels:
        raise AudioError("WAV sample count is too large")
    offsets = range(payload_start, payload_start + len(payload), width)
    return AudioAdapter(data, rate, channels, bits, payload_start, payload_start + len(payload), offsets, bytearray(data[offset] for offset in offsets))


def canonical_hash(adapter: AudioAdapter, depth: int, length: int, start: int) -> str:
    result = bytearray(adapter.export())
    mask = 255 ^ ((1 << depth) - 1)
    for index in lsb.occupied_slots(length, depth, start):
        cancel_check()
        result[adapter.sample_offsets[index]] &= mask
    return hashlib.sha256(b"stegloc/v1/carrier/wav-exact\0" + result).hexdigest()
