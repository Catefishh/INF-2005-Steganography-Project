"""Shared carrier context and bounded PNG preview helpers."""

import base64
import io
import math
from dataclasses import dataclass, field

import numpy as np
from PIL import Image

from ..covers import AudioCover, ImageCover, load_cover

PREVIEW_SIDE = 512
COMPARISON_ERROR = "The two files must be the same kind and size to compare (e.g. cover vs its stego)."


def png_data_url(array: np.ndarray) -> str:
    out = io.BytesIO()
    Image.fromarray(array).save(out, format="PNG")
    return "data:image/png;base64," + base64.b64encode(out.getvalue()).decode("ascii")


def square_preview(values: np.ndarray) -> tuple[np.ndarray, int]:
    """Lay a sequence out as a square image bounded by PREVIEW_SIDE."""
    stride = max(1, math.ceil(len(values) / (PREVIEW_SIDE * PREVIEW_SIDE)))
    sample = values[::stride]
    side = max(1, math.ceil(math.sqrt(len(sample))))
    grid = np.zeros(side * side, dtype=np.uint8)
    grid[:len(sample)] = sample
    return grid.reshape(side, side), stride


@dataclass(slots=True)
class CarrierAnalysis:
    cover: ImageCover | AudioCover
    channel_names: tuple[str, ...] = field(init=False)
    _sequences: dict[int, np.ndarray] = field(default_factory=dict, init=False)
    _planes: dict[tuple[int, int], np.ndarray] = field(default_factory=dict, init=False)

    def __post_init__(self) -> None:
        if self.cover.kind == "image":
            self.channel_names = ("Red", "Green", "Blue")
        else:
            self.channel_names = tuple(f"Channel {index + 1}" for index in range(self.cover.channels))

    @property
    def channel_count(self) -> int:
        return 3 if self.cover.kind == "image" else self.cover.channels

    def validate_channel(self, channel: int) -> None:
        if not 0 <= channel < self.channel_count:
            raise ValueError("Channel is out of range for this file.")

    def sequence(self, channel: int) -> np.ndarray:
        self.validate_channel(channel)
        if channel not in self._sequences:
            if self.cover.kind == "image":
                values = self.cover.rgb[:, :, channel]
            else:
                values = self.cover.slots[channel::self.cover.channels]
            self._sequences[channel] = np.ascontiguousarray(values).reshape(-1)
        return self._sequences[channel]

    def image_channel(self, channel: int) -> np.ndarray:
        self.validate_channel(channel)
        if self.cover.kind != "image":
            raise ValueError("Image channel data is available only for image inputs.")
        return self.cover.rgb[:, :, channel]

    def bit_plane(self, channel: int, bit: int) -> np.ndarray:
        key = (channel, bit)
        if key not in self._planes:
            values = self.image_channel(channel) if self.cover.kind == "image" else self.sequence(channel)
            self._planes[key] = np.ascontiguousarray((values >> bit) & 1).astype(np.uint8, copy=False)
        return self._planes[key]

    def preview_grid(self, channel: int) -> tuple[np.ndarray, int]:
        if self.cover.kind == "image":
            stride = max(1, math.ceil(max(self.cover.width, self.cover.height) / PREVIEW_SIDE))
            return self.image_channel(channel)[::stride, ::stride], stride
        return square_preview(self.sequence(channel))


@dataclass(slots=True)
class AnalysisInputs:
    suspect: CarrierAnalysis
    reference: CarrierAnalysis | None


def prepare_inputs(data: bytes, compare_data: bytes | None) -> AnalysisInputs:
    suspect_cover = load_cover(data)
    reference_cover = load_cover(compare_data) if compare_data else None
    if reference_cover is not None:
        same_size = reference_cover.n_slots == suspect_cover.n_slots
        same_format = reference_cover.kind == suspect_cover.kind
        if suspect_cover.kind == "image" and reference_cover.kind == "image":
            same_size = same_size and (reference_cover.width, reference_cover.height) == (
                suspect_cover.width,
                suspect_cover.height,
            )
            same_format = reference_cover.mode == suspect_cover.mode
        elif suspect_cover.kind == "audio" and reference_cover.kind == "audio":
            same_format = (
                reference_cover.channels,
                reference_cover.bits,
                reference_cover.sample_rate,
                reference_cover.frames,
            ) == (
                suspect_cover.channels,
                suspect_cover.bits,
                suspect_cover.sample_rate,
                suspect_cover.frames,
            )
        if not same_size or not same_format:
            raise ValueError(COMPARISON_ERROR)
    return AnalysisInputs(
        suspect=CarrierAnalysis(suspect_cover),
        reference=CarrierAnalysis(reference_cover) if reference_cover is not None else None,
    )
