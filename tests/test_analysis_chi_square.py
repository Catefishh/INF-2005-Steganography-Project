import math

import numpy as np
import pytest

from backend.app.stego.analysis.chi_square import (
    METHOD,
    MIN_EXPECTED_COUNT,
    PRESENTATION_HEURISTIC,
    SEGMENT_COUNT,
    analyse,
    gamma_q,
    measure,
)


MEASUREMENT_FIELDS = {
    "sample_count",
    "valid_category_count",
    "degrees_of_freedom",
    "statistic",
    "p_value",
    "interpretable",
    "reason",
}


def test_gamma_q_matches_known_values():
    assert gamma_q(1, 1) == pytest.approx(math.exp(-1), rel=1e-12)
    assert gamma_q(2.5, 5) == pytest.approx(0.0752352, rel=1e-5)
    assert gamma_q(0.5, 1.920729) == pytest.approx(0.05, rel=1e-5)


def test_measure_uses_only_pairs_with_sufficient_expected_count():
    values = np.repeat(np.arange(6, dtype=np.uint8), [12, 8, 4, 4, 20, 10])
    expected_statistic = ((12 - 10) ** 2 / 10) + ((20 - 15) ** 2 / 15)

    result = measure(values)

    assert set(result) == MEASUREMENT_FIELDS
    assert result["sample_count"] == 58
    assert result["valid_category_count"] == 2
    assert result["degrees_of_freedom"] == 1
    assert result["statistic"] == pytest.approx(expected_statistic)
    assert result["p_value"] == pytest.approx(gamma_q(0.5, expected_statistic / 2))
    assert result["interpretable"] is True
    assert result["reason"] is None


def test_measure_reports_exact_reason_when_fewer_than_two_pairs_are_valid():
    values = np.repeat(np.array([0, 1], dtype=np.uint8), [8, 4])

    result = measure(values)

    assert result == {
        "sample_count": 12,
        "valid_category_count": 1,
        "degrees_of_freedom": None,
        "statistic": None,
        "p_value": None,
        "interpretable": False,
        "reason": "At least two value pairs with expected count >= 5 are required.",
    }


def test_analyse_returns_descriptive_metadata_and_indexed_segment_bounds():
    values = np.tile(np.arange(256, dtype=np.uint8), 41)
    expected_edges = np.linspace(0, len(values), SEGMENT_COUNT + 1).astype(np.int64)

    result = analyse(values)

    assert set(result) == {
        "method",
        "pair_count",
        "minimum_expected_count",
        "segment_count",
        "presentation_heuristic",
        "descriptive_only",
        "explanation",
        "overall",
        "segments",
    }
    assert result["method"] == METHOD == "westfeld-pfitzmann-pairs-of-values"
    assert result["pair_count"] == 128
    assert result["minimum_expected_count"] == MIN_EXPECTED_COUNT == 5.0
    assert result["segment_count"] == SEGMENT_COUNT == 64
    assert result["presentation_heuristic"] == PRESENTATION_HEURISTIC == 0.95
    assert result["descriptive_only"] is True
    assert result["explanation"] == {
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
    }
    assert set(result["overall"]) == MEASUREMENT_FIELDS
    assert len(result["segments"]) == SEGMENT_COUNT
    for index, segment in enumerate(result["segments"]):
        assert segment["index"] == index
        assert segment["start"] == int(expected_edges[index])
        assert segment["end"] == int(expected_edges[index + 1])
        assert set(segment) == MEASUREMENT_FIELDS | {"index", "start", "end"}
    assert "verdict" not in result


def test_measure_distinguishes_equalised_and_unequal_lsb_pairs():
    rng = np.random.default_rng(0)
    smooth = np.clip(rng.normal(100, 30, 200_000), 0, 255).astype(np.uint8) & 0xFE
    embedded = smooth | rng.integers(0, 2, smooth.size, dtype=np.uint8)

    assert measure(smooth)["p_value"] < 0.01
    assert measure(embedded)["p_value"] > 0.5
