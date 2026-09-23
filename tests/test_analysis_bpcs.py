import base64
import io

import numpy as np
import pytest
from PIL import Image

from backend.app.stego.analysis.bpcs import (
    ALLOWED_BLOCK_SIZES,
    DEFAULT_BIT_PLANE_END,
    DEFAULT_BIT_PLANE_START,
    DEFAULT_BLOCK_SIZE,
    DEFAULT_CHANNEL,
    DEFAULT_COMPLEXITY_THRESHOLD,
    PARTIAL_BLOCK_POLICY,
    BPCSConfig,
    analyse,
    block_complexities,
)
from backend.app.stego.analysis.common import CarrierAnalysis, prepare_inputs
from test_audio import wav


def png(array: np.ndarray) -> bytes:
    out = io.BytesIO()
    Image.fromarray(array.astype(np.uint8), mode="RGB").save(out, format="PNG")
    return out.getvalue()


def decode_png(data_url: str) -> np.ndarray:
    encoded = data_url.split(",", 1)[1]
    return np.array(Image.open(io.BytesIO(base64.b64decode(encoded))))


def image_context(plane: np.ndarray, *, channel: int = 0, bit: int = 0) -> CarrierAnalysis:
    pixels = np.zeros((*plane.shape, 3), dtype=np.uint8)
    pixels[:, :, channel] = plane.astype(np.uint8) << bit
    return prepare_inputs(png(pixels), None).suspect


def all_keys(value):
    if isinstance(value, dict):
        for key, child in value.items():
            yield key
            yield from all_keys(child)
    elif isinstance(value, list):
        for child in value:
            yield from all_keys(child)


def scalar_block_complexities(plane: np.ndarray, block_size: int):
    block_rows = (plane.shape[0] + block_size - 1) // block_size
    block_columns = (plane.shape[1] + block_size - 1) // block_size
    complexities = np.zeros((block_rows, block_columns), dtype=np.float64)
    transitions = np.zeros((block_rows, block_columns), dtype=np.int64)
    possible = np.zeros((block_rows, block_columns), dtype=np.int64)
    for block_row in range(block_rows):
        for block_column in range(block_columns):
            block = plane[
                block_row * block_size:(block_row + 1) * block_size,
                block_column * block_size:(block_column + 1) * block_size,
            ]
            count = int((block[:, 1:] != block[:, :-1]).sum())
            count += int((block[1:, :] != block[:-1, :]).sum())
            maximum = block.shape[0] * (block.shape[1] - 1) + (block.shape[0] - 1) * block.shape[1]
            transitions[block_row, block_column] = count
            possible[block_row, block_column] = maximum
            complexities[block_row, block_column] = count / maximum if maximum else 0.0
    return complexities, transitions, possible


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


@pytest.mark.parametrize("block_size", ALLOWED_BLOCK_SIZES)
@pytest.mark.parametrize(
    "dimensions",
    [(1, 1), (1, 7), (7, 1), (3, 5), (8, 8), (9, 10), (17, 13), (65, 67)],
)
def test_vectorized_kernel_matches_scalar_reference_for_random_partial_planes(block_size, dimensions):
    seed = dimensions[0] * 10_000 + dimensions[1] * 100 + block_size
    plane = np.random.default_rng(seed).integers(0, 2, dimensions, dtype=np.uint8)
    expected_complexity, expected_transitions, expected_possible = scalar_block_complexities(plane, block_size)

    complexity, transitions, possible = block_complexities(plane, block_size)

    np.testing.assert_array_equal(transitions, expected_transitions)
    np.testing.assert_array_equal(possible, expected_possible)
    np.testing.assert_allclose(complexity, expected_complexity, rtol=0, atol=0)
    for threshold in (0.0, 0.3, 1.0):
        np.testing.assert_array_equal(complexity >= threshold, expected_complexity >= threshold)


def test_block_kernel_does_not_reduce_each_block_individually(monkeypatch):
    calls = 0
    real_count_nonzero = np.count_nonzero

    def recording_count_nonzero(*args, **kwargs):
        nonlocal calls
        calls += 1
        return real_count_nonzero(*args, **kwargs)

    monkeypatch.setattr(np, "count_nonzero", recording_count_nonzero)

    block_complexities(np.indices((31, 29)).sum(axis=0).astype(np.uint8) % 2, 2)

    assert calls <= 4


