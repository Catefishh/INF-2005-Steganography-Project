"""Repeatable modular steganalysis measurements."""

from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import platform
import statistics
import time
from pathlib import Path

import numpy as np
from PIL import Image

from backend.app.stego import analysis


SIZES = {"small": (256, 256), "medium": (768, 1024), "large": (1536, 2048)}


def _png(array: np.ndarray) -> bytes:
    output = io.BytesIO()
    Image.fromarray(array, mode="RGB").save(output, format="PNG")
    return output.getvalue()


def _fixtures() -> dict[str, tuple[bytes, bytes]]:
    rng = np.random.default_rng(20260922)
    fixtures = {}
    for name, (height, width) in SIZES.items():
        cover = rng.integers(0, 256, (height, width, 3), dtype=np.uint8)
        stego = cover.copy()
        stego[::17, ::19, 0] ^= 1
        fixtures[name] = (_png(stego), _png(cover))
    return fixtures


def _digest(value: object) -> object:
    if isinstance(value, str) and value.startswith("data:image/png;base64,"):
        return {"png_sha256": hashlib.sha256(base64.b64decode(value.split(",", 1)[1])).hexdigest()}
    if isinstance(value, dict):
        return {key: _digest(child) for key, child in sorted(value.items()) if key != "durations_ms"}
    if isinstance(value, list):
        return [_digest(child) for child in value]
    return value


def run(repeat: int = 3, fixture_map: dict[str, tuple[bytes, bytes]] | None = None) -> dict[str, object]:
    if repeat < 1:
        raise ValueError("repeat must be at least 1")
    rows = []
    for name, (stego, cover) in (fixture_map or _fixtures()).items():
        analysis.analyse(stego, cover)
        wall = []
        durations: dict[str, list[float]] = {}
        result = None
        for _ in range(repeat):
            started = time.perf_counter()
            result = analysis.analyse(stego, cover)
            wall.append((time.perf_counter() - started) * 1000)
            for key, value in result["durations_ms"].items():
                durations.setdefault(key, []).append(value)
        rows.append({"name": name, "dimensions": list(SIZES.get(name, (0, 0))), "encoded_bytes": len(stego), "repeat": repeat,
                     "wall_ms": {"min": min(wall), "median": statistics.median(wall), "max": max(wall)},
                     "durations_ms_median": {key: statistics.median(values) for key, values in durations.items()},
                     "semantic_sha256": hashlib.sha256(json.dumps(_digest(result), sort_keys=True).encode()).hexdigest()})
    return {"environment": {"python": platform.python_version(), "numpy": np.__version__, "pillow": Image.__version__, "platform": platform.platform()}, "fixtures": rows}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repeat", type=int, default=3)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--baseline", type=Path)
    args = parser.parse_args(argv)
    report = run(args.repeat)
    if args.baseline:
        baseline = json.loads(args.baseline.read_text())
        before = {row["name"]: row for row in baseline["fixtures"]}
        for row in report["fixtures"]:
            if row["semantic_sha256"] != before[row["name"]]["semantic_sha256"]:
                raise SystemExit(f"semantic digest changed for {row['name']}")
            old = before[row["name"]]["wall_ms"]["median"]
            delta = "N/A" if old == 0 else f"{(row['wall_ms']['median'] - old) / old * 100:+.1f}%"
            print(f"{row['name']}: {row['wall_ms']['median']:.2f} ms ({delta})")
    else:
        for row in report["fixtures"]:
            print(f"{row['name']}: {row['wall_ms']['median']:.2f} ms")
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
