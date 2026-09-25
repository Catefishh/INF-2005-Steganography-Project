"""LSB replacement - encode / decode.

This follows the lecture code (LSB Replacement in Python 1/3 - 3/3):

    binary_secret_data = to_bin(secret_data)
    pixel[0] = int(r[:-1] + binary_secret_data[data_index], 2)
    ...
    binary_data += r[-1]
    all_bytes = [binary_data[i: i+8] for i in range(0, len(binary_data), 8)]

and extends it in two ways that the assignment asks for:

1. n_lsb (1 to 8) - instead of replacing only the last bit, replace the last
   n bits:   slot = int(slot_bits[:-n] + binary_secret_data[i:i+n], 2)
2. start - the payload does not have to begin at the top-left corner, it can
   begin at any slot.

A "slot" is one byte of the cover that is allowed to carry hidden bits:
  * image: one R, G or B byte of a pixel (row by row, pixel by pixel, R G B)
  * audio: the least significant byte of one PCM sample

The loops of the lecture code are written with numpy array operations so that
a 12 MP photo or a long WAV file does not take minutes, but every step below
matches a step of the lecture version.
"""

import numpy as np
import hashlib
import hmac
import math


class CapacityError(ValueError):
    pass


class NoFitError(CapacityError):
    pass


class PaddingError(ValueError):
    pass


def occupied_slots(length: int, depth: int, start: int):
    check_n_lsb(depth)
    if length < 0 or start < 0:
        raise ValueError("length and start must be nonnegative")
    return range(start, start + slots_needed(length, depth))