def test_image_result_maps_and_partial_block_capacity_are_exact():
    checker = np.indices((6, 6)).sum(axis=0).astype(np.uint8) % 2
    context = image_context(checker)
    config = BPCSConfig.from_values(0, 4, 0, 0, 0.3)

    result = analyse(context, None, config)

    assert result["supported"] is True
    assert result["reason"] is None
    assert result["config"] == config.as_dict()
    assert result["image"] == {"width": 6, "height": 6}
    assert [plane["bit_plane"] for plane in result["planes"]] == [0]
    assert result["comparison"] is None

    plane = result["planes"][0]
    assert plane["block_rows"] == 2
    assert plane["block_columns"] == 2
    assert plane["block_count"] == 4
    assert plane["complex_blocks"] == 4
    assert plane["non_complex_blocks"] == 0
    assert plane["complex_percent"] == 100.0
    assert plane["transition_count"] == 48
    assert plane["possible_transition_count"] == 48
    assert plane["transition_ratio"] == 1.0
    assert plane["mean_complexity"] == 1.0
    assert plane["minimum_complexity"] == 1.0
    assert plane["maximum_complexity"] == 1.0
    assert plane["capacity_bits"] == 36
    assert plane["capacity_bytes_floor"] == 4
    assert plane["capacity_remainder_bits"] == 4
    assert plane["map_rows"] == 2
    assert plane["map_columns"] == 2
    assert plane["map_block_stride"] == 1
    np.testing.assert_array_equal(decode_png(plane["complexity_map"]), np.full((2, 2), 255))
    np.testing.assert_array_equal(decode_png(plane["classification_map"]), np.full((2, 2), 255))

    assert result["summary"] == {
        "selected_plane_count": 1,
        "block_count": 4,
        "complex_blocks": 4,
        "non_complex_blocks": 0,
        "complex_percent": 100.0,
        "transition_count": 48,
        "possible_transition_count": 48,
        "transition_ratio": 1.0,
        "mean_complexity": 1.0,
        "minimum_complexity": 1.0,
        "maximum_complexity": 1.0,
        "capacity_bits": 36,
        "capacity_bytes_floor": 4,
        "capacity_remainder_bits": 4,
    }


def test_maps_are_bounded_while_statistics_keep_all_blocks():
    checker = np.indices((1025, 1025)).sum(axis=0).astype(np.uint8) % 2
    context = image_context(checker)
    config = BPCSConfig.from_values(block_size=2, bit_plane_start=0, bit_plane_end=0)

    result = analyse(context, None, config)

    plane = result["planes"][0]
    assert plane["block_rows"] == 513
    assert plane["block_columns"] == 513
    assert plane["block_count"] == 513 * 513
    assert plane["map_block_stride"] == 2
    assert plane["map_rows"] == 257
    assert plane["map_columns"] == 257
    assert decode_png(plane["complexity_map"]).shape == (257, 257)
    assert decode_png(plane["classification_map"]).shape == (257, 257)
    assert not ({"complexities", "classifications", "matrix", "raw"} & set(plane))


def test_summary_aggregates_raw_blocks_across_selected_planes():
    pixels = np.zeros((2, 2, 3), dtype=np.uint8)
    pixels[:, :, 0] = np.array([[0, 1], [1, 0]], dtype=np.uint8)
    context = prepare_inputs(png(pixels), None).suspect
    config = BPCSConfig.from_values(block_size=2, bit_plane_start=0, bit_plane_end=1)

    summary = analyse(context, None, config)["summary"]

    assert summary == {
        "selected_plane_count": 2,
        "block_count": 2,
        "complex_blocks": 1,
        "non_complex_blocks": 1,
        "complex_percent": 50.0,
        "transition_count": 4,
        "possible_transition_count": 8,
        "transition_ratio": 0.5,
        "mean_complexity": 0.5,
        "minimum_complexity": 0.0,
        "maximum_complexity": 1.0,
        "capacity_bits": 4,
        "capacity_bytes_floor": 0,
        "capacity_remainder_bits": 4,
    }


def test_reference_comparison_reports_directional_block_and_capacity_deltas():
    reference_plane = np.array([[0, 0, 0, 1, 0, 0], [0, 0, 1, 0, 0, 0]], dtype=np.uint8)
    suspect_plane = np.array([[0, 0, 1, 1, 0, 1], [0, 0, 1, 0, 1, 0]], dtype=np.uint8)
    reference = image_context(reference_plane)
    suspect = image_context(suspect_plane)
    config = BPCSConfig.from_values(block_size=2, bit_plane_start=0, bit_plane_end=0, complexity_threshold=0.3)

    result = analyse(suspect, reference, config)

    expected = {
        "changed_blocks": 2,
        "classification_flips": 1,
        "flips_to_complex": 1,
        "flips_to_non_complex": 0,
        "mean_complexity_delta": pytest.approx(1 / 6),
        "mean_absolute_complexity_delta": pytest.approx(0.5),
        "capacity_bits_delta": 4,
        "capacity_bytes_floor_delta": 1,
    }
    assert result["comparison"]["summary"] == expected
    assert result["comparison"]["planes"] == [{"bit_plane": 0, **expected}]
    assert not ({"detector", "detected", "suspicious", "verdict"} & set(all_keys(result)))


def test_audio_returns_exact_unsupported_shape_without_image_kernels(monkeypatch):
    context = prepare_inputs(wav(channels=2, frames=32), None).suspect
    config = BPCSConfig.from_values(2, 4, 1, 3, 0.45)

    def fail_image_channel(*_args, **_kwargs):
        raise AssertionError("audio BPCS must not invoke image-only kernels")

    monkeypatch.setattr(CarrierAnalysis, "image_channel", fail_image_channel)

    assert analyse(context, None, config) == {
        "supported": False,
        "reason": "BPCS analysis is available only for image inputs.",
        "config": config.as_dict(),
        "image": None,
        "planes": [],
        "summary": None,
        "comparison": None,
    }
