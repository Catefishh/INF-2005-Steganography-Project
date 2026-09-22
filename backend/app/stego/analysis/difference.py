"""Descriptive suspect/reference differences."""

import math

import numpy as np

from .common import CarrierAnalysis, png_data_url, square_preview

POPCOUNT = np.array([bin(value).count("1") for value in range(256)], dtype=np.uint8)


def analyse(
    suspect: CarrierAnalysis,
    reference: CarrierAnalysis | None,
    preview_stride: int,
) -> dict[str, object] | None:
    if reference is None:
        return None

    changed_slots = suspect.cover.slots != reference.cover.slots
    xor = suspect.cover.slots ^ reference.cover.slots
    difference = suspect.cover.slots.astype(np.int32) - reference.cover.slots.astype(np.int32)
    mse = float(np.mean(difference * difference))
    peak = 255 if suspect.cover.kind == "image" else (1 << suspect.cover.bits) - 1
    result = {
        "slots_changed": int(changed_slots.sum()),
        "bits_changed": int(POPCOUNT[xor].sum(dtype=np.int64)),
        "max_difference": int(np.abs(difference).max()) if len(difference) else 0,
        "psnr_db": None if mse == 0 else 10 * math.log10(peak * peak / mse),
        "mse": mse,
    }
    if suspect.cover.kind == "image":
        delta = np.abs(
            suspect.cover.rgb[::preview_stride, ::preview_stride].astype(np.int16)
            - reference.cover.rgb[::preview_stride, ::preview_stride].astype(np.int16)
        )
        result["changed_map"] = png_data_url((delta.max(axis=2) > 0).astype(np.uint8) * 255)
        result["amplified"] = png_data_url(np.clip(delta * 64, 0, 255).astype(np.uint8))
    else:
        mask, _ = square_preview(changed_slots.astype(np.uint8) * 255)
        result["changed_map"] = png_data_url(mask)
        result["amplified"] = None
    return result
