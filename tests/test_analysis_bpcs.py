import numpy as np
import pytest

from backend.app.stego.analysis.bpcs import (
    ALLOWED_BLOCK_SIZES,
    DEFAULT_BIT_PLANE_END,
    DEFAULT_BIT_PLANE_START,
    DEFAULT_BLOCK_SIZE,
    DEFAULT_CHANNEL,
    DEFAULT_COMPLEXITY_THRESHOLD,
    PARTIAL_BLOCK_POLICY,
    BPCSConfig,
    block_complexities,
)


def test_config_defaults_and_blank_values_are_central_and_reproducible():
    expected = {
        "channel": 0,
        "block_size": 8,
        "bit_plane_start": 0,
        "bit_plane_end": 7,
        "complexity_threshold": 0.3,
        "partial_block_policy": "include-valid-adjacencies",
    }

    assert BPCSConfig.from_values().as_dict() == expected
    assert BPCSConfig.from_values(" ", "", None, "\t", "").as_dict() == expected
    assert DEFAULT_CHANNEL == 0
    assert DEFAULT_BLOCK_SIZE == 8
    assert DEFAULT_BIT_PLANE_START == 0
    assert DEFAULT_BIT_PLANE_END == 7
    assert DEFAULT_COMPLEXITY_THRESHOLD == 0.30
    assert ALLOWED_BLOCK_SIZES == (2, 4, 8, 16, 32, 64)
    assert PARTIAL_BLOCK_POLICY == "include-valid-adjacencies"


def test_config_accepts_valid_custom_values():
    config = BPCSConfig.from_values("2", "64", "1", "6", "0.45")

    assert config.as_dict() == {
        "channel": 2,
        "block_size": 64,
        "bit_plane_start": 1,
        "bit_plane_end": 6,
        "complexity_threshold": 0.45,
        "partial_block_policy": PARTIAL_BLOCK_POLICY,
    }


@pytest.mark.parametrize("value", [True, 1.5, "1.0", -1, 3, "no"])
def test_config_rejects_invalid_channel_with_exact_message(value):
    with pytest.raises(ValueError) as error:
        BPCSConfig.from_values(channel=value)
    assert str(error.value) == "BPCS channel must be a whole number from 0 through 2."


@pytest.mark.parametrize("value", [True, 3, "8.0", 128, "no"])
def test_config_rejects_invalid_block_size_with_exact_message(value):
    with pytest.raises(ValueError) as error:
        BPCSConfig.from_values(block_size=value)
    assert str(error.value) == "BPCS block size must be one of 2, 4, 8, 16, 32, or 64."


@pytest.mark.parametrize("field", ["bit_plane_start", "bit_plane_end"])
@pytest.mark.parametrize("value", [True, 2.5, "2.5", -1, 8, "no"])
def test_config_rejects_invalid_bit_plane_with_exact_message(field, value):
    with pytest.raises(ValueError) as error:
        BPCSConfig.from_values(**{field: value})
    assert str(error.value) == "BPCS bit planes must be whole numbers from 0 through 7."


def test_config_rejects_reversed_plane_range_with_exact_message():
    with pytest.raises(ValueError) as error:
        BPCSConfig.from_values(bit_plane_start=5, bit_plane_end=4)
    assert str(error.value) == "BPCS first bit plane must not exceed the last bit plane."


@pytest.mark.parametrize(
    "value",
    [True, float("nan"), float("inf"), float("-inf"), "nan", "infinity", -0.01, 1.01, "no"],
)
def test_config_rejects_invalid_threshold_with_exact_message(value):
    with pytest.raises(ValueError) as error:
        BPCSConfig.from_values(complexity_threshold=value)
    assert str(error.value) == "BPCS complexity threshold must be a number from 0 through 1."


@pytest.mark.parametrize(
    ("plane", "expected_transitions", "expected_complexity"),
    [
        (np.zeros((8, 8), dtype=np.uint8), 0, 0.0),
        (np.indices((8, 8)).sum(axis=0).astype(np.uint8) % 2, 112, 1.0),
        (np.tile(np.arange(8) % 2, (8, 1)).astype(np.uint8), 56, 0.5),
    ],
    ids=["zero", "checker", "stripe"],
)
def test_block_complexity_known_patterns(plane, expected_transitions, expected_complexity):
    complexity, transitions, possible = block_complexities(plane, 8)

    assert complexity.shape == transitions.shape == possible.shape == (1, 1)
    assert transitions[0, 0] == expected_transitions
    assert possible[0, 0] == 112
    assert complexity[0, 0] == expected_complexity


def test_partial_checkerboard_counts_only_valid_adjacencies():
    checker = np.indices((3, 2)).sum(axis=0).astype(np.uint8) % 2

    complexity, transitions, possible = block_complexities(checker, 4)

    assert transitions[0, 0] == 7
    assert possible[0, 0] == 7
    assert complexity[0, 0] == 1.0


def test_single_pixel_partial_block_has_zero_complexity_not_nan():
    complexity, transitions, possible = block_complexities(np.ones((1, 1), dtype=np.uint8), 2)

    assert transitions[0, 0] == 0
    assert possible[0, 0] == 0
    assert complexity[0, 0] == 0.0
    assert np.isfinite(complexity[0, 0])


def test_partial_blocks_do_not_count_padding_or_cross_block_transitions():
    plane = np.zeros((3, 3), dtype=np.uint8)
    plane[2, 2] = 1

    complexity, transitions, possible = block_complexities(plane, 2)

    np.testing.assert_array_equal(transitions, [[0, 0], [0, 0]])
    np.testing.assert_array_equal(possible, [[4, 1], [1, 0]])
    np.testing.assert_array_equal(complexity, np.zeros((2, 2)))
