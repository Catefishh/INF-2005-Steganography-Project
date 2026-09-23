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

import math
import time

import numpy as np

from .covers import load_cover
from .analysis_parts import bpcs, bit_planes, difference, histogram, rs
from .analysis_parts.common import grid as preview_grid, sequence
from .analysis_parts.chi_square import details as chi_details

SEGMENTS = 64


from .analysis_parts.chi_square import gamma_q

def chi_square_p(values):
    """Upper-tail pairs-of-values p-value; not a probability of embedding."""
    return chi_details(values, gamma_q)["p_value"]


def chi_square_segments(values, segments=SEGMENTS):
    edges = np.linspace(0, len(values), segments + 1).astype(np.int64)
    return [chi_square_p(values[edges[i]:edges[i + 1]]) for i in range(segments)]


def analyse(data, compare_data=None, channel=0, bpcs_block_size=bpcs.DEFAULT_BLOCK,
            bpcs_first_plane=bpcs.DEFAULT_FIRST, bpcs_last_plane=bpcs.DEFAULT_LAST,
            bpcs_threshold=bpcs.DEFAULT_THRESHOLD):
    started = time.perf_counter()
    bpcs.validate(bpcs_block_size, bpcs_first_plane, bpcs_last_plane, bpcs_threshold)
    cover = load_cover(data)
    channel_count = 3 if cover.kind == "image" else cover.channels
    if not 0 <= channel < channel_count:
        raise ValueError("Channel is out of range for this file.")

    bit_started = time.perf_counter()
    grid, stride = preview_grid(cover, channel)
    planes, composite = bit_planes.render(cover, grid, stride)
    bit_ms = round((time.perf_counter() - bit_started) * 1000, 3)
    values = np.ascontiguousarray(sequence(cover, channel)).reshape(-1)

    chi_started = time.perf_counter()
    edges = np.linspace(0, len(values), SEGMENTS + 1).astype(np.int64)
    segment_details = [chi_details(values[edges[i]:edges[i + 1]], gamma_q) for i in range(SEGMENTS)]
    overall_details = chi_details(values, gamma_q)
    chi_ms = round((time.perf_counter() - chi_started) * 1000, 3)
    histogram_started = time.perf_counter()
    histograms = histogram.compute(cover, values)
    histogram_ms = round((time.perf_counter() - histogram_started) * 1000, 3)
    result = {
        "info": cover.info(),
        "channel": channel,
        "channel_names": ["Red", "Green", "Blue"] if cover.kind == "image" else
                         [f"Channel {i + 1}" for i in range(channel_count)],
        "stride": stride,
        "bit_planes": planes,  # index 0 = LSB (bit 0), index 7 = MSB (bit 7)
        "chi_square": [part["p_value"] for part in segment_details],
        "chi_square_overall": overall_details["p_value"],
        "chi_square_details": {"overall": overall_details, "segments": segment_details,
                               "method": "Westfeld-Pfitzmann pairs of values (0,1) through (254,255)"},
        "histograms": histograms,
        "rs": rs.analyse(cover.rgb[:, :, channel]) if cover.kind == "image" else None,
        "lsb_composite": composite,
        "compare": None,
        "reference_bit_planes": None,
        "reference_histograms": None,
        "bpcs": None,
        "duration_ms": {},
    }
    other = None
    difference_ms = 0.0
    if compare_data:
        other = load_cover(compare_data)
        if other.kind != cover.kind or other.n_slots != cover.n_slots or (
            cover.kind == "image" and (other.width, other.height) != (cover.width, cover.height)
        ):
            raise ValueError("The two files must be the same kind and size to compare (e.g. cover vs its stego).")
        difference_started = time.perf_counter()
        result["compare"] = difference.compare(cover, other, stride)
        reference_grid, _ = preview_grid(other, channel)
        result["reference_bit_planes"] = bit_planes.render(other, reference_grid, stride)[0]
        result["reference_histograms"] = histogram.compute(other, np.ascontiguousarray(sequence(other, channel)).reshape(-1))
        difference_ms = round((time.perf_counter() - difference_started) * 1000, 3)
    bpcs_started = time.perf_counter()
    if cover.kind == "image":
        result["bpcs"] = bpcs.analyse(cover.rgb[:, :, channel], other.rgb[:, :, channel] if other is not None else None,
                                      block_size=bpcs_block_size, first_plane=bpcs_first_plane,
                                      last_plane=bpcs_last_plane, threshold=bpcs_threshold)
    else:
        result["bpcs"] = {"supported": False, "reason": "BPCS analysis applies to images only",
                          "configuration": {"block_size": bpcs_block_size, "first_plane": bpcs_first_plane,
                                            "last_plane": bpcs_last_plane, "threshold": bpcs_threshold}}
    result["duration_ms"] = {"bit_planes": bit_ms, "histogram": histogram_ms,
                             "chi_square": chi_ms, "difference": difference_ms,
                             "bpcs": round((time.perf_counter() - bpcs_started) * 1000, 3),
                             "total": round((time.perf_counter() - started) * 1000, 3)}
    return result
