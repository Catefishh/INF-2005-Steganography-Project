import math
import struct

import numpy as np
import pytest

from backend.app.stego.covers import AudioCover, CoverError, load_cover
from backend.app.stego.legacy_capacity import resolve_manual_start


def wav(*, bits=16, channels=2, frames=80, rate=8000, chunks=None, tag=1, extensible=False):
    width = bits // 8
    samples = bytearray()
    for frame in range(frames):
        for channel in range(channels):
            value = ((frame * 37 + channel * 19) % (1 << (bits - 1))) - (1 << (bits - 2))
            if bits == 8:
                value += 128
            samples += int(value).to_bytes(width, "little", signed=bits != 8)
    if extensible:
        fmt = struct.pack("<HHIIHHHHI", 0xFFFE, channels, rate, rate * channels * width, channels * width, bits,
                          22, bits, 0) + struct.pack("<H", tag) + b"\x00\x00\x00\x00\x10\x00\x80\x00\x00\xaa\x00\x38\x9b\x71"
    else:
        fmt = struct.pack("<HHIIHH", tag, channels, rate, rate * channels * width, channels * width, bits)
    chunks = chunks or [(b"JUNK", b"odd"), (b"data", bytes(samples)), (b"LIST", b"metadata")]
    body = bytearray(b"RIFF\0\0\0\0WAVE")
    for name, payload in [(b"fmt ", fmt), *chunks]:
        body += name + struct.pack("<I", len(payload)) + payload
        if len(payload) & 1:
            body += b"\0"
    struct.pack_into("<I", body, 4, len(body) - 8)
    return bytes(body)


@pytest.mark.parametrize("bits", [8, 16, 24, 32])
@pytest.mark.parametrize("channels", [1, 2])
def test_slots_are_low_bytes_and_export_keeps_everything_else(bits, channels):
    data = wav(bits=bits, channels=channels)
    cover = load_cover(data)
    assert isinstance(cover, AudioCover)
    assert cover.n_slots == 80 * channels
    width = bits // 8
    offset = data.index(b"data") + 8
    assert cover.slots.tolist() == list(data[offset:offset + 80 * channels * width:width])
    cover.slots[:] ^= 1
    out = cover.export()
    assert len(out) == len(data)
    changed = [i for i in range(len(data)) if data[i] != out[i]]
    assert changed == list(range(offset, offset + 80 * channels * width, width))


def test_extensible_pcm_is_accepted_and_location_is_time():
    cover = load_cover(wav(extensible=True, channels=2, rate=8000))
    assert cover.location(8001)["channel"] == 2
    assert cover.location(8001)["frame"] == 4000
    assert cover.slot_from_seconds(0.005) == 80


def test_stable_hash_covers_headers_and_unmasked_bytes():
    data = wav()
    cover = load_cover(data)
    regions = [(0, 10, 2)]
    before = cover.stable_hash(regions)
    cover.slots[3] ^= 0b11
    assert cover.stable_hash(regions) == before
    cover.raw[20] ^= 1  # a header byte
    assert cover.stable_hash(regions) != before


@pytest.mark.parametrize("data,message", [
    (wav(tag=3, bits=32), "Floating-point"),
    (wav(tag=2), "compressed"),
    (b"RIFF\0\0\0\0WAVE", "missing"),
    (b"RIFF\0\0\0\0AVI ", "not an image"),
])
def test_rejects_unsupported_wav(data, message):
    with pytest.raises(CoverError):
        load_cover(data)


def test_rejects_truncated_data_chunk():
    data = bytearray(wav(frames=1, channels=1))
    data_chunk = data.index(b"data")
    struct.pack_into("<I", data, data_chunk + 4, 2)
    del data[-1]
    struct.pack_into("<I", data, 4, len(data) - 8)

    with pytest.raises(CoverError, match="truncated"):
        load_cover(bytes(data))


@pytest.mark.parametrize("seconds", [math.inf, -math.inf, math.nan])
def test_rejects_non_finite_start_time(seconds):
    cover = load_cover(wav())

    with pytest.raises(ValueError, match="finite"):
        cover.slot_from_seconds(seconds)
    with pytest.raises(ValueError, match="finite"):
        resolve_manual_start(cover, start_seconds=seconds)


def test_rejects_incorrect_riff_size():
    data = bytearray(wav())
    struct.pack_into("<I", data, 4, len(data) - 9)

    with pytest.raises(CoverError, match="RIFF"):
        load_cover(bytes(data))


def test_rejects_missing_odd_chunk_padding():
    data = bytearray(wav(chunks=[(b"JUNK", b"odd")]))
    data.pop()
    struct.pack_into("<I", data, 4, len(data) - 8)

    with pytest.raises(CoverError, match="truncated"):
        load_cover(bytes(data))
