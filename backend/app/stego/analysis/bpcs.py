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
    padded = np.zeros((block_rows * block_size, block_columns * block_size), dtype=plane.dtype)
    padded[:height, :width] = plane
    blocks = padded.reshape(block_rows, block_size, block_columns, block_size).transpose(0, 2, 1, 3)

    row_sizes = np.minimum(block_size, height - np.arange(block_rows) * block_size)
    column_sizes = np.minimum(block_size, width - np.arange(block_columns) * block_size)
    valid_rows = np.arange(block_size)[None, :] < row_sizes[:, None]
    valid_columns = np.arange(block_size)[None, :] < column_sizes[:, None]
    valid_horizontal_pairs = np.arange(1, block_size)[None, :] < column_sizes[:, None]
    valid_vertical_pairs = np.arange(1, block_size)[None, :] < row_sizes[:, None]

    horizontal = (
        (blocks[:, :, :, 1:] != blocks[:, :, :, :-1])
        & valid_rows[:, None, :, None]
        & valid_horizontal_pairs[None, :, None, :]
    ).sum(axis=(2, 3), dtype=np.int64)
    vertical = (
        (blocks[:, :, 1:, :] != blocks[:, :, :-1, :])
        & valid_vertical_pairs[:, None, :, None]
        & valid_columns[None, :, None, :]
    ).sum(axis=(2, 3), dtype=np.int64)
    transitions = horizontal + vertical
    possible = (
        row_sizes[:, None] * np.maximum(column_sizes - 1, 0)[None, :]
        + np.maximum(row_sizes - 1, 0)[:, None] * column_sizes[None, :]
    ).astype(np.int64)
    complexities = np.divide(
        transitions,
        possible,
        out=np.zeros((block_rows, block_columns), dtype=np.float64),
        where=possible != 0,
    )
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


def _plane_data(
    context: CarrierAnalysis,
    config: BPCSConfig,
    bit: int,
    valid_pixels: np.ndarray,
) -> dict[str, object]:
    plane = context.bit_plane(config.channel, bit)
    complexities, transitions, possible = block_complexities(plane, config.block_size)
    classifications = complexities >= config.complexity_threshold
    return {
        "plane": plane,
        "complexities": complexities,
        "classifications": classifications,
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


def _summary(parts: list[dict[str, object]]) -> dict[str, int | float]:
    block_count = sum(part["metrics"]["block_count"] for part in parts)
    complex_blocks = sum(part["metrics"]["complex_blocks"] for part in parts)
    transition_count = sum(part["metrics"]["transition_count"] for part in parts)
    possible_transition_count = sum(part["metrics"]["possible_transition_count"] for part in parts)
    capacity_bits = sum(part["metrics"]["capacity_bits"] for part in parts)
    complexity_sum = sum(part["complexity_sum"] for part in parts)
    return {
        "selected_plane_count": len(parts),
        "block_count": block_count,
        "complex_blocks": complex_blocks,
        "non_complex_blocks": block_count - complex_blocks,
        "complex_percent": complex_blocks * 100.0 / block_count,
        "transition_count": transition_count,
        "possible_transition_count": possible_transition_count,
        "transition_ratio": transition_count / possible_transition_count if possible_transition_count else 0.0,
        "mean_complexity": complexity_sum / block_count,
        "minimum_complexity": min(part["minimum_complexity"] for part in parts),
        "maximum_complexity": max(part["maximum_complexity"] for part in parts),
        "capacity_bits": capacity_bits,
        "capacity_bytes_floor": capacity_bits // 8,
        "capacity_remainder_bits": capacity_bits % 8,
    }


def _changed_blocks(suspect: np.ndarray, reference: np.ndarray, block_size: int) -> np.ndarray:
    height, width = suspect.shape
    block_rows = math.ceil(height / block_size)
    block_columns = math.ceil(width / block_size)
    padded = np.zeros((block_rows * block_size, block_columns * block_size), dtype=bool)
    padded[:height, :width] = suspect != reference
    blocks = padded.reshape(block_rows, block_size, block_columns, block_size).transpose(0, 2, 1, 3)
    return blocks.any(axis=(2, 3))


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


def _comparison_summary(
    planes: list[dict[str, int | float]],
    parts: list[dict[str, int | float]],
) -> dict[str, int | float]:
    block_count = sum(part["block_count"] for part in parts)
    suspect_capacity = sum(part["suspect_capacity"] for part in parts)
    reference_capacity = sum(part["reference_capacity"] for part in parts)
    summary = {
        "changed_blocks": sum(plane["changed_blocks"] for plane in planes),
        "classification_flips": sum(plane["classification_flips"] for plane in planes),
        "flips_to_complex": sum(plane["flips_to_complex"] for plane in planes),
        "flips_to_non_complex": sum(plane["flips_to_non_complex"] for plane in planes),
        "mean_complexity_delta": sum(part["complexity_delta_sum"] for part in parts) / block_count,
        "mean_absolute_complexity_delta": sum(part["absolute_complexity_delta_sum"] for part in parts) / block_count,
        "capacity_bits_delta": suspect_capacity - reference_capacity,
        "capacity_bytes_floor_delta": suspect_capacity // 8 - reference_capacity // 8,
    }
    return summary


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

    valid_pixels = _valid_pixel_counts(suspect.cover.height, suspect.cover.width, config.block_size)
    plane_results = []
    summary_parts = []
    comparison_planes = []
    comparison_parts = []
    for bit in range(config.bit_plane_start, config.bit_plane_end + 1):
        suspect_data = _plane_data(suspect, config, bit, valid_pixels)
        plane_results.append(_plane_result(suspect_data, bit))
        summary_parts.append({
            "metrics": suspect_data["metrics"],
            "complexity_sum": float(suspect_data["complexities"].sum()),
            "minimum_complexity": suspect_data["metrics"]["minimum_complexity"],
            "maximum_complexity": suspect_data["metrics"]["maximum_complexity"],
        })
        if reference is not None:
            reference_data = _plane_data(reference, config, bit, valid_pixels)
            comparison_metrics, deltas = _comparison_metrics(suspect_data, reference_data, config)
            comparison_planes.append({"bit_plane": bit, **comparison_metrics})
            comparison_parts.append({
                "block_count": int(deltas.size),
                "complexity_delta_sum": float(deltas.sum()),
                "absolute_complexity_delta_sum": float(np.abs(deltas).sum()),
                "suspect_capacity": suspect_data["metrics"]["capacity_bits"],
                "reference_capacity": reference_data["metrics"]["capacity_bits"],
            })
            del reference_data, deltas
        del suspect_data

    comparison = None
    if reference is not None:
        comparison = {
            "summary": _comparison_summary(comparison_planes, comparison_parts),
            "planes": comparison_planes,
        }
    return {
        "supported": True,
        "reason": None,
        "config": config.as_dict(),
        "image": {"width": suspect.cover.width, "height": suspect.cover.height},
        "planes": plane_results,
        "summary": _summary(summary_parts),
        "comparison": comparison,
    }
