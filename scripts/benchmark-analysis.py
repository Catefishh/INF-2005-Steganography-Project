"""Repeatable BPCS speed comparison on fixed synthetic image channels."""
import json
import statistics
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.app.stego.analysis_parts.bpcs import _plane


def reference(channel, bit, block):
    pixels = (channel >> bit) & 1
    total = 0
    for y in range(0, channel.shape[0], block):
        for x in range(0, channel.shape[1], block):
            cell = pixels[y:y + block, x:x + block]
            total += int(np.count_nonzero(cell[:, 1:] != cell[:, :-1]) +
                         np.count_nonzero(cell[1:, :] != cell[:-1, :]))
    return total


def elapsed(fn):
    samples = []
    result = None
    for _ in range(3):
        start = time.perf_counter()
        result = fn()
        samples.append((time.perf_counter() - start) * 1000)
    return result, round(statistics.median(samples), 3)


def main():
    output = []
    for side in (128, 512, 1024):
        image = np.random.default_rng(2005).integers(0, 256, (side, side), dtype=np.uint8)
        slow_result, slow_ms = elapsed(lambda: reference(image, 0, 16))
        fast_result, fast_ms = elapsed(lambda: _plane(image, 0, 16))
        assert slow_result == int(fast_result[2].sum())
        output.append({"side": side, "block_size": 16, "reference_ms": slow_ms,
                       "vectorized_ms": fast_ms, "speedup": round(slow_ms / fast_ms, 2)})
    print(json.dumps({"method": "median of three runs; fixed seed 2005; one bit plane",
                      "results": output}, indent=2))


if __name__ == "__main__":
    main()
