import base64
import io
import math

import numpy as np
import pytest
from PIL import Image

from backend.app.stego.analysis.common import prepare_inputs
from backend.app.stego.analysis.difference import analyse
from test_audio import wav


def png(array: np.ndarray) -> bytes:
    out = io.BytesIO()
    Image.fromarray(array.astype(np.uint8), mode="RGB").save(out, format="PNG")
    return out.getvalue()


def decode_png(data_url: str) -> np.ndarray:
    encoded = data_url.split(",", 1)[1]
    return np.array(Image.open(io.BytesIO(base64.b64decode(encoded))))


def test_image_difference_preserves_legacy_counts_math_and_pixels():
    reference = np.array(
        [
            [[10, 20, 30], [40, 50, 60]],
            [[70, 80, 90], [100, 110, 120]],
        ],
        dtype=np.uint8,
    )
    suspect = reference.copy()
    suspect[0, 1, 0] += 1
    suspect[1, 0, 1] -= 2
    inputs = prepare_inputs(png(suspect), png(reference))

    result = analyse(inputs.suspect, inputs.reference, preview_stride=1)

    assert set(result) == {
        "slots_changed",
        "bits_changed",
        "max_difference",
        "psnr_db",
        "mse",
        "changed_map",
        "amplified",
    }
    assert result["slots_changed"] == 2
    assert result["bits_changed"] == 5
    assert result["max_difference"] == 2
    assert result["mse"] == pytest.approx(5 / 12)
    assert result["psnr_db"] == pytest.approx(10 * math.log10(255 * 255 / (5 / 12)))
    np.testing.assert_array_equal(decode_png(result["changed_map"]), [[0, 255], [255, 0]])
    expected_amplified = np.zeros((2, 2, 3), dtype=np.uint8)
    expected_amplified[0, 1, 0] = 64
    expected_amplified[1, 0, 1] = 128
    np.testing.assert_array_equal(decode_png(result["amplified"]), expected_amplified)


def test_identical_inputs_have_zero_mse_and_no_psnr():
    data = png(np.full((3, 4, 3), 25, dtype=np.uint8))
    inputs = prepare_inputs(data, data)

    result = analyse(inputs.suspect, inputs.reference, preview_stride=1)

    assert result["slots_changed"] == 0
    assert result["bits_changed"] == 0
    assert result["mse"] == 0.0
    assert result["psnr_db"] is None


def test_audio_difference_uses_audio_peak_and_has_no_amplified_map():
    reference = wav(bits=16, channels=1, frames=16)
    changed = bytearray(reference)
    data_offset = reference.index(b"data") + 8
    changed[data_offset] ^= 1
    inputs = prepare_inputs(bytes(changed), reference)

    result = analyse(inputs.suspect, inputs.reference, preview_stride=1)

    assert result["slots_changed"] == 1
    assert result["bits_changed"] == 1
    assert result["mse"] == pytest.approx(1 / 16)
    assert result["psnr_db"] == pytest.approx(10 * math.log10(((1 << 16) - 1) ** 2 / (1 / 16)))
    assert result["amplified"] is None
    assert decode_png(result["changed_map"]).max() == 255


def test_difference_without_reference_is_none():
    inputs = prepare_inputs(png(np.zeros((2, 2, 3), dtype=np.uint8)), None)

    assert analyse(inputs.suspect, None, preview_stride=1) is None
