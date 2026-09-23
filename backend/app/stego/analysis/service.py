"""Steganalysis service orchestration."""

from time import perf_counter

from . import bit_planes, bpcs, chi_square, histogram
from .bpcs import BPCSConfig
from .common import prepare_inputs
from ..analysis_parts.rs import analyse as rs_analyse
from ..analysis_parts.difference import compare as rich_compare


def analyse(
    data: bytes,
    compare_data: bytes | None = None,
    channel: int = 0,
    bpcs_config: BPCSConfig | None = None,
) -> dict[str, object]:
    total_start = perf_counter()
    step_start = perf_counter()
    inputs = prepare_inputs(data, compare_data)
    durations = {"load": (perf_counter() - step_start) * 1000}
    context = inputs.suspect
    context.validate_channel(channel)
    config = BPCSConfig() if bpcs_config is None else bpcs_config

    step_start = perf_counter()
    previews = bit_planes.analyse(context, channel)
    durations["bit_planes"] = (perf_counter() - step_start) * 1000

    step_start = perf_counter()
    histograms = histogram.analyse(context, channel)
    durations["histogram"] = (perf_counter() - step_start) * 1000

    values = context.sequence(channel)
    step_start = perf_counter()
    chi_square_details = chi_square.analyse(values)
    durations["chi_square"] = (perf_counter() - step_start) * 1000

    step_start = perf_counter()
    bpcs_result = bpcs.analyse(context, inputs.reference, config)
    durations["bpcs"] = (perf_counter() - step_start) * 1000

    step_start = perf_counter()
    rs_result = rs_analyse(context.image_channel(channel)) if context.cover.kind == "image" else None
    durations["rs"] = (perf_counter() - step_start) * 1000

    step_start = perf_counter()
    comparison = (rich_compare(context.cover, inputs.reference.cover, previews["stride"])
                  if inputs.reference else None)
    durations["difference"] = (perf_counter() - step_start) * 1000

    reference_previews = (bit_planes.analyse(inputs.reference, channel) if inputs.reference else None)
    reference_histograms = (histogram.analyse(inputs.reference, channel) if inputs.reference else None)

    result = {
        "info": context.cover.info(),
        "channel": channel,
        "channel_names": list(context.channel_names),
        "stride": previews["stride"],
        "bit_planes": previews["bit_planes"],
        "chi_square": [segment["p_value"] for segment in chi_square_details["segments"]],
        "chi_square_overall": chi_square_details["overall"]["p_value"],
        "chi_square_details": chi_square_details,
        "histograms": histograms,
        "lsb_composite": previews["lsb_composite"],
        "compare": comparison,
        "bpcs": bpcs_result,
        "rs": rs_result,
        "reference_bit_planes": reference_previews["bit_planes"] if reference_previews else None,
        "reference_histograms": reference_histograms,
    }
    durations["total"] = (perf_counter() - total_start) * 1000
    result["durations_ms"] = {name: round(duration, 3) for name, duration in durations.items()}
    return result
