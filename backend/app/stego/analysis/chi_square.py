"""Westfeld-Pfitzmann pairs-of-values Chi-Square analysis."""

import math

import numpy as np

SEGMENTS = 64


def gamma_q(a, x):
    """Regularised upper incomplete gamma Q(a, x) (Numerical Recipes gser / gcf)."""
    if x <= 0:
        return 1.0
    log_front = -x + a * math.log(x) - math.lgamma(a)
    if x < a + 1:
        term = total = 1.0 / a
        ap = a
        for _ in range(10_000):
            ap += 1
            term *= x / ap
            total += term
            if abs(term) < abs(total) * 1e-15:
                break
        return max(0.0, 1.0 - total * math.exp(log_front))
    tiny = 1e-300
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
    histogram = np.bincount(values, minlength=256).astype(np.float64)
    observed = histogram[0::2]
    expected = (histogram[0::2] + histogram[1::2]) / 2
    use = expected >= 5
    categories = int(use.sum())
    if categories < 2:
        return None
    chi2 = float((((observed[use] - expected[use]) ** 2) / expected[use]).sum())
    return gamma_q((categories - 1) / 2, chi2 / 2)


def chi_square_segments(values, segments=SEGMENTS):
    edges = np.linspace(0, len(values), segments + 1).astype(np.int64)
    return [chi_square_p(values[edges[index]:edges[index + 1]]) for index in range(segments)]
