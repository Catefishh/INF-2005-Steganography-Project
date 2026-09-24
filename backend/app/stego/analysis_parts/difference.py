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
        full_delta = np.abs(cover.rgb.astype(np.int16) - other.rgb.astype(np.int16))
        intensity = full_delta.max(axis=2).astype(np.uint8)
        if stride > 1:
            height = math.ceil(cover.height / stride) * stride
            width = math.ceil(cover.width / stride) * stride
            padded_delta = np.pad(full_delta, ((0, height - cover.height), (0, width - cover.width), (0, 0)))
            image_delta = padded_delta.reshape(height // stride, stride, width // stride, stride, 3).max(axis=(1, 3))
            intensity = image_delta.max(axis=2).astype(np.uint8)
        else:
            image_delta = full_delta
        mask = np.any(cover.rgb != other.rgb, axis=2)
        if stride > 1:
            height = math.ceil(cover.height / stride) * stride
            width = math.ceil(cover.width / stride) * stride
            padded = np.pad(mask, ((0, height - cover.height), (0, width - cover.width)))
            mask = padded.reshape(height // stride, stride, width // stride, stride).any(axis=(1, 3))
        result["changed_map"] = png_data_url(mask.astype(np.uint8) * 255)
        result["amplified"] = png_data_url(np.clip(image_delta * 64, 0, 255).astype(np.uint8))
        heatmap = np.zeros((*intensity.shape, 3), dtype=np.uint8)
        heatmap[:, :, 0] = np.clip(intensity.astype(np.int16) * 64, 0, 255).astype(np.uint8)
        heatmap[:, :, 1] = np.clip(intensity.astype(np.int16) * 16, 0, 255).astype(np.uint8)
        result["heatmap"] = png_data_url(heatmap)
        result["original_preview"] = png_data_url(cover.rgb[::stride, ::stride])
        result["stego_preview"] = png_data_url(other.rgb[::stride, ::stride])
    else:
        mask, _ = square(changed.astype(np.uint8) * 255)
        result["changed_map"] = png_data_url(mask)
        result["amplified"] = None
        frames = len(delta) // cover.channels
        if frames:
            sample_delta = np.abs(delta[:frames * cover.channels]).reshape(frames, cover.channels)
            width = min(512, frames)
            stride = math.ceil(frames / width)
            padded = np.pad(sample_delta, ((0, width * stride - frames), (0, 0)))
            strength = padded.reshape(width, stride, cover.channels).max(axis=1).T
            strip = np.zeros((cover.channels * 12, width, 3), dtype=np.uint8)
            light = np.clip(strength * 64, 0, 255).astype(np.uint8)
            for channel in range(cover.channels):
                strip[channel * 12:(channel + 1) * 12, :, 0] = light[channel]
                strip[channel * 12:(channel + 1) * 12, :, 1] = light[channel] // 3
            result["audio_change_strip"] = png_data_url(strip)
            result["audio_change_note"] = "Horizontal position is time; each row is a channel. Intensity shows low-byte embedding-slot changes, amplified 64×."
    return result
