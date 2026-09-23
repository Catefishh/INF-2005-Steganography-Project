"""Bit-plane and LSB composite previews."""

import numpy as np

from .common import CarrierAnalysis, png_data_url


def analyse(context: CarrierAnalysis, channel: int) -> dict[str, object]:
    grid, stride = context.preview_grid(channel)
    planes = [png_data_url((((grid >> bit) & 1) * 255).astype(np.uint8)) for bit in range(8)]
    composite = None
    if context.cover.kind == "image":
        composite = png_data_url(((context.cover.rgb[::stride, ::stride] & 1) * 255).astype(np.uint8))
    return {"stride": stride, "bit_planes": planes, "lsb_composite": composite}
