"""Bit-plane complexity segmentation (BPCS) analysis."""

import math
from dataclasses import dataclass

import numpy as np

from .common import CarrierAnalysis, png_data_url

DEFAULT_CHANNEL = 0
DEFAULT_BLOCK_SIZE = 8
DEFAULT_BIT_PLANE_START = 0
DEFAULT_BIT_PLANE_END = 7
DEFAULT_COMPLEXITY_THRESHOLD = 0.30
ALLOWED_BLOCK_SIZES = (2, 4, 8, 16, 32, 64)
MAP_SIDE_LIMIT = 512
PARTIAL_BLOCK_POLICY = "include-valid-adjacencies"

CHANNEL_ERROR = "BPCS channel must be a whole number from 0 through 2."
BLOCK_SIZE_ERROR = "BPCS block size must be one of 2, 4, 8, 16, 32, or 64."
BIT_PLANE_ERROR = "BPCS bit planes must be whole numbers from 0 through 7."
BIT_PLANE_RANGE_ERROR = "BPCS first bit plane must not exceed the last bit plane."
THRESHOLD_ERROR = "BPCS complexity threshold must be a number from 0 through 1."


def _blank(value: object) -> bool:
    return value is None or isinstance(value, str) and not value.strip()


def _whole_number(value: object, default: int, error: str) -> int:
    if _blank(value):
        return default
    if type(value) is int:
        return value
    if isinstance(value, str):
        text = value.strip()
        digits = text[1:] if text[:1] in {"+", "-"} else text
        if digits.isdecimal():
            return int(text)
    raise ValueError(error)


