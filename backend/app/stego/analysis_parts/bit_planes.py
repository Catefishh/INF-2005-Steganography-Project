"""Eight visual bit planes and a bounded RGB LSB composite."""
import numpy as np

from .common import png_data_url


def render(cover, grid, stride):
    planes = [png_data_url((((grid >> bit) & 1) * 255).astype(np.uint8)) for bit in range(8)]
    composite = None
    if cover.kind == "image":
        composite = png_data_url(((cover.rgb[::stride, ::stride] & 1) * 255).astype(np.uint8))
    return planes, composite
