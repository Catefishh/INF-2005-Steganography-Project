"""256-bin value histograms for a selected carrier channel."""
import numpy as np


def compute(cover, values):
    if cover.kind == "image":
        return [np.bincount(cover.rgb[:, :, channel].reshape(-1), minlength=256).tolist()
                for channel in range(3)]
    return [np.bincount(values, minlength=256).tolist()]
