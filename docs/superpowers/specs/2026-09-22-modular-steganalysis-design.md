# Modular Steganalysis Enhancements Design

## Scope and priority

The enhancement is delivered in this order:

1. Image-only Bit Plane Complexity Segmentation (BPCS) analysis.
2. Modular visual and statistical steganalysis, including a documented justification for the Chi-Square method.
3. Measured analysis-speed optimisations.

BPCS analysis is in scope; BPCS embedding is deferred to a separate future feature. Audio remains supported by the existing visual/statistical analyses, but the image BPCS algorithm is not applied to audio in this phase.

## Architecture

The existing analysis workflow remains available through `/api/analyse`, but its implementation is decomposed into focused backend modules:

- `analysis/common.py`: shared carrier/channel extraction, image preview bounds, validation, and comparison inputs.
- `analysis/bit_planes.py`: bit-plane and LSB composite generation.
- `analysis/histogram.py`: histogram generation and related summaries.
- `analysis/chi_square.py`: pairs-of-values statistics, segmentation, validity metadata, and explanation metadata.
- `analysis/bpcs.py`: image-only block segmentation, complexity maps, classification, comparison, and capacity estimates.
- `analysis/difference.py`: changed slots, changed bits, MSE/PSNR, and visual difference maps.
- A coordinator module, either the existing `analysis.py` after reduction or a new service module, loads the carrier, validates the request, invokes the analyzers, and assembles the response.

The frontend Analyse page is similarly composed into independently presentable sections for input controls, bit planes, BPCS, Chi-Square, histograms, and cover/stego differences. Shared API types describe each result section.

## BPCS behavior

The BPCS request supports configurable:

- image channel;
- square block size;
- inclusive bit-plane range;
- normalized complexity threshold.

For each selected bit plane, the implementation partitions the channel into blocks, including a defined and tested policy for partial edge blocks. It calculates normalized complexity from adjacent transitions, classifies blocks as complex or non-complex, and returns:

- complexity and classification maps;
- complex/non-complex block counts and percentages;
- transition statistics;
- estimated capacity based on complex blocks;
- configuration values and image dimensions used for the result.

When a matching reference cover is supplied, BPCS returns descriptive comparison data: complexity deltas, changed-block counts, classification flips, and capacity differences. It does not return a binary stego detector verdict.

Audio responses explicitly identify BPCS as unsupported for the current phase while retaining existing audio analyses.

## Chi-Square semantics and justification

The Chi-Square analyzer retains the Westfeld-Pfitzmann pairs-of-values method:

1. Build a 256-bin histogram for the selected channel.
2. Pair `(0,1), (2,3), ..., (254,255)`.
3. Use each pair mean as the expected count for both values.
4. Exclude categories below the minimum expected-count assumption.
5. Calculate the statistic and upper-tail p-value globally and by segment.

Results include sample count, valid category count, statistic, p-value, and interpretability metadata. The UI and documentation explain that a high p-value is consistent with equalised value pairs produced by random LSB replacement, but does not prove embedding. They also document false-positive risks from texture, flat regions, small samples, preprocessing, and other embedding methods. The existing `0.95` display threshold is labelled as a presentation heuristic rather than a universal decision threshold.

Chi-Square, BPCS, and other analysis results remain descriptive and do not affect authenticity or verification verdicts.

## API and frontend behavior

The `/api/analyse` endpoint gains optional BPCS form parameters while preserving existing callers. Invalid values produce clear `400` responses. Defaults are defined centrally and returned in the analysis response so results are reproducible.

The frontend provides controls for all BPCS parameters, reruns analysis when the user requests a new configuration, shows BPCS only for image inputs, and presents an explicit unsupported state for audio. Each analysis section handles loading, invalid input, empty results, and optional comparison independently.

## Optimisation boundaries

Optimisation follows correctness. The primary target is analysis speed, measured across representative small, medium, and large images. The implementation should:

- reuse loaded channel arrays and derived bit-plane data;
- vectorise transitions, histograms, complexity maps, and classifications with NumPy;
- avoid generating BPCS data for audio;
- retain bounded preview dimensions and response sizes;
- preserve the existing thread-pool boundary for CPU-heavy work;
- record or benchmark per-analyzer and total analysis duration.

Optimisations must preserve response semantics, visual output correctness, and existing image/audio behavior.

## Verification

Backend tests cover known complexity patterns, block edges and padding, parameter validation, capacity calculations, cover/stego comparisons, image-only behavior, Chi-Square expected values and low-count exclusion, API compatibility, and existing image/audio regressions.

Frontend verification covers parameter controls, reruns, image/audio branching, comparison states, TypeScript compilation, and the production build. Performance benchmarks compare the modular implementation before and after optimisation on fixed representative fixtures.
