"""Contiguous logical byte slots, independent of media adapters.

Stream bytes run MSB first; each slot receives bits at positions 0 through k-1.
Unused selected bits in the final slot are zero and checked during extraction.
Invalid arguments raise ValueError; insufficient space raises CapacityError.
Counts/starts/byte lengths are uint64; booleans are rejected. Empty operations
allow start == N (including an empty carrier). Callers validate envelopes.
"""

import hashlib
import hmac
from collections.abc import MutableSequence, Sequence
from ..cancellation import check as _cancel_check

UINT64_MAX = 2**64 - 1


class CapacityError(ValueError):
    """The requested contiguous span cannot fit."""


class NoFitError(CapacityError):
    """No suggested start can fit the requested span."""


class PaddingError(ValueError):
    """Unused selected bits in the last occupied slot were nonzero."""


def _integer(value: int, name: str, maximum: int = UINT64_MAX) -> None:
    if type(value) is not int or not 0 <= value <= maximum:
        raise ValueError(f"{name} must be an integer in 0..{maximum}")


def _depth(k: int) -> None:
    _integer(k, "depth", 8)
    if k == 0:
        raise ValueError("depth must be in 1..8")


def required_slots(E: int, k: int) -> int:
    """Ceiling of E*8/k, using integer arithmetic only."""
    _depth(k)
    _integer(E, "byte length")
    span = (E * 8 + k - 1) // k
    if span > UINT64_MAX:
        raise ValueError("required slot span exceeds uint64")
    return span


def available_bytes(N: int, start: int, k: int) -> int:
    _depth(k)
    _integer(N, "slot count")
    _integer(start, "start")
    if start > N:
        raise ValueError("start outside carrier")
    return (N - start) * k // 8


def fits(N: int, start: int, k: int, E: int) -> bool:
    span = required_slots(E, k)
    _integer(N, "slot count")
    _integer(start, "start")
    return start <= N and start + span <= N


def occupied_slots(E: int, k: int, start: int = 0) -> range:
    """Exactly the E-byte span, including a partially used final slot.

    This has no carrier bound; operations below check it against their sequence.
    E=0 returns an empty range. Canonical hashing clears all k low bits of each
    returned slot, including padding positions; higher bits remain significant.
    """
    _integer(start, "start")
    span = required_slots(E, k)
    if start + span > UINT64_MAX:
        raise ValueError("occupied slot range exceeds uint64")
    return range(start, start + span)


def _checked_slots(slots: Sequence[int], E: int, k: int, start: int) -> range:
    if not fits(len(slots), start, k, E):
        raise CapacityError("payload does not fit")
    indices = occupied_slots(E, k, start)
    for count, i in enumerate(indices):
        if count % 4096 == 0: _cancel_check()
        _integer(slots[i], "slot value", 255)
    return indices


