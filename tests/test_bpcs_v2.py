import numpy as np
import pytest

from backend.app.stego.analysis_parts.bpcs import _plane, analyse


def test_known_complexity_and_partial_edges():
    solid = np.zeros((5, 7), dtype=np.uint8)
    values, pixels, transitions = _plane(solid, 0, 4)
    assert values.shape == (2, 2)
    assert pixels.tolist() == [[16, 12], [4, 3]]
    assert np.all(values == 0) and np.all(transitions == 0)
    checker = np.fromfunction(lambda y, x: (x + y) % 2, (5, 7), dtype=int).astype(np.uint8)
    values, _, _ = _plane(checker, 0, 4)
    assert np.all(values == 1)
    report = analyse(checker, solid, block_size=4, first_plane=0, last_plane=0, threshold=0.3)
    assert report["planes"][0]["complex_blocks"] == 4
    assert report["planes"][0]["comparison"]["classification_flips"] == 4
    assert report["estimated_capacity_bits"] == 35


@pytest.mark.parametrize("parameters", [
    {"block_size": 2}, {"first_plane": 6, "last_plane": 4},
    {"threshold": -0.1}, {"threshold": float("nan")},
])
def test_invalid_settings(parameters):
    with pytest.raises(ValueError):
        analyse(np.zeros((8, 8), dtype=np.uint8), None, **parameters)
