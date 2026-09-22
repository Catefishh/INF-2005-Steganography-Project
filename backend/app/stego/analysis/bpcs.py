"""Bit-plane complexity segmentation (BPCS) analysis."""

import math
from dataclasses import dataclass

import numpy as np

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
