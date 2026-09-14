import numpy as np
import pytest

from backend.app.stego import lsb


def test_to_bin_matches_lecture():
    assert lsb.to_bin("G") == "01000111"
    assert lsb.to_bin(b"AB") == ["01000001", "01000010"]
    assert lsb.to_bin(np.uint8(150)) == "10010110"
    with pytest.raises(TypeError):
        lsb.to_bin(1.5)


def test_lecture_slide_letter_g_example():
    # Lecture "LSB Replacement Example": payload G (01000111) into 9 bytes, 1 LSB.
    original = np.array([0b10010101, 0b00001101, 0b11001001, 0b10010110, 0b00001111,
                         0b11001011, 0b10011111, 0b00010000, 0b11001011], dtype=np.uint8)
    slots = original.copy()
    lsb.encode(slots, b"G", 1, 0)
    expected = [0b10010100, 0b00001101, 0b11001000, 0b10010110, 0b00001110,
                0b11001011, 0b10011111, 0b00010001, 0b11001011]
    assert slots.tolist() == expected
    assert lsb.decode(slots, 1, 1, 0) == b"G"


@pytest.mark.parametrize("n_lsb", range(1, 9))
@pytest.mark.parametrize("start", [0, 1, 37])
def test_round_trip_and_only_low_bits_change(n_lsb, start):
    rng = np.random.default_rng(n_lsb)
    original = rng.integers(0, 256, 4000, dtype=np.uint8)
    slots = original.copy()
    secret = bytes(rng.integers(0, 256, 123, dtype=np.uint8))
    end = lsb.encode(slots, secret, n_lsb, start)
    assert end == start + lsb.slots_needed(len(secret), n_lsb)
    assert lsb.decode(slots, len(secret), n_lsb, start) == secret
    high = np.uint8((0xFF << n_lsb) & 0xFF)
    assert np.array_equal(slots & high, original & high)
    assert np.array_equal(slots[:start], original[:start])
    assert np.array_equal(slots[end:], original[end:])


def test_two_lsb_uses_string_replacement_order():
    slots = np.array([0b11111111, 0b11111111, 0b11111111, 0b11111111], dtype=np.uint8)
    lsb.encode(slots, b"G", 2, 0)  # 01 00 01 11
    assert [format(v, "08b") for v in slots] == ["11111101", "11111100", "11111101", "11111111"]


def test_works_on_a_stepped_view():
    raw = np.zeros(40, dtype=np.uint8)
    view = raw[0::2]
    lsb.encode(view, b"\xff", 1, 3)
    assert raw[6:22:2].tolist() == [1] * 8
    assert raw[1::2].sum() == 0


def test_capacity_errors():
    slots = np.zeros(16, dtype=np.uint8)
    with pytest.raises(ValueError, match="Insufficient"):
        lsb.encode(slots, b"abc", 1, 0)
    with pytest.raises(ValueError, match="past the end"):
        lsb.decode(slots, 3, 1, 0)
    with pytest.raises(ValueError):
        lsb.encode(slots, b"a", 0, 0)
    assert lsb.max_bytes(16, 2, 4) == 3
