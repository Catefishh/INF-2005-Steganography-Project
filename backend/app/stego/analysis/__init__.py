"""Stable steganalysis facade."""

from typing import TYPE_CHECKING

from .chi_square import chi_square_p, gamma_q

if TYPE_CHECKING:
    from .bpcs import BPCSConfig


def analyse(data: bytes, compare_data: bytes | None = None, channel: int = 0,
            bpcs_config: "BPCSConfig | None" = None) -> dict[str, object]:
    from .service import analyse as run
    return run(data, compare_data, channel, bpcs_config)

__all__ = ["analyse", "chi_square_p", "gamma_q"]
