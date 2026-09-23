"""Channel value histograms."""

import numpy as np

from .common import CarrierAnalysis


def analyse(context: CarrierAnalysis, channel: int) -> list[list[int]]:
    channels = range(3) if context.cover.kind == "image" else (channel,)
    return [np.bincount(context.sequence(index), minlength=256).tolist() for index in channels]
