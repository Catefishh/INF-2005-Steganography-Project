"""Shared bounded image previews and channel extraction."""
import base64
import io
import math

import numpy as np
from PIL import Image

PREVIEW_SIDE = 512


def png_data_url(array):
    out = io.BytesIO()
    Image.fromarray(array).save(out, format="PNG")
    return "data:image/png;base64," + base64.b64encode(out.getvalue()).decode("ascii")


def square(values):
    stride = max(1, math.ceil(len(values) / (PREVIEW_SIDE * PREVIEW_SIDE)))
    sample = values[::stride]
    side = max(1, math.ceil(math.sqrt(len(sample))))
    grid = np.zeros(side * side, dtype=np.uint8)
    grid[:len(sample)] = sample
    return grid.reshape(side, side), stride


def sequence(cover, channel):
    return cover.rgb[:, :, channel] if cover.kind == "image" else cover.slots[channel::cover.channels]


def grid(cover, channel):
    if cover.kind == "image":
        stride = max(1, math.ceil(max(cover.width, cover.height) / PREVIEW_SIDE))
        return cover.rgb[::stride, ::stride, channel], stride
    return square(sequence(cover, channel))