def embed(slots: MutableSequence[int], payload: bytes, k: int, start: int = 0, *, check=None) -> None:
    """Mutate only the occupied low bits; validate the whole span first."""
    if not isinstance(payload, bytes):
        raise ValueError("payload must be bytes")
    indices = _checked_slots(slots, len(payload), k, start)
    bit = 0
    for i in indices:
        (check or _cancel_check)()
        value = 0
        for position in range(k):
            if bit < len(payload) * 8:
                value |= ((payload[bit // 8] >> (7 - bit % 8)) & 1) << position
            bit += 1
        slots[i] = (slots[i] & (255 ^ ((1 << k) - 1))) | value


def extract(slots: Sequence[int], E: int, k: int, start: int = 0, *, check=None) -> bytes:
    """Read exactly E bytes, rejecting overflow and nonzero final padding."""
    indices = _checked_slots(slots, E, k, start)
    result = bytearray(E)
    bit = 0
    for i in indices:
        (check or _cancel_check)()
        for position in range(k):
            value = (slots[i] >> position) & 1
            if bit < E * 8:
                result[bit // 8] |= value << (7 - bit % 8)
            elif value:
                raise PaddingError("nonzero final padding")
            bit += 1
    return bytes(result)


def mask_slots(slots: MutableSequence[int], E: int, k: int, start: int = 0, *, check=None) -> None:
    """Clear only low k bits in occupied_slots, in place, for canonical hashing."""
    indices = _checked_slots(slots, E, k, start)
    mask = 255 ^ ((1 << k) - 1)
    for i in indices:
        (check or _cancel_check)()
        slots[i] &= mask


def suggest_start(key: bytes, salt: bytes, descriptor: str, k: int, N: int, E: int) -> int:
    """Uniformly suggest a nonzero fitting start with HMAC-SHA256.

    Key is 32 bytes and salt 16 bytes, as in v1 HKDF. Message is domain + salt
    + uint16 UTF-8 descriptor length + descriptor + uint8 depth + uint64 span
    + uint64 counter, all integers big-endian. Counter starts at zero. Reject
    digests outside the largest multiple of the number of nonzero starts below
    2**256. Return zero only when it is the sole fit. Empty spans can start at N.
    """
    span = required_slots(E, k)
    _integer(N, "slot count")
    if not isinstance(key, bytes) or len(key) != 32:
        raise ValueError("key must be 32 bytes")
    if not isinstance(salt, bytes) or len(salt) != 16:
        raise ValueError("salt must be 16 bytes")
    if not isinstance(descriptor, str):
        raise ValueError("descriptor must be UTF-8 text")
    try:
        encoded = descriptor.encode("utf-8")
    except UnicodeEncodeError as exc:
        raise ValueError("descriptor must be UTF-8 text") from exc
    if not 1 <= len(encoded) <= 512:
        raise ValueError("descriptor must be 1..512 UTF-8 bytes")
    count = N - span
    if count < 0:
        raise NoFitError("no start fits")
    if count == 0:
        return 0
    message = (b"stegloc/v1/start-selection\x00" + salt
               + len(encoded).to_bytes(2, "big") + encoded
               + bytes([k]) + span.to_bytes(8, "big"))
    limit = 2**256 - (2**256 % count)
    counter = 0
    while True:
        digest = hmac.new(key, message + counter.to_bytes(8, "big"), hashlib.sha256).digest()
        value = int.from_bytes(digest, "big")
        if value < limit:
            return 1 + value % count
        counter += 1


def _dimensions(*dimensions: int) -> None:
    for dimension in dimensions:
        _integer(dimension, "dimension")
        if dimension == 0:
            raise ValueError("dimensions must be positive")


def _coordinate(value: int, bound: int) -> None:
    _integer(value, "coordinate", bound - 1)


def rgb_index(width: int, height: int, x: int, y: int, channel: int) -> int:
    """Logical RGB channel 0..2; adapter maps physical channel order/labels."""
    _dimensions(width, height)
    _coordinate(x, width)
    _coordinate(y, height)
    _coordinate(channel, 3)
    index = (y * width + x) * 3 + channel
    if index > UINT64_MAX:
        raise ValueError("coordinate index exceeds uint64")
    return index


def rgb_coordinates(index: int, width: int, height: int) -> tuple[int, int, int]:
    """Return (x, y, channel)."""
    _dimensions(width, height)
    slot_count = width * height * 3
    if slot_count > UINT64_MAX:
        raise ValueError("coordinate space exceeds uint64")
    _coordinate(index, slot_count)
    pixel, channel = divmod(index, 3)
    y, x = divmod(pixel, width)
    return x, y, channel


def audio_index(frames: int, channels: int, frame: int, channel: int) -> int:
    _dimensions(frames, channels)
    _coordinate(frame, frames)
    _coordinate(channel, channels)
    index = frame * channels + channel
    if index > UINT64_MAX:
        raise ValueError("coordinate index exceeds uint64")
    return index


def audio_coordinates(index: int, frames: int, channels: int) -> tuple[int, int]:
    """Return (sample_frame, channel); channels need not be mono/stereo."""
    _dimensions(frames, channels)
    slot_count = frames * channels
    if slot_count > UINT64_MAX:
        raise ValueError("coordinate space exceeds uint64")
    _coordinate(index, slot_count)
    return divmod(index, channels)


def video_index(frames: int, width: int, height: int, frame: int,
                x: int, y: int, channel: int) -> int:
    _dimensions(frames, width, height)
    _coordinate(frame, frames)
    slot_count = frames * width * height * 3
    if slot_count > UINT64_MAX:
        raise ValueError("coordinate space exceeds uint64")
    return frame * width * height * 3 + rgb_index(width, height, x, y, channel)


def video_coordinates(index: int, frames: int, width: int,
                      height: int) -> tuple[int, int, int, int]:
    """Return (frame, x, y, channel) in the same logical RGB order as images."""
    _dimensions(frames, width, height)
    slot_count = frames * width * height * 3
    if slot_count > UINT64_MAX:
        raise ValueError("coordinate space exceeds uint64")
    _coordinate(index, slot_count)
    frame, local = divmod(index, width * height * 3)
    return (frame, *rgb_coordinates(local, width, height))
