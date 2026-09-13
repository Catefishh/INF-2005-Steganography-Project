import hashlib
import struct

import pytest

from backend.app.stego import lsb
from backend.app.stego.carriers.audio import AudioError, canonical_hash, inspect_audio


def wav(*, bits=16, channels=2, frames=80, rate=8000, chunks=None):
    width = bits // 8
    samples = bytearray()
    for frame in range(frames):
        for channel in range(channels):
            value = ((frame * 37 + channel * 19) % (1 << (bits - 1))) - (1 << (bits - 2))
            if bits == 8:
                value += 128
            samples += int(value).to_bytes(width, "little", signed=bits != 8)
    chunks = chunks or [(b"JUNK", b"odd"), (b"data", bytes(samples)), (b"LIST", b"metadata")]
    fmt = struct.pack("<HHIIHH", 1, channels, rate, rate * channels * width, channels * width, bits)
    body = bytearray(b"RIFF\0\0\0\0WAVE")
    for name, payload in [(b"fmt ", fmt), *chunks]:
        body += name + struct.pack("<I", len(payload)) + payload
        if len(payload) & 1:
            body += b"\0"
    struct.pack_into("<I", body, 4, len(body) - 8)
    return bytes(body)


@pytest.mark.parametrize("bits", [8, 16, 24, 32])
@pytest.mark.parametrize("channels", [1, 2])
@pytest.mark.parametrize("depth", range(1, 9))
def test_audio_slots_round_trip_and_exact_patch(bits, channels, depth):
    original = wav(bits=bits, channels=channels)
    adapter = inspect_audio(original)
    assert adapter.descriptor == f"wav:pcm{bits}:{channels}ch:8000hz"
    assert adapter.eligible_slots == 80 * channels
    assert adapter.sample_rate == 8000
    assert adapter.channels == channels
    assert adapter.bits_per_sample == bits
    assert adapter.sample_width == bits // 8
    assert adapter.frames == 80
    assert adapter.file_size == len(original)
    assert adapter.duration == pytest.approx(80 / 8000)
    before = adapter.clone()
    slot = 3 * channels + min(1, channels - 1)
    adapter.set_slot(slot, 0xA5)
    output = adapter.export()
    assert len(output) == len(original)
    assert output[: adapter.data_offset] == original[: adapter.data_offset]
    assert output[adapter.data_end:] == original[adapter.data_end:]
    assert inspect_audio(output).get_slot(slot) == 0xA5
    assert before != output
    assert adapter.patch() == output
    adapter.embed(b"hello", depth, 2)
    reread = inspect_audio(adapter.export())
    assert reread.extract(5, depth, 2) == b"hello"


def test_audio_preserves_odd_chunks_order_padding_and_raw_sample_bytes():
    original = wav(bits=24, channels=2, chunks=[(b"LIST", b"a"), (b"JUNK", b"bcde"), (b"data", b"\x01\x80\xff\x00\x00\x80")])
    adapter = inspect_audio(original)
    adapter.set_slot(1, 0xFF)
    output = adapter.export()
    assert output[: adapter.data_offset] == original[: adapter.data_offset]
    assert output[adapter.data_end:] == original[adapter.data_end:]
    assert output[adapter.data_offset + 3:adapter.data_offset + 6] != original[adapter.data_offset + 3:adapter.data_offset + 6]
    assert output[adapter.data_offset + 6:] == original[adapter.data_offset + 6:]


def test_audio_canonical_hash_masks_only_occupied_sample_lsb_bits():
    original = wav(bits=16, channels=2)
    adapter = inspect_audio(original)
    expected = bytearray(original)
    for slot in lsb.occupied_slots(2, 3, 2):
        expected[adapter.sample_offsets[slot]] &= 0xF8
    expected_hash = hashlib.sha256(b"stegloc/v1/carrier/wav-exact\0" + expected).hexdigest()
    assert canonical_hash(adapter, 3, 2, 2) == expected_hash


def test_audio_canonical_hash_sees_unoccupied_adapter_mutation():
    adapter = inspect_audio(wav(bits=16, channels=2))
    before = canonical_hash(adapter, 3, 2, 2)
    adapter.set_slot(20, adapter.get_slot(20) ^ 0x01)
    assert canonical_hash(adapter, 3, 2, 2) != before
    adapter.embed(b"ok", 3, 2)
    assert canonical_hash(adapter, 3, 2, 2) != before


@pytest.mark.parametrize("bad", [b"", b"RF64" + b"\0" * 100, b"RIFF\0\0\0\0AIFF"])
def test_audio_rejects_wrong_signature(bad):
    with pytest.raises(AudioError):
        inspect_audio(bad)


@pytest.mark.parametrize("mutator", [
    lambda data: data[:4] + struct.pack("<I", len(data)) + data[8:],
    lambda data: data[:12] + b"data" + struct.pack("<I", 0xFFFFFFFF) + data[20:],
    lambda data: data[:20] + struct.pack("<H", 3) + data[22:],
])
def test_audio_rejects_malformed_or_unsupported_headers(mutator):
    with pytest.raises(AudioError):
        inspect_audio(mutator(wav()))
