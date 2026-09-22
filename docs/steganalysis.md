# Modular Steganalysis

The `/api/analyse` workflow is descriptive analysis. It does not alter authenticity or verification verdicts.

## Modules and flow

`backend/app/stego/analysis/` loads each suspect and reference carrier once. `common.py` caches channel sequences and bit planes. Focused modules generate previews, histograms, Westfeld-Pfitzmann Chi-Square measurements, BPCS maps, and cover/stego differences. `service.py` assembles the response and records analyzer durations inside the existing FastAPI thread-pool boundary.

## BPCS

BPCS defaults are channel `0`, block size `8`, inclusive bit planes `0` through `7`, and complexity threshold `0.30`. Accepted block sizes are `2`, `4`, `8`, `16`, `32`, and `64`; channels and planes are `0..2` and `0..7`; threshold is `0..1`. Form names are `bpcs_channel`, `bpcs_block_size`, `bpcs_bit_plane_start`, `bpcs_bit_plane_end`, and `bpcs_complexity_threshold`.

This phase supports BPCS analysis for images only. Audio retains bit-plane, histogram, Chi-Square, and difference analysis and returns an explicit unsupported BPCS state. Partial blocks use `include-valid-adjacencies`: horizontal and vertical transitions are counted only between valid pixels. Complexity is transitions divided by `h * (w - 1) + (h - 1) * w`, or zero when no adjacency exists. The inclusive threshold classifies a block as complex.

Complexity and classification maps are sampled to at most 512 by 512 pixels, one map pixel per sampled block. Full-resolution blocks, transitions, classifications, and capacity remain in the scalar statistics. Theoretical capacity is the valid pixel count of complex blocks: `capacity_bits`, `capacity_bytes_floor`, and `capacity_remainder_bits`. Framing, metadata, error correction, and conjugation maps are not deducted. BPCS comparison reports signed suspect-minus-reference deltas and classification changes; it is not a detector verdict. The API form key is `bpcs_complexity_threshold`.

## Chi-Square

The analyzer uses the `westfeld-pfitzmann-pairs-of-values` method: histogram pairs `(0,1), (2,3), ... (254,255)` use each pair mean as the expected count. Pair categories with expected count below `5` are excluded. The response includes sample count, valid category count, degrees of freedom, statistic, p-value, interpretability, segment bounds, and method metadata. Rich responses mark this as `descriptive_only`.

A high p-value is consistent with equalised pairs produced by random LSB replacement; it does not prove embedding. Texture or naturally noisy data can equalise pairs, flat regions and small samples can weaken the approximation, preprocessing can alter the histogram, and other embedding methods may not produce the pattern. `0.95` is a presentation heuristic, not a universal decision threshold. Legacy `chi_square` and `chi_square_overall` fields remain for callers; new clients should use `chi_square_details`.

## Response and reproduction

The response keeps legacy fields and adds `chi_square_details`, `bpcs`, and `durations_ms` (`load`, `bit_planes`, `histogram`, `chi_square`, `bpcs`, `difference`, and `total`). Timings describe this run and are not detection evidence. Preview and map data are bounded PNG data URLs; raw complexity matrices are not serialized.

Run the deterministic benchmark with:

```powershell
..\..\.venv\Scripts\python.exe -m scripts.benchmark_analysis --repeat 3 --output .benchmarks/modular.json
```

It uses seeded 256x256, 1024x768, and 2048x1536 RGB fixtures with deterministic suspect/reference pairs. Reports include wall and analyzer medians, environment data, and semantic digests covering scalar results and PNG payloads. A baseline compares measurements but fails only if semantic results differ, not because machine speed changes.
