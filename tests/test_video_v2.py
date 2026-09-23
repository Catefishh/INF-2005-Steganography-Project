"""A real, minimal classic AVI fixture for the v2 video carrier contract."""
import struct

import pytest

from backend.app.stego.carriers.video import VideoError, inspect_video
from backend.app.stego.v2_security import generate_signing_keys, load_signing_key, load_verification_key
from backend.app.workflows import protect_video, verify_video, Verdict


def chunk(name: bytes, body: bytes) -> bytes:
    return name + struct.pack("<I", len(body)) + body + (b"\0" if len(body) & 1 else b"")


def avi(width=64, height=64, frames=10) -> bytes:
    stride = (width * 3 + 3) & ~3
    frame = bytes((i * 71 + 23) % 256 for i in range(stride * height))
    avih = struct.pack("<14I", 100_000, 0, 0, 0, frames, 0, 1, stride * height, width, height, 0, 0, 0, 0)
    strh = bytearray(56)
    strh[:8] = b"vidsDIB "
    struct.pack_into("<III", strh, 20, 1, 10, 0)
    struct.pack_into("<I", strh, 32, frames)
    strf = struct.pack("<IiiHHIIiiII", 40, width, height, 1, 24, 0, stride * height, 0, 0, 0, 0)
    header = chunk(b"avih", avih) + chunk(b"LIST", b"strl" + chunk(b"strh", bytes(strh)) + chunk(b"strf", strf))
    movi = b"".join(chunk(b"00db", frame) for _ in range(frames))
    index = b"".join(struct.pack("<4sIII", b"00db", 0x10, 0, len(frame)) for _ in range(frames))
    body = b"AVI " + chunk(b"LIST", b"hdrl" + header) + chunk(b"LIST", b"movi" + movi) + chunk(b"idx1", index)
    return chunk(b"RIFF", body)


def test_video_inside_video_round_trip_and_exact_size():
    cover = avi()
    payload = avi(8, 8, 2)
    original = inspect_video(cover)
    private, public = generate_signing_keys()
    protected = protect_video(cover, payload, load_signing_key(private), metadata={"filename": "small.avi", "media_type": "video/x-msvideo"}, depth=3)
    assert len(protected.carrier) == len(cover)
    adapter = inspect_video(protected.carrier)
    assert adapter.frame_count == 10
    assert (adapter.width, adapter.height, adapter.rate, adapter.scale) == (
        original.width, original.height, original.rate, original.scale)
    assert adapter.location(adapter.slot_for(1, 2, 3, 2)) == (1, 2, 3, 2)
    changed = {index for index, (before, after) in enumerate(zip(cover, protected.carrier)) if before != after}
    assert changed
    assert changed.issubset({original.physical_offset(index) for index in range(original.eligible_slots)})
    result = verify_video(protected.carrier, protected.sidecar, protected.recovery_code, load_verification_key(public))
    assert result.overall is Verdict.AUTHENTIC
    assert result.content == payload
    assert inspect_video(result.content).frame_count == 2


def test_video_rejects_audio_stream_and_truncation():
    data = avi()
    with pytest.raises(VideoError):
        inspect_video(data[:-1])
    altered = bytearray(data)
    altered[altered.index(b"vids"):altered.index(b"vids") + 4] = b"auds"
    with pytest.raises(VideoError, match="video"):
        inspect_video(bytes(altered))
    compressed = bytearray(data)
    bitmap = compressed.index(struct.pack("<IiiHHI", 40, 64, 64, 1, 24, 0))
    struct.pack_into("<I", compressed, bitmap + 16, 1)
    with pytest.raises(VideoError, match="uncompressed"):
        inspect_video(bytes(compressed))
