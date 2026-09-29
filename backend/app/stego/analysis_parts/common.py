"""Shared bounded image previews and channel extraction."""
import math

from ..analysis.common import PREVIEW_SIDE, png_data_url, square_preview as square


def sequence(cover, channel):
    return cover.rgb[:, :, channel] if cover.kind == "image" else cover.slots[channel::cover.channels]


def grid(cover, channel):
    if cover.kind == "image":
        stride = max(1, math.ceil(max(cover.width, cover.height) / PREVIEW_SIDE))
        return cover.rgb[::stride, ::stride, channel], stride
    return square(sequence(cover, channel))
