"""Westfeld-Pfitzmann pairs-of-values evidence with validity metadata."""
from __future__ import annotations

import math
import numpy as np


def details(values: np.ndarray, survival_fn) -> dict:
    histogram = np.bincount(values, minlength=256).astype(np.float64)
    observed = histogram[0::2]
    expected = (observed + histogram[1::2]) / 2
    valid = expected >= 5
    categories = int(valid.sum())
    statistic = float((((observed[valid] - expected[valid]) ** 2) / expected[valid]).sum()) if categories else 0.0
    p_value = survival_fn((categories - 1) / 2, statistic / 2) if categories >= 2 else None
    return {"sample_count": int(values.size), "valid_categories": categories,
            "excluded_categories": 128 - categories, "statistic": statistic if categories >= 2 else None,
            "p_value": p_value, "interpretable": categories >= 2,
            "reason": "too few value pairs meet the expected-count assumption" if categories < 2 else "",
            "threshold": 0.95, "threshold_kind": "presentation heuristic, not a universal detector"}

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