def available_bytes(slots: int, start: int, depth: int) -> int:
    check_n_lsb(depth)
    if slots < 0 or start < 0:
        raise ValueError("slots and start must be nonnegative")
    return max(0, (slots - start) * depth // 8)


def fits(slots: int, start: int, depth: int, length: int) -> bool:
    check_n_lsb(depth)
    return 0 <= start < slots and length >= 0 and start + slots_needed(length, depth) <= slots


def suggest_start(key: bytes, salt: bytes, descriptor: str, depth: int, slots: int, length: int) -> int:
    check_n_lsb(depth)
    last = slots - slots_needed(length, depth)
    if last < 0:
        raise NoFitError("encrypted package does not fit")
    if last == 0:
        return 0
    material = salt + descriptor.encode("utf-8") + bytes([depth]) + length.to_bytes(8, "big")
    ceiling = ((1 << 256) // last) * last
    for counter in range(256):
        value = int.from_bytes(hmac.new(key, material + counter.to_bytes(2, "big"), hashlib.sha256).digest(), "big")
        if value < ceiling:
            return 1 + value % last
    raise NoFitError("could not choose a start location")


def mask_slots(slots: bytearray, length: int, depth: int, start: int) -> None:
    if not fits(len(slots), start, depth, length):
        raise CapacityError("occupied slots exceed carrier")
    mask = 255 ^ ((1 << depth) - 1)
    end = start + slots_needed(length, depth)
    np.frombuffer(slots, dtype=np.uint8)[start:end] &= mask


def embed(slots: bytearray, payload: bytes, depth: int, start: int = 0) -> None:
    if not fits(len(slots), start, depth, len(payload)):
        raise CapacityError("encrypted package does not fit from selected start")
    bits = to_bits(payload)
    padding = (-len(bits)) % depth
    if padding:
        bits = np.pad(bits, (0, padding))
    groups = bits.reshape(-1, depth)
    weights = 2 ** np.arange(depth - 1, -1, -1)
    values = groups @ weights
    mask = 255 ^ ((1 << depth) - 1)
    target = np.frombuffer(slots, dtype=np.uint8)[start:start + len(values)]
    target[:] = (target & mask) | values.astype(np.uint8)


def extract(slots: bytearray, length: int, depth: int, start: int = 0) -> bytes:
    if not fits(len(slots), start, depth, length):
        raise CapacityError("extraction exceeds carrier")
    count = slots_needed(length, depth)
    if not count:
        return b""
    values = np.frombuffer(slots, dtype=np.uint8, count=count, offset=start) & ((1 << depth) - 1)
    shifts = np.arange(depth - 1, -1, -1)
    bits = ((values[:, None] >> shifts) & 1).reshape(-1)
    tail = bits[length * 8:]
    if tail.any():
        raise PaddingError("nonzero padding in last carrier slot")
    return np.packbits(bits[:length * 8]).tobytes()


def to_bin(data):
    """Convert `data` to binary format as string (same as the lecture)."""
    if isinstance(data, str):
        return ''.join([format(ord(i), "08b") for i in data])
    elif isinstance(data, bytes) or isinstance(data, np.ndarray):
        return [format(i, "08b") for i in data]
    elif isinstance(data, int) or isinstance(data, np.uint8):
        return format(data, "08b")
    else:
        raise TypeError("Type not supported.")


def to_bits(data):
    """bytes -> numpy array of 0/1 bits, most significant bit first.

    Same order as ''.join(to_bin(data)), e.g. b"G" -> [0,1,0,0,0,1,1,1].
    """
    return np.unpackbits(np.frombuffer(data, dtype=np.uint8))


def check_n_lsb(n_lsb):
    if not isinstance(n_lsb, int) or isinstance(n_lsb, bool) or not 1 <= n_lsb <= 8:
        raise ValueError("Number of LSBs must be a whole number from 1 to 8.")


def max_bytes(n_slots, n_lsb, start=0):
    """Maximum bytes that fit from `start` (lecture: n_bytes = h * w * 3 // 8)."""
    check_n_lsb(n_lsb)
    if not isinstance(start, int) or isinstance(start, bool) or start < 0:
        raise ValueError("Start location cannot be negative.")
    if start >= n_slots:
        return 0
    return (n_slots - start) * n_lsb // 8


def slots_needed(n_bytes, n_lsb):
    """How many slots n_bytes of data occupy (ceiling of n_bytes * 8 / n_lsb)."""
    check_n_lsb(n_lsb)
    return (n_bytes * 8 + n_lsb - 1) // n_lsb


def encode(slots, secret_data, n_lsb, start=0):
    """Hide `secret_data` (bytes) in the lowest n_lsb bits of slots[start:].

    `slots` is a numpy uint8 array and is changed in place.
    Returns the index just after the last slot that was used.
    """
    check_n_lsb(n_lsb)
    if start < 0:
        raise ValueError("Start location cannot be negative.")
    n_bytes = max_bytes(len(slots), n_lsb, start)  # maximum bytes to encode
    if len(secret_data) > n_bytes:
        raise ValueError("[!] Insufficient bytes, need bigger cover, more LSBs or less data.")

    binary_secret_data = to_bits(secret_data)  # convert data to binary
    data_len = len(binary_secret_data)  # size of data to hide

    # Pad with 0 bits so that every used slot receives exactly n_lsb bits.
    padding = (-data_len) % n_lsb
    bits = np.concatenate([binary_secret_data, np.zeros(padding, dtype=np.uint8)])

    # One row per slot, e.g. n_lsb = 2 -> [[0, 1], [0, 0], [0, 1], [1, 1]] for "G".
    groups = bits.reshape(-1, n_lsb).astype(np.int64)

    # int("01", 2): the first bit of the group becomes the highest of the n bits.
    weights = 2 ** np.arange(n_lsb - 1, -1, -1)  # n_lsb = 2 -> [2, 1]
    new_lsbs = (groups * weights).sum(axis=1).astype(np.uint8)

    end = start + len(new_lsbs)
    keep_mask = np.uint8((0xFF << n_lsb) & 0xFF)  # slot_bits[:-n] keeps the top 8 - n bits
    slots[start:end] = (slots[start:end] & keep_mask) | new_lsbs
    return end


def decode(slots, n_bytes, n_lsb, start=0):
    """Read `n_bytes` bytes hidden in the lowest n_lsb bits of slots[start:]."""
    check_n_lsb(n_lsb)
    used = slots_needed(n_bytes, n_lsb)
    if start < 0 or start + used > len(slots):
        raise ValueError("[!] The requested data runs past the end of the cover.")

    lsb_values = slots[start:start + used] & np.uint8((1 << n_lsb) - 1)

    # Lecture: binary_data += r[-1]. Here we take the last n_lsb bits of each slot.
    binary_data = np.unpackbits(lsb_values.astype(np.uint8)[:, None], axis=1)[:, 8 - n_lsb:]
    binary_data = binary_data.reshape(-1)[:n_bytes * 8]

    # Lecture: split by 8-bits and convert from bits to characters (here: bytes).
    return np.packbits(binary_data).tobytes()


def clear_lsbs(slots, n_lsb, start, count):
    """Set the lowest n_lsb bits of slots[start:start+count] to 0 (used for hashing)."""
    check_n_lsb(n_lsb)
    slots[start:start + count] &= np.uint8((0xFF << n_lsb) & 0xFF)