def _threshold(value: object) -> float:
    if _blank(value):
        return DEFAULT_COMPLEXITY_THRESHOLD
    if isinstance(value, bool):
        raise ValueError(THRESHOLD_ERROR)
    try:
        result = float(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError(THRESHOLD_ERROR) from exc
    if not math.isfinite(result) or not 0 <= result <= 1:
        raise ValueError(THRESHOLD_ERROR)
    return result


@dataclass(frozen=True, slots=True)
class BPCSConfig:
    channel: int = DEFAULT_CHANNEL
    block_size: int = DEFAULT_BLOCK_SIZE
    bit_plane_start: int = DEFAULT_BIT_PLANE_START
    bit_plane_end: int = DEFAULT_BIT_PLANE_END
    complexity_threshold: float = DEFAULT_COMPLEXITY_THRESHOLD

    def __post_init__(self) -> None:
        if type(self.channel) is not int or not 0 <= self.channel <= 2:
            raise ValueError(CHANNEL_ERROR)
        if type(self.block_size) is not int or self.block_size not in ALLOWED_BLOCK_SIZES:
            raise ValueError(BLOCK_SIZE_ERROR)
        if type(self.bit_plane_start) is not int or not 0 <= self.bit_plane_start <= 7:
            raise ValueError(BIT_PLANE_ERROR)
        if type(self.bit_plane_end) is not int or not 0 <= self.bit_plane_end <= 7:
            raise ValueError(BIT_PLANE_ERROR)
        if self.bit_plane_start > self.bit_plane_end:
            raise ValueError(BIT_PLANE_RANGE_ERROR)
        if isinstance(self.complexity_threshold, bool):
            raise ValueError(THRESHOLD_ERROR)
        try:
            finite_threshold = math.isfinite(self.complexity_threshold)
        except TypeError as exc:
            raise ValueError(THRESHOLD_ERROR) from exc
        if not finite_threshold or not 0 <= self.complexity_threshold <= 1:
            raise ValueError(THRESHOLD_ERROR)

    @classmethod
    def from_values(
        cls,
        channel: object = None,
        block_size: object = None,
        bit_plane_start: object = None,
        bit_plane_end: object = None,
        complexity_threshold: object = None,
    ) -> "BPCSConfig":
        parsed_channel = _whole_number(channel, DEFAULT_CHANNEL, CHANNEL_ERROR)
        parsed_block_size = _whole_number(block_size, DEFAULT_BLOCK_SIZE, BLOCK_SIZE_ERROR)
        parsed_start = _whole_number(bit_plane_start, DEFAULT_BIT_PLANE_START, BIT_PLANE_ERROR)
        parsed_end = _whole_number(bit_plane_end, DEFAULT_BIT_PLANE_END, BIT_PLANE_ERROR)
        parsed_threshold = _threshold(complexity_threshold)
        return cls(parsed_channel, parsed_block_size, parsed_start, parsed_end, parsed_threshold)

    def as_dict(self) -> dict[str, int | float | str]:
        return {
            "channel": self.channel,
            "block_size": self.block_size,
            "bit_plane_start": self.bit_plane_start,
            "bit_plane_end": self.bit_plane_end,
            "complexity_threshold": self.complexity_threshold,
            "partial_block_policy": PARTIAL_BLOCK_POLICY,
        }


def block_complexities(plane: np.ndarray, block_size: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    height, width = plane.shape
    block_rows = math.ceil(height / block_size)
    block_columns = math.ceil(width / block_size)
    complexities = np.zeros((block_rows, block_columns), dtype=np.float64)
    transitions = np.zeros((block_rows, block_columns), dtype=np.int64)
    possible = np.zeros((block_rows, block_columns), dtype=np.int64)

    for block_row in range(block_rows):
        row_start = block_row * block_size
        row_end = min(row_start + block_size, height)
        for block_column in range(block_columns):
            column_start = block_column * block_size
            column_end = min(column_start + block_size, width)
            block = plane[row_start:row_end, column_start:column_end]
            block_height, block_width = block.shape
            count = int(np.count_nonzero(block[:, 1:] != block[:, :-1]))
            count += int(np.count_nonzero(block[1:, :] != block[:-1, :]))
            maximum = block_height * (block_width - 1) + (block_height - 1) * block_width
            transitions[block_row, block_column] = count
            possible[block_row, block_column] = maximum
            complexities[block_row, block_column] = count / maximum if maximum else 0.0
    return complexities, transitions, possible


def _valid_pixel_counts(height: int, width: int, block_size: int) -> np.ndarray:
    row_sizes = np.minimum(block_size, height - np.arange(math.ceil(height / block_size)) * block_size)
    column_sizes = np.minimum(block_size, width - np.arange(math.ceil(width / block_size)) * block_size)
    return np.multiply.outer(row_sizes, column_sizes).astype(np.int64)


def _metrics(
    complexities: np.ndarray,
    transitions: np.ndarray,
    possible: np.ndarray,
    classifications: np.ndarray,
    valid_pixels: np.ndarray,
) -> dict[str, int | float]:
    block_count = int(complexities.size)
    complex_blocks = int(classifications.sum())
    transition_count = int(transitions.sum())
    possible_transition_count = int(possible.sum())
    capacity_bits = int(valid_pixels[classifications].sum())
    return {
        "block_count": block_count,
        "complex_blocks": complex_blocks,
        "non_complex_blocks": block_count - complex_blocks,
        "complex_percent": complex_blocks * 100.0 / block_count,
        "transition_count": transition_count,
        "possible_transition_count": possible_transition_count,
        "transition_ratio": transition_count / possible_transition_count if possible_transition_count else 0.0,
        "mean_complexity": float(complexities.mean()),
        "minimum_complexity": float(complexities.min()),
        "maximum_complexity": float(complexities.max()),
        "capacity_bits": capacity_bits,
        "capacity_bytes_floor": capacity_bits // 8,
        "capacity_remainder_bits": capacity_bits % 8,
    }


def _plane_data(context: CarrierAnalysis, config: BPCSConfig, bit: int) -> dict[str, object]:
    plane = context.bit_plane(config.channel, bit)
    complexities, transitions, possible = block_complexities(plane, config.block_size)
    classifications = complexities >= config.complexity_threshold
    valid_pixels = _valid_pixel_counts(plane.shape[0], plane.shape[1], config.block_size)
    return {
        "plane": plane,
        "complexities": complexities,
        "transitions": transitions,
        "possible": possible,
        "classifications": classifications,
        "valid_pixels": valid_pixels,
        "metrics": _metrics(complexities, transitions, possible, classifications, valid_pixels),
    }


def _plane_result(data: dict[str, object], bit: int) -> dict[str, object]:
    complexities = data["complexities"]
    classifications = data["classifications"]
    block_rows, block_columns = complexities.shape
    map_stride = max(1, math.ceil(max(block_rows, block_columns) / MAP_SIDE_LIMIT))
    complexity_map = np.rint(complexities[::map_stride, ::map_stride] * 255).astype(np.uint8)
    classification_map = classifications[::map_stride, ::map_stride].astype(np.uint8) * 255
    return {
        "bit_plane": bit,
        "block_rows": block_rows,
        "block_columns": block_columns,
        **data["metrics"],
        "complexity_map": png_data_url(complexity_map),
        "classification_map": png_data_url(classification_map),
        "map_rows": int(complexity_map.shape[0]),
        "map_columns": int(complexity_map.shape[1]),
        "map_block_stride": map_stride,
    }


def _summary(all_data: list[dict[str, object]]) -> dict[str, int | float]:
    block_count = sum(data["metrics"]["block_count"] for data in all_data)
    complex_blocks = sum(data["metrics"]["complex_blocks"] for data in all_data)
    transition_count = sum(data["metrics"]["transition_count"] for data in all_data)
    possible_transition_count = sum(data["metrics"]["possible_transition_count"] for data in all_data)
    capacity_bits = sum(data["metrics"]["capacity_bits"] for data in all_data)
    complexity_sum = sum(float(data["complexities"].sum()) for data in all_data)
    return {
        "selected_plane_count": len(all_data),
        "block_count": block_count,
        "complex_blocks": complex_blocks,
        "non_complex_blocks": block_count - complex_blocks,
        "complex_percent": complex_blocks * 100.0 / block_count,
        "transition_count": transition_count,
        "possible_transition_count": possible_transition_count,
        "transition_ratio": transition_count / possible_transition_count if possible_transition_count else 0.0,
        "mean_complexity": complexity_sum / block_count,
        "minimum_complexity": min(float(data["complexities"].min()) for data in all_data),
        "maximum_complexity": max(float(data["complexities"].max()) for data in all_data),
        "capacity_bits": capacity_bits,
        "capacity_bytes_floor": capacity_bits // 8,
        "capacity_remainder_bits": capacity_bits % 8,
    }


def _changed_blocks(suspect: np.ndarray, reference: np.ndarray, block_size: int) -> np.ndarray:
    height, width = suspect.shape
    changed = np.zeros((math.ceil(height / block_size), math.ceil(width / block_size)), dtype=bool)
    differences = suspect != reference
    for row in range(changed.shape[0]):
        row_start = row * block_size
        for column in range(changed.shape[1]):
            column_start = column * block_size
            changed[row, column] = bool(
                differences[
                    row_start:min(row_start + block_size, height),
                    column_start:min(column_start + block_size, width),
                ].any()
            )
    return changed


def _comparison_metrics(
    suspect: dict[str, object],
    reference: dict[str, object],
    config: BPCSConfig,
) -> tuple[dict[str, int | float], np.ndarray]:
    suspect_classes = suspect["classifications"]
    reference_classes = reference["classifications"]
    deltas = suspect["complexities"] - reference["complexities"]
    changed = _changed_blocks(suspect["plane"], reference["plane"], config.block_size)
    capacity_bits_delta = suspect["metrics"]["capacity_bits"] - reference["metrics"]["capacity_bits"]
    metrics = {
        "changed_blocks": int(changed.sum()),
        "classification_flips": int(np.count_nonzero(suspect_classes != reference_classes)),
        "flips_to_complex": int(np.count_nonzero(suspect_classes & ~reference_classes)),
        "flips_to_non_complex": int(np.count_nonzero(~suspect_classes & reference_classes)),
        "mean_complexity_delta": float(deltas.mean()),
        "mean_absolute_complexity_delta": float(np.abs(deltas).mean()),
        "capacity_bits_delta": capacity_bits_delta,
        "capacity_bytes_floor_delta": (
            suspect["metrics"]["capacity_bits"] // 8 - reference["metrics"]["capacity_bits"] // 8
        ),
    }
    return metrics, deltas


def _comparison(
    suspect_data: list[dict[str, object]],
    reference: CarrierAnalysis,
    config: BPCSConfig,
) -> dict[str, object]:
    planes = []
    reference_data = []
    deltas = []
    for bit, suspect in zip(range(config.bit_plane_start, config.bit_plane_end + 1), suspect_data):
        reference_plane = _plane_data(reference, config, bit)
        metrics, plane_deltas = _comparison_metrics(suspect, reference_plane, config)
        planes.append({"bit_plane": bit, **metrics})
        reference_data.append(reference_plane)
        deltas.append(plane_deltas)

    suspect_capacity = sum(data["metrics"]["capacity_bits"] for data in suspect_data)
    reference_capacity = sum(data["metrics"]["capacity_bits"] for data in reference_data)
    block_count = sum(delta.size for delta in deltas)
    summary = {
        "changed_blocks": sum(plane["changed_blocks"] for plane in planes),
        "classification_flips": sum(plane["classification_flips"] for plane in planes),
        "flips_to_complex": sum(plane["flips_to_complex"] for plane in planes),
        "flips_to_non_complex": sum(plane["flips_to_non_complex"] for plane in planes),
        "mean_complexity_delta": sum(float(delta.sum()) for delta in deltas) / block_count,
        "mean_absolute_complexity_delta": sum(float(np.abs(delta).sum()) for delta in deltas) / block_count,
        "capacity_bits_delta": suspect_capacity - reference_capacity,
        "capacity_bytes_floor_delta": suspect_capacity // 8 - reference_capacity // 8,
    }
    return {"summary": summary, "planes": planes}


def analyse(
    suspect: CarrierAnalysis,
    reference: CarrierAnalysis | None,
    config: BPCSConfig,
) -> dict[str, object]:
    if suspect.cover.kind != "image":
        return {
            "supported": False,
            "reason": "BPCS analysis is available only for image inputs.",
            "config": config.as_dict(),
            "image": None,
            "planes": [],
            "summary": None,
            "comparison": None,
        }

    all_data = [
        _plane_data(suspect, config, bit)
        for bit in range(config.bit_plane_start, config.bit_plane_end + 1)
    ]
    return {
        "supported": True,
        "reason": None,
        "config": config.as_dict(),
        "image": {"width": suspect.cover.width, "height": suspect.cover.height},
        "planes": [
            _plane_result(data, bit)
            for bit, data in zip(range(config.bit_plane_start, config.bit_plane_end + 1), all_data)
        ],
        "summary": _summary(all_data),
        "comparison": _comparison(all_data, reference, config) if reference is not None else None,
    }
