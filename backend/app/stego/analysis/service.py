"""Steganalysis service orchestration."""

from . import bit_planes, chi_square, difference, histogram
from .common import prepare_inputs


def analyse(data: bytes, compare_data: bytes | None = None, channel: int = 0) -> dict[str, object]:
    inputs = prepare_inputs(data, compare_data)
    context = inputs.suspect
    context.validate_channel(channel)

    previews = bit_planes.analyse(context, channel)
    values = context.sequence(channel)
    result = {
        "info": context.cover.info(),
        "channel": channel,
        "channel_names": list(context.channel_names),
        "stride": previews["stride"],
        "bit_planes": previews["bit_planes"],
        "chi_square": chi_square.chi_square_segments(values),
        "chi_square_overall": chi_square.chi_square_p(values),
        "histograms": histogram.analyse(context, channel),
        "lsb_composite": previews["lsb_composite"],
        "compare": difference.analyse(context, inputs.reference, previews["stride"]),
    }
    return result
