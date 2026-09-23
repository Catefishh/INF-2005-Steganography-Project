import io
import json

import numpy as np
from PIL import Image

from scripts.benchmark_analysis import main, run


def png(array):
    output = io.BytesIO()
    Image.fromarray(array, mode="RGB").save(output, format="PNG")
    return output.getvalue()


def test_benchmark_reports_stable_semantics_and_writes_json(tmp_path):
    cover = np.zeros((16, 16, 3), dtype=np.uint8)
    suspect = cover.copy()
    suspect[::2, ::2, 0] = 1
    report = run(1, {"tiny": (png(suspect), png(cover))})
    row = report["fixtures"][0]
    assert row["semantic_sha256"]
    assert row["wall_ms"]["median"] >= 0
    assert set(row["durations_ms_median"]) == {"load", "bit_planes", "histogram", "chi_square", "bpcs", "rs", "difference", "total"}
    output = tmp_path / "report.json"
    assert main(["--repeat", "1", "--output", str(output)]) == 0
    assert json.loads(output.read_text())["fixtures"]


def test_benchmark_rejects_invalid_repeat():
    try:
        run(0, {})
    except ValueError as error:
        assert str(error) == "repeat must be at least 1"
    else:
        raise AssertionError("invalid repeat should fail")
