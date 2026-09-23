"""Westfeld-Pfitzmann pairs-of-values Chi-Square analysis."""

import math

import numpy as np

SEGMENT_COUNT = 64
MIN_EXPECTED_COUNT = 5.0
PRESENTATION_HEURISTIC = 0.95
METHOD = "westfeld-pfitzmann-pairs-of-values"
LOW_COUNT_REASON = "At least two value pairs with expected count >= 5 are required."


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


def measure(values: np.ndarray) -> dict[str, object]:
    histogram = np.bincount(values, minlength=256).astype(np.float64)
    observed = histogram[0::2]
    expected = (histogram[0::2] + histogram[1::2]) / 2
    use = expected >= MIN_EXPECTED_COUNT
    categories = int(use.sum())
    if categories < 2:
        return {
            "sample_count": int(len(values)),
            "valid_category_count": categories,
            "degrees_of_freedom": None,
            "statistic": None,
            "p_value": None,
            "interpretable": False,
            "reason": LOW_COUNT_REASON,
        }
    chi2 = float((((observed[use] - expected[use]) ** 2) / expected[use]).sum())
    degrees_of_freedom = categories - 1
    return {
        "sample_count": int(len(values)),
        "valid_category_count": categories,
        "degrees_of_freedom": degrees_of_freedom,
        "statistic": chi2,
        "p_value": gamma_q(degrees_of_freedom / 2, chi2 / 2),
        "interpretable": True,
        "reason": None,
    }


def chi_square_p(values):
    return measure(values)["p_value"]


def analyse(values: np.ndarray, segments: int = SEGMENT_COUNT) -> dict[str, object]:
    edges = np.linspace(0, len(values), segments + 1).astype(np.int64)
    segment_results = []
    for index in range(segments):
        start = int(edges[index])
        end = int(edges[index + 1])
        segment_results.append({"index": index, "start": start, "end": end, **measure(values[start:end])})
    return {
        "method": METHOD,
        "pair_count": 128,
        "minimum_expected_count": MIN_EXPECTED_COUNT,
        "segment_count": segments,
        "presentation_heuristic": PRESENTATION_HEURISTIC,
        "descriptive_only": True,
        "explanation": {
            "high_p_value": (
                "A high p-value is consistent with equalised pairs produced by random LSB replacement; "
                "it does not prove embedding."
            ),
            "limitations": [
                "Texture or naturally noisy data can equalise pairs.",
                "Flat regions and small samples can violate or weaken the approximation.",
                "Preprocessing can alter the histogram independently of embedding.",
                "Embedding methods other than LSB replacement may not produce this pattern.",
            ],
        },
        "overall": measure(values),
        "segments": segment_results,
    }


def chi_square_segments(values, segments=SEGMENT_COUNT):
    return [segment["p_value"] for segment in analyse(values, segments)["segments"]]
