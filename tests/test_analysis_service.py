import io
import math

import numpy as np
import pytest
from PIL import Image

from backend.app.stego import analysis
from backend.app.stego.analysis.bpcs import BPCSConfig
from backend.app.stego.analysis import common
from test_audio import wav


LEGACY_FIELDS = {
    "info",
    "channel",
    "channel_names",
    "stride",
    "bit_planes",
    "chi_square",
    "chi_square_overall",
    "histograms",
    "lsb_composite",
    "compare",
}
COMPARISON_FIELDS = {
    "slots_changed",
    "bits_changed",
    "max_difference",
    "psnr_db",
    "mse",
    "changed_map",
    "amplified",
}


def png(array: np.ndarray) -> bytes:
    out = io.BytesIO()
    Image.fromarray(array.astype(np.uint8), mode="RGB").save(out, format="PNG")
    return out.getvalue()


def image_pair() -> tuple[bytes, bytes]:
    cover = np.arange(12 * 10 * 3, dtype=np.uint8).reshape(10, 12, 3)
    stego = cover.copy()
    stego[2:4, 3:7, 0] ^= 1
    return png(stego), png(cover)


def test_legacy_image_analysis_contract():
    stego, cover = image_pair()

    result = analysis.analyse(stego, cover, channel=0)

    assert LEGACY_FIELDS <= result.keys()
    assert result["info"]["kind"] == "image"
    assert result["channel"] == 0
    assert result["channel_names"] == ["Red", "Green", "Blue"]
    assert result["stride"] == 1
    assert len(result["bit_planes"]) == 8
    assert len(result["chi_square"]) == 64
    assert len(result["histograms"]) == 3
    assert all(len(histogram) == 256 for histogram in result["histograms"])
    assert result["lsb_composite"].startswith("data:image/png;base64,")
    assert set(result["compare"]) == COMPARISON_FIELDS
    assert result["compare"]["slots_changed"] == 8


def test_legacy_audio_analysis_contract_without_comparison():
    result = analysis.analyse(wav(frames=160), channel=1)

    assert LEGACY_FIELDS <= result.keys()
    assert result["info"]["kind"] == "audio"
    assert result["channel"] == 1
    assert result["channel_names"] == ["Channel 1", "Channel 2"]
    assert len(result["bit_planes"]) == 8
    assert len(result["chi_square"]) == 64
    assert len(result["histograms"]) == 1
    assert len(result["histograms"][0]) == 256
    assert result["lsb_composite"] is None
    assert result["compare"] is None


def test_legacy_analysis_rejects_out_of_range_channel():
    stego, _ = image_pair()

    with pytest.raises(ValueError, match=r"^Channel is out of range for this file\.$"):
        analysis.analyse(stego, channel=3)


def test_legacy_analysis_rejects_mismatched_comparison():
    stego, _ = image_pair()

    with pytest.raises(
        ValueError,
        match=r"^The two files must be the same kind and size to compare \(e\.g\. cover vs its stego\)\.$",
    ):
        analysis.analyse(stego, wav(frames=160))


def test_legacy_analysis_treats_empty_comparison_as_absent():
    stego, _ = image_pair()

    assert analysis.analyse(stego, b"")["compare"] is None


def test_rich_chi_square_is_the_source_of_legacy_projections():
    stego, _ = image_pair()

    result = analysis.analyse(stego)

    details = result["chi_square_details"]
    assert result["chi_square"] == [segment["p_value"] for segment in details["segments"]]
    assert result["chi_square_overall"] == details["overall"]["p_value"]


def test_service_assembles_default_bpcs_comparison_and_durations():
    stego, cover = image_pair()

    result = analysis.analyse(stego, cover)

    assert result["bpcs"]["supported"] is True
    assert result["bpcs"]["config"] == BPCSConfig().as_dict()
    assert result["bpcs"]["comparison"] is not None
    assert result["compare"]["slots_changed"] == 8
    assert set(result["durations_ms"]) == {
        "load",
        "bit_planes",
        "histogram",
        "chi_square",
        "bpcs",
        "difference",
        "total",
    }
    for duration in result["durations_ms"].values():
        assert math.isfinite(duration)
        assert duration >= 0
        assert duration == round(duration, 3)
    assert result["durations_ms"]["total"] >= max(
        duration
        for name, duration in result["durations_ms"].items()
        if name != "total"
    )


def test_service_applies_custom_bpcs_config_and_ascending_planes():
    stego, _ = image_pair()
    config = BPCSConfig.from_values(2, 4, 1, 3, 0.45)

    result = analysis.analyse(stego, bpcs_config=config)

    assert result["bpcs"]["config"] == config.as_dict()
    assert [plane["bit_plane"] for plane in result["bpcs"]["planes"]] == [1, 2, 3]


def test_service_returns_unsupported_bpcs_for_audio_with_custom_config():
    config = BPCSConfig.from_values(2, 4, 1, 3, 0.45)

    result = analysis.analyse(wav(channels=2, frames=64), bpcs_config=config)

    assert result["bpcs"] == {
        "supported": False,
        "reason": "BPCS analysis is available only for image inputs.",
        "config": config.as_dict(),
        "image": None,
        "planes": [],
        "summary": None,
        "comparison": None,
    }


def test_service_loads_each_nonempty_input_exactly_once(monkeypatch):
    stego, cover = image_pair()
    calls = []
    real_load_cover = common.load_cover

    def recording_load_cover(data):
        calls.append(data)
        return real_load_cover(data)

    monkeypatch.setattr(common, "load_cover", recording_load_cover)

    analysis.analyse(stego, cover)

    assert calls == [stego, cover]
