"""Steganalysis (lecture: Visual, Statistical).

* Bit planes      - split one colour channel into its 8 bit planes (lecture
                    "Grayscale Bit Planes"). Natural images show structure in the
                    high planes and noise in the low planes; hidden data turns a
                    region of the low planes into uniform noise.
* Histogram       - pixel value counts per channel (lecture "Statistical
                    Steganalysis"). LSB replacement pulls each pair of values
                    (2i, 2i+1) towards the same count, giving a "comb" look.
* Chi-square test - Westfeld & Pfitzmann's pairs-of-values test. For every
                    pair, expected = (h[2i] + h[2i+1]) / 2 and observed = h[2i].
                    p close to 1 means the pairs are equalised, i.e. the LSBs look
                    like random embedded data.
* Difference      - compare cover and stego (lecture "difference image").
"""

import base64
import io
import math

import numpy as np
from PIL import Image

from .covers import load_cover

PREVIEW_SIDE = 512
SEGMENTS = 64


def _png_data_url(array):
    out = io.BytesIO()
    Image.fromarray(array).save(out, format="PNG")
    return "data:image/png;base64," + base64.b64encode(out.getvalue()).decode("ascii")


def gamma_q(a, x):
    """Regularised upper incomplete gamma Q(a, x) (Numerical Recipes gser / gcf)."""
    if x <= 0:
        return 1.0
    log_front = -x + a * math.log(x) - math.lgamma(a)
    if x < a + 1:  # series for P(a, x), then Q = 1 - P
        term = total = 1.0 / a
        ap = a
        for _ in range(10_000):
            ap += 1
            term *= x / ap
            total += term
            if abs(term) < abs(total) * 1e-15:
                break
        return max(0.0, 1.0 - total * math.exp(log_front))
    tiny = 1e-300  # continued fraction for Q(a, x), modified Lentz method
    b = x + 1 - a
    c = 1 / tiny
    d = 1 / b
    h = d
    for i in range(1, 10_000):
        an = -i * (i - a)
        b += 2
        d = an * d + b
        d = tiny if abs(d) < tiny else d
        c = b + an / c
        c = tiny if abs(c) < tiny else c
        d = 1 / d
        delta = d * c
        h *= delta
        if abs(delta - 1) < 1e-15:
            break
    return min(1.0, math.exp(log_front) * h)


def chi_square_p(values):
    """Probability that `values` (uint8) carry LSB-embedded data (Westfeld-Pfitzmann)."""
    histogram = np.bincount(values, minlength=256).astype(np.float64)
    observed = histogram[0::2]
    expected = (histogram[0::2] + histogram[1::2]) / 2
    use = expected >= 5  # the chi-square approximation needs enough samples per category
    categories = int(use.sum())
    if categories < 2:
        return None
    chi2 = float((((observed[use] - expected[use]) ** 2) / expected[use]).sum())
    return gamma_q((categories - 1) / 2, chi2 / 2)


def chi_square_segments(values, segments=SEGMENTS):
    edges = np.linspace(0, len(values), segments + 1).astype(np.int64)
    return [chi_square_p(values[edges[i]:edges[i + 1]]) for i in range(segments)]


def _square(values):
    """Lay a 1-D array out as a square image (subsampled to at most 512 x 512)."""
    stride = max(1, math.ceil(len(values) / (PREVIEW_SIDE * PREVIEW_SIDE)))
    sample = values[::stride]
    side = max(1, math.ceil(math.sqrt(len(sample))))
    grid = np.zeros(side * side, dtype=np.uint8)
    grid[:len(sample)] = sample
    return grid.reshape(side, side), stride


def _sequence(cover, channel):
    if cover.kind == "image":
        return cover.rgb[:, :, channel]
    return cover.slots[channel::cover.channels]


def _grid(cover, channel):
    if cover.kind == "image":
        stride = max(1, math.ceil(max(cover.width, cover.height) / PREVIEW_SIDE))
        return cover.rgb[::stride, ::stride, channel], stride
    return _square(_sequence(cover, channel))


def analyse(data, compare_data=None, channel=0):
    cover = load_cover(data)
    channel_count = 3 if cover.kind == "image" else cover.channels
    if not 0 <= channel < channel_count:
        raise ValueError("Channel is out of range for this file.")

    grid, stride = _grid(cover, channel)
    planes = [_png_data_url((((grid >> bit) & 1) * 255).astype(np.uint8)) for bit in range(8)]
    values = np.ascontiguousarray(_sequence(cover, channel)).reshape(-1)

    result = {
        "info": cover.info(),
        "channel": channel,
        "channel_names": ["Red", "Green", "Blue"] if cover.kind == "image" else
                         [f"Channel {i + 1}" for i in range(channel_count)],
        "stride": stride,
        "bit_planes": planes,  # index 0 = LSB (bit 0), index 7 = MSB (bit 7)
        "chi_square": chi_square_segments(values),
        "chi_square_overall": chi_square_p(values),
        "histograms": ([np.bincount(cover.rgb[:, :, c].reshape(-1), minlength=256).tolist() for c in range(3)]
                       if cover.kind == "image" else [np.bincount(values, minlength=256).tolist()]),
        "lsb_composite": None,
        "compare": None,
    }
    if cover.kind == "image":
        s = stride
        result["lsb_composite"] = _png_data_url(((cover.rgb[::s, ::s] & 1) * 255).astype(np.uint8))

    if compare_data:
        other = load_cover(compare_data)
        if other.kind != cover.kind or other.n_slots != cover.n_slots or \
                (cover.kind == "image" and (other.width, other.height) != (cover.width, cover.height)):
            raise ValueError("The two files must be the same kind and size to compare (e.g. cover vs its stego).")
        changed_slots = cover.slots != other.slots
        xor = cover.slots ^ other.slots
        table = np.array([bin(i).count("1") for i in range(256)], dtype=np.uint8)
        diff = cover.slots.astype(np.int32) - other.slots.astype(np.int32)
        mse = float(np.mean(diff * diff))
        peak = 255 if cover.kind == "image" else (1 << cover.bits) - 1
        compare = {
            "slots_changed": int(changed_slots.sum()),
            "bits_changed": int(table[xor].sum(dtype=np.int64)),
            "max_difference": int(np.abs(diff).max()) if len(diff) else 0,
            "psnr_db": None if mse == 0 else 10 * math.log10(peak * peak / mse),
            "mse": mse,
        }
        if cover.kind == "image":
            s = stride
            delta = np.abs(cover.rgb[::s, ::s].astype(np.int16) - other.rgb[::s, ::s].astype(np.int16))
            compare["changed_map"] = _png_data_url((delta.max(axis=2) > 0).astype(np.uint8) * 255)
            compare["amplified"] = _png_data_url(np.clip(delta * 64, 0, 255).astype(np.uint8))
        else:
            mask, _ = _square(changed_slots.astype(np.uint8) * 255)
            compare["changed_map"] = _png_data_url(mask)
            compare["amplified"] = None
        result["compare"] = compare
    return result
