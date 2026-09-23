"""Descriptive image-only bit-plane complexity segmentation."""
from __future__ import annotations

import io
import base64
import math

import numpy as np
from PIL import Image


DEFAULT_BLOCK = 16
DEFAULT_FIRST = 0
DEFAULT_LAST = 3
DEFAULT_THRESHOLD = 0.3
MAX_BLOCKS = 262_144


def validate(block_size: int, first_plane: int, last_plane: int, threshold: float) -> None:
    if type(block_size) is not int or block_size < 4 or block_size > 64:
        raise ValueError("BPCS block size must be 4 through 64 pixels")
    if type(first_plane) is not int or type(last_plane) is not int or not 0 <= first_plane <= last_plane <= 7:
        raise ValueError("BPCS bit-plane range must be inclusive within 0 through 7")
    if not isinstance(threshold, (int, float)) or not math.isfinite(threshold) or not 0 <= threshold <= 1:
        raise ValueError("BPCS complexity threshold must be between 0 and 1")


def _url(values: np.ndarray) -> str:
    out = io.BytesIO()
    Image.fromarray(values.astype(np.uint8)).save(out, format="PNG")
    return "data:image/png;base64," + base64.b64encode(out.getvalue()).decode("ascii")


def _plane(channel: np.ndarray, bit: int, block: int):
    pixels = ((channel >> bit) & 1).astype(np.uint8)
    height, width = pixels.shape
    rows, columns = math.ceil(height / block), math.ceil(width / block)
    if rows > 512 or columns > 512 or rows * columns > MAX_BLOCKS:
        raise ValueError("BPCS would exceed the response limit; choose a larger block")
    row_starts = np.arange(0, height, block)
    column_starts = np.arange(0, width, block)
    horizontal = np.zeros((height, width), dtype=np.uint8)
    vertical = np.zeros((height, width), dtype=np.uint8)
    horizontal[:, :-1] = pixels[:, :-1] != pixels[:, 1:]
    vertical[:-1, :] = pixels[:-1, :] != pixels[1:, :]
    horizontal[:, block - 1::block] = 0
    vertical[block - 1::block, :] = 0
    edges = horizontal.astype(np.int32) + vertical
    transitions = np.add.reduceat(np.add.reduceat(edges, row_starts, axis=0), column_starts, axis=1)
    heights = np.minimum(block, height - row_starts)
    widths = np.minimum(block, width - column_starts)
    pixels_per_block = heights[:, None] * widths[None, :]
    maximum = heights[:, None] * np.maximum(0, widths[None, :] - 1) + widths[None, :] * np.maximum(0, heights[:, None] - 1)
    complexity = np.divide(transitions, maximum, out=np.zeros_like(transitions, dtype=np.float32), where=maximum > 0)
    return complexity, pixels_per_block, transitions


def analyse(channel: np.ndarray, reference: np.ndarray | None, *, block_size: int = DEFAULT_BLOCK,
            first_plane: int = DEFAULT_FIRST, last_plane: int = DEFAULT_LAST,
            threshold: float = DEFAULT_THRESHOLD) -> dict:
    validate(block_size, first_plane, last_plane, threshold)
    if channel.ndim != 2 or channel.dtype != np.uint8:
        raise ValueError("BPCS requires an 8-bit image channel")
    if reference is not None and reference.shape != channel.shape:
        raise ValueError("BPCS comparison images must have matching dimensions")
    planes = []
    for bit in range(first_plane, last_plane + 1):
        complexity, pixels, transitions = _plane(channel, bit, block_size)
        complex_mask = complexity >= threshold
        total = complexity.size
        item = {
            "bit_plane": bit,
            "blocks": total,
            "complex_blocks": int(complex_mask.sum()),
            "non_complex_blocks": int(total - complex_mask.sum()),
            "complex_percent": float(complex_mask.mean() * 100),
            "mean_complexity": float(complexity.mean()),
            "transitions": int(transitions.sum()),
            "estimated_capacity_bits": int(pixels[complex_mask].sum()),
            "complexity_map": _url(np.rint(complexity * 255)),
            "classification_map": _url(complex_mask.astype(np.uint8) * 255),
            "comparison": None,
        }
        if reference is not None:
            baseline, baseline_pixels, _ = _plane(reference, bit, block_size)
            original_complex = baseline >= threshold
            item["comparison"] = {
                "mean_complexity_delta": float((complexity - baseline).mean()),
                "changed_blocks": int(np.count_nonzero(complexity != baseline)),
                "classification_flips": int(np.count_nonzero(complex_mask != original_complex)),
                "capacity_difference_bits": int(pixels[complex_mask].sum() - baseline_pixels[original_complex].sum()),
            }
        planes.append(item)
    return {
        "supported": True,
        "configuration": {"block_size": block_size, "first_plane": first_plane,
                          "last_plane": last_plane, "threshold": threshold},
        "dimensions": {"width": channel.shape[1], "height": channel.shape[0]},
        "edge_policy": "partial edge blocks use only their actual pixels and adjacent transitions",
        "planes": planes,
        "estimated_capacity_bits": sum(item["estimated_capacity_bits"] for item in planes),
    }
