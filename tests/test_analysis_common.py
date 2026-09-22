import io

import numpy as np
import pytest
from PIL import Image

from backend.app.stego.analysis.common import PREVIEW_SIDE, prepare_inputs
from test_audio import wav


def png(array: np.ndarray) -> bytes:
    out = io.BytesIO()
    Image.fromarray(array.astype(np.uint8), mode="RGB").save(out, format="PNG")
    return out.getvalue()


def test_image_sequence_is_flat_contiguous_row_major_and_cached():
    pixels = np.arange(4 * 5 * 3, dtype=np.uint8).reshape(4, 5, 3)
    context = prepare_inputs(png(pixels), None).suspect

    sequence = context.sequence(1)

    assert sequence.shape == (20,)
    assert sequence.flags.c_contiguous
    assert sequence.tolist() == pixels[:, :, 1].reshape(-1).tolist()
    assert context.sequence(1) is sequence


def test_audio_sequence_deinterleaves_channels_and_is_cached():
    context = prepare_inputs(wav(bits=16, channels=2, frames=8), None).suspect

    sequence = context.sequence(1)

    assert sequence.flags.c_contiguous
    assert sequence.tolist() == context.cover.slots[1::2].tolist()
    assert context.sequence(1) is sequence


def test_bit_plane_is_cached_and_preserves_image_dimensions():
    pixels = np.arange(6 * 7 * 3, dtype=np.uint8).reshape(6, 7, 3)
    context = prepare_inputs(png(pixels), None).suspect

    plane = context.bit_plane(2, 3)

    assert plane.shape == (6, 7)
    assert plane.flags.c_contiguous
    np.testing.assert_array_equal(plane, (pixels[:, :, 2] >> 3) & 1)
    assert context.bit_plane(2, 3) is plane


def test_image_and_audio_previews_are_bounded():
    image = np.zeros((513, 1025, 3), dtype=np.uint8)
    image_context = prepare_inputs(png(image), None).suspect
    audio_context = prepare_inputs(wav(channels=1, frames=PREVIEW_SIDE * PREVIEW_SIDE + 100), None).suspect

    image_grid, image_stride = image_context.preview_grid(0)
    audio_grid, audio_stride = audio_context.preview_grid(0)

    assert image_stride == 3
    assert image_grid.shape[0] <= PREVIEW_SIDE
    assert image_grid.shape[1] <= PREVIEW_SIDE
    assert audio_stride == 2
    assert audio_grid.shape[0] <= PREVIEW_SIDE
    assert audio_grid.shape[1] <= PREVIEW_SIDE


def test_prepare_inputs_rejects_comparison_kind_or_image_dimensions():
    image = png(np.zeros((4, 5, 3), dtype=np.uint8))
    different_image = png(np.zeros((5, 4, 3), dtype=np.uint8))
    message = "The two files must be the same kind and size to compare"

    with pytest.raises(ValueError, match=message):
        prepare_inputs(image, wav(channels=1, frames=20))
    with pytest.raises(ValueError, match=message):
        prepare_inputs(image, different_image)


def test_prepare_inputs_treats_empty_reference_as_absent():
    image = png(np.zeros((2, 2, 3), dtype=np.uint8))

    assert prepare_inputs(image, b"").reference is None
