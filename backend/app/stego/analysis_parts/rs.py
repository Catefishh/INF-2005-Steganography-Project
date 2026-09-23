"""Fridrich-Goljan-Du regular/singular analysis for one 8-bit image channel."""
import math

import numpy as np


def _counts(groups: np.ndarray, negative: bool) -> dict[str, int]:
    base = np.abs(np.diff(groups, axis=1)).sum(axis=1)
    flipped = groups.copy()
    selected = flipped[:, 1:3]
    flipped[:, 1:3] = ((selected + 1) ^ 1) - 1 if negative else selected ^ 1
    after = np.abs(np.diff(flipped, axis=1)).sum(axis=1)
    return {"regular": int(np.count_nonzero(after > base)),
            "singular": int(np.count_nonzero(after < base)),
            "unchanged": int(np.count_nonzero(after == base))}


def analyse(channel: np.ndarray) -> dict:
    pixels = np.asarray(channel, dtype=np.uint8)
    if pixels.ndim != 2:
        raise ValueError("RS analysis requires one image channel")
    groups = pixels[:, :pixels.shape[1] // 4 * 4].reshape(-1, 4).astype(np.int16)
    n = len(groups)
    empty = {"regular": 0, "singular": 0, "unchanged": 0}
    if not n:
        return {"groups": 0, "positive": empty, "negative": empty,
                "flipped_positive": empty, "flipped_negative": empty,
                "estimated_rate": None, "reason": "Image width has no complete groups of four pixels."}
    pos, neg = _counts(groups, False), _counts(groups, True)
    inverted = groups ^ 1
    fpos, fneg = _counts(inverted, False), _counts(inverted, True)
    d0 = pos["regular"] - pos["singular"]
    d1 = fpos["regular"] - fpos["singular"]
    dm0 = neg["regular"] - neg["singular"]
    dm1 = fneg["regular"] - fneg["singular"]
    a, b, c = 2 * (d1 + d0), dm0 - dm1 - d1 - 3 * d0, d0 - dm0
    roots = []
    if a == 0:
        if b:
            roots = [-c / b]
    else:
        discriminant = b * b - 4 * a * c
        if discriminant >= 0:
            roots = [(-b + math.sqrt(discriminant)) / (2 * a),
                     (-b - math.sqrt(discriminant)) / (2 * a)]
    rate = None
    reason = None
    if n < 256:
        reason = "Too few groups for a useful RS estimate."
    elif not roots:
        reason = "RS curves do not have a real, stable intersection."
    else:
        root = min(roots, key=abs)
        if abs(root - 0.5) > 1e-9:
            candidate = root / (root - 0.5)
            if math.isfinite(candidate) and 0 <= candidate <= 1:
                rate = candidate
        if rate is None:
            reason = "RS estimate is outside the physical 0–100% range."
    return {"groups": n, "positive": pos, "negative": neg,
            "flipped_positive": fpos, "flipped_negative": fneg,
            "estimated_rate": rate, "reason": reason,
            "method": "Fridrich-Goljan-Du RS, horizontal groups of 4, mask [0,1,1,0]"}
