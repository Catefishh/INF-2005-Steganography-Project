"""Exact cover/stego slot differences and bounded preview maps."""
import math

import numpy as np

from .common import png_data_url, square
from .quality import ssim

POPCOUNT = np.array([int(i).bit_count() for i in range(256)], dtype=np.uint8)


def compare(cover, other, stride):
    if other.kind != cover.kind or other.n_slots != cover.n_slots or (
        cover.kind == "image" and (other.width, other.height) != (cover.width, cover.height)
    ):
        raise ValueError("The two files must be the same kind and size to compare (e.g. cover vs its stego).")
    changed = cover.slots != other.slots
    delta = cover.slots.astype(np.int32) - other.slots.astype(np.int32)
    mse = float(np.mean(delta * delta))
    peak = 255 if cover.kind == "image" else (1 << cover.bits) - 1
    result = {
        "slots_changed": int(changed.sum()),
        "bits_changed": int(POPCOUNT[cover.slots ^ other.slots].sum(dtype=np.int64)),
        "max_difference": int(np.abs(delta).max()) if len(delta) else 0,
        "psnr_db": None if mse == 0 else 10 * math.log10(peak * peak / mse),
        "mse": mse,
    }
    if cover.kind == "image":
        result["pixels_changed"] = int(np.count_nonzero(np.any(cover.rgb != other.rgb, axis=2)))
        result["ssim"] = ssim(cover.rgb, other.rgb)
        image_delta = np.abs(cover.rgb[::stride, ::stride].astype(np.int16) -
                             other.rgb[::stride, ::stride].astype(np.int16))
        mask = np.any(cover.rgb != other.rgb, axis=2)
        if stride > 1:
            height = math.ceil(cover.height / stride) * stride
            width = math.ceil(cover.width / stride) * stride
            padded = np.pad(mask, ((0, height - cover.height), (0, width - cover.width)))
            mask = padded.reshape(height // stride, stride, width // stride, stride).any(axis=(1, 3))
        result["changed_map"] = png_data_url(mask.astype(np.uint8) * 255)
        result["amplified"] = png_data_url(np.clip(image_delta * 64, 0, 255).astype(np.uint8))
        result["original_preview"] = png_data_url(cover.rgb[::stride, ::stride])
        result["stego_preview"] = png_data_url(other.rgb[::stride, ::stride])
    else:
        mask, _ = square(changed.astype(np.uint8) * 255)
        result["changed_map"] = png_data_url(mask)
        result["amplified"] = None
    return result
