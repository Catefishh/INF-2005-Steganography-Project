# Modular Steganalysis Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add modular, reproducible image BPCS analysis, richer descriptive Chi-Square results, bounded visual payloads, measured timings, and matching Analyse-page controls while preserving existing image/audio `/api/analyse` behavior and fields.

**Architecture:** Replace the monolithic `backend/app/stego/analysis.py` with an `analysis` package whose service coordinator loads each carrier once, caches channel/bit-plane arrays, invokes focused analyzers, and assembles one backward-compatible response. Keep `/api/analyse` and its thread-pool boundary, add optional validated BPCS form fields, and split the existing React page into Operate-mode sections that use the current panels, colors, typography, spacing, and responsive conventions.

**Tech Stack:** Python 3.11+, FastAPI, NumPy, Pillow, pytest, React 19, TypeScript 7, Vite 8, Vitest 4, Testing Library, CSS.

---

Use the repository's prepared shared virtual environment and install frontend dependencies exactly from the lockfile:

```powershell
Test-Path ..\..\.venv\Scripts\python.exe
npm --prefix frontend ci
```

Expected: `Test-Path` prints `True` and npm completes a lockfile-consistent clean install. Do not create a redundant worktree-local virtual environment while the shared repository environment is available. The controller verified the unmodified baseline with `..\..\.venv\Scripts\python.exe -m pytest --basetemp=.pytest-baseline`: **141 passed** with one pre-existing Starlette warning; `npm --prefix frontend run build` also passed. All Python commands below consistently use `..\..\.venv\Scripts\python.exe`.

## Chunk 1: Contracts and modular backend foundation

### Task 0: Capture the review base and commit this implementation plan

**Files:**
- Stage: `docs/superpowers/plans/2026-09-22-modular-steganalysis.md`
- Create in worktree Git metadata only: path returned by `git rev-parse --git-path modular-steganalysis-base`

- [ ] **Step 1: Record the exact pre-implementation base SHA**

Run:

```powershell
$BaseFile = git rev-parse --git-path modular-steganalysis-base
git rev-parse HEAD | Set-Content -NoNewline $BaseFile
Get-Content $BaseFile
```

Expected: a 40-character commit SHA is printed. This is the immutable review base captured before the plan or implementation commits.

- [ ] **Step 2: Confirm only the plan is pending before its preliminary commit**

Run: `git status --short`

Expected: `?? docs/superpowers/plans/2026-09-22-modular-steganalysis.md` and no production-code changes. If unrelated user changes exist, leave them unstaged.

- [ ] **Step 3: Stage and commit the plan only**

```powershell
git add docs/superpowers/plans/2026-09-22-modular-steganalysis.md
git commit -m "docs: plan modular steganalysis"
```

Expected: one documentation-only commit. All later review commands use the SHA saved in Step 1 so the final review includes this plan commit.

### Task 1: Freeze the current analysis contract before moving code

**Files:**
- Create: `tests/test_analysis_service.py`
- Modify: `tests/test_api.py:67-70`
- Reference: `backend/app/stego/analysis.py`
- Reference: `backend/app/main.py:251-259`

The existing API contract is concrete compatibility scope. Preserve these top-level fields and meanings throughout the work: `info`, `channel`, `channel_names`, `stride`, `bit_planes`, `chi_square`, `chi_square_overall`, `histograms`, `lsb_composite`, and `compare`. Preserve every existing `compare` child: `slots_changed`, `bits_changed`, `max_difference`, `psnr_db`, `mse`, `changed_map`, and `amplified`.

- [ ] **Step 1: Add deterministic image and audio analysis fixtures**

In `tests/test_analysis_service.py`, add local helpers that create:

```python
def png(array: np.ndarray) -> bytes:
    out = io.BytesIO()
    Image.fromarray(array.astype(np.uint8), mode="RGB").save(out, format="PNG")
    return out.getvalue()


def image_pair() -> tuple[bytes, bytes]:
    cover = np.arange(12 * 10 * 3, dtype=np.uint8).reshape(10, 12, 3)
    stego = cover.copy()
    stego[2:4, 3:7, 0] ^= 1
    return png(stego), png(cover)
```

Reuse `wav` from `tests/test_audio.py` for audio. Keep arrays small so these are contract tests, not performance tests.

- [ ] **Step 2: Add characterization assertions for legacy image and audio fields**

Test `analysis.analyse(stego, cover, channel=0)` and `analysis.analyse(wav(...), channel=0)`:

```python
LEGACY_FIELDS = {
    "info", "channel", "channel_names", "stride", "bit_planes",
    "chi_square", "chi_square_overall", "histograms", "lsb_composite", "compare",
}

assert LEGACY_FIELDS <= result.keys()
assert len(result["bit_planes"]) == 8
assert len(result["chi_square"]) == 64
assert len(result["histograms"][0]) == 256
assert result["lsb_composite"].startswith("data:image/png;base64,")
assert result["compare"]["slots_changed"] == 8

assert audio["info"]["kind"] == "audio"
assert audio["lsb_composite"] is None
assert len(audio["bit_planes"]) == 8
```

Also assert same-kind/same-size comparison rejection and selected-channel range rejection retain their current human-readable `ValueError` messages.

- [ ] **Step 3: Strengthen endpoint compatibility coverage**

In `tests/test_api.py`, retain the existing no-BPCS-form request and assert status before decoding:

```python
response = client.post(
    "/api/analyse",
    files={"file": ("s", stego, mime), "compare": ("c", data, mime)},
    data={"channel": "0"},
)
assert response.status_code == 200, response.text
analysed = response.json()
assert LEGACY_FIELDS <= analysed.keys()
```

Define `LEGACY_FIELDS` in `tests/test_api.py`; do not import it from another test module.

- [ ] **Step 4: Characterize legacy analysis error/status behavior**

Add one parameterized API test group that freezes these existing outcomes before changing endpoint parsing:

```python
image = png_bytes()
assert client.post(
    "/api/analyse", files={"file": ("image.png", image, "image/png")}, data={"channel": "3"}
).status_code == 400
assert client.post(
    "/api/analyse", files={"file": ("image.png", image, "image/png")}, data={"channel": "not-an-int"}
).status_code == 422

mismatch = client.post(
    "/api/analyse",
    files={"file": ("image.png", image, "image/png"), "compare": ("audio.wav", wav(), "audio/wav")},
    data={"channel": "0"},
)
assert mismatch.status_code == 400
assert "same kind and size" in mismatch.json()["detail"]

empty_named = client.post(
    "/api/analyse",
    files={"file": ("image.png", image, "image/png"), "compare": ("empty.png", b"", "image/png")},
    data={"channel": "0"},
)
assert empty_named.status_code == 200
assert empty_named.json()["compare"] is None
```

Also assert the out-of-range channel detail remains `"Channel is out of range for this file."`. A named comparison upload with an empty body is historically treated as absent because `analysis.analyse` checks byte truthiness; preserve that behavior in `prepare_inputs` rather than attempting to load empty comparison bytes.

- [ ] **Step 5: Run the characterization tests before refactoring**

Run: `..\..\.venv\Scripts\python.exe -m pytest tests/test_analysis_service.py tests/test_api.py -q`

Expected: PASS using the shared environment, including exact 400/422/400/200 status behavior above.

- [ ] **Step 6: Commit the characterization tests**

```powershell
git add tests/test_analysis_service.py tests/test_api.py
git commit -m "test: characterize analysis API contract"
```

### Task 2: Create shared analysis context and focused legacy analyzers

**Files:**
- Delete: `backend/app/stego/analysis.py`
- Create: `backend/app/stego/analysis/__init__.py`
- Create: `backend/app/stego/analysis/common.py`
- Create: `backend/app/stego/analysis/bit_planes.py`
- Create: `backend/app/stego/analysis/histogram.py`
- Create: `backend/app/stego/analysis/chi_square.py`
- Create: `backend/app/stego/analysis/difference.py`
- Create: `backend/app/stego/analysis/service.py`
- Create: `tests/test_analysis_common.py`
- Create: `tests/test_analysis_difference.py`
- Modify: `tests/test_analysis_service.py`

Lock in these boundaries:

```python
# backend/app/stego/analysis/common.py
PREVIEW_SIDE = 512

@dataclass(slots=True)
class CarrierAnalysis:
    cover: ImageCover | AudioCover
    channel_names: tuple[str, ...]
    _sequences: dict[int, np.ndarray] = field(default_factory=dict)
    _planes: dict[tuple[int, int], np.ndarray] = field(default_factory=dict)

    @property
    def channel_count(self) -> int: ...
    def validate_channel(self, channel: int) -> None: ...
    def sequence(self, channel: int) -> np.ndarray: ...       # flat contiguous uint8
    def image_channel(self, channel: int) -> np.ndarray: ...  # H x W; images only
    def bit_plane(self, channel: int, bit: int) -> np.ndarray: ...
    def preview_grid(self, channel: int) -> tuple[np.ndarray, int]: ...

@dataclass(slots=True)
class AnalysisInputs:
    suspect: CarrierAnalysis
    reference: CarrierAnalysis | None

def prepare_inputs(data: bytes, compare_data: bytes | None) -> AnalysisInputs: ...
def png_data_url(array: np.ndarray) -> str: ...
def square_preview(values: np.ndarray) -> tuple[np.ndarray, int]: ...
```

`prepare_inputs` calls `load_cover` exactly once per non-empty supplied byte string and performs the existing same-kind, slot-count, and image-dimension checks. Normalize `compare_data` to no reference when it is `None` or `b""`, preserving the named-empty-upload API behavior characterized in Task 1. `CarrierAnalysis.sequence` returns `rgb[:, :, channel]` flattened for images and `slots[channel::channels]` for audio. `preview_grid` preserves current image spatial layout and audio square layout, with each side at most `PREVIEW_SIDE`.

Analyzer interfaces:

```python
# bit_planes.py
def analyse(context: CarrierAnalysis, channel: int) -> dict[str, object]:
    # {"stride": int, "bit_planes": list[str], "lsb_composite": str | None}

# histogram.py
def analyse(context: CarrierAnalysis, channel: int) -> list[list[int]]:
    # all RGB channels for image; selected low-byte sample channel for audio

# difference.py
def analyse(
    suspect: CarrierAnalysis,
    reference: CarrierAnalysis | None,
    preview_stride: int,
) -> dict[str, object] | None: ...

# service.py (temporary signature; BPCS config is added in Task 6)
def analyse(data: bytes, compare_data: bytes | None = None, channel: int = 0) -> dict[str, object]: ...
```

`analysis/__init__.py` is the stable facade. During this safe refactor, move the existing Chi-Square functions unchanged into `chi_square.py` and export them immediately:

```python
from .chi_square import chi_square_p, gamma_q
from .service import analyse

__all__ = ["analyse", "chi_square_p", "gamma_q"]
```

The two helper exports are retained because `tests/test_workflows.py` already imports them from `backend.app.stego.analysis`; do not add aliases for any other private function.

- [ ] **Step 1: Write failing unit tests for the new package interfaces**

Add tests that import `CarrierAnalysis`, `prepare_inputs`, each analyzer, and `service.analyse`. Assert:

- an RGB channel has shape `(height * width,)` and preserves row-major order;
- an audio channel deinterleaves low-byte sample slots correctly;
- repeated calls to `sequence(0)` and `bit_plane(0, 0)` return the same cached array object;
- previews never exceed 512 rows or columns;
- mismatched comparison kinds and dimensions fail before analyzers run;
- difference counts, MSE, PSNR, changed map, and amplified image match the legacy result;
- identical inputs produce `mse == 0.0` and `psnr_db is None`.

- [ ] **Step 2: Run the package-interface tests to verify red**

Run: `..\..\.venv\Scripts\python.exe -m pytest tests/test_analysis_common.py tests/test_analysis_difference.py -q`

Expected: FAIL during collection with `ModuleNotFoundError: No module named 'backend.app.stego.analysis.common'`.

- [ ] **Step 3: Move the old implementation into the focused files**

Use `apply_patch` to delete the file and create the package. Preserve formulas and image encoding exactly at this stage, including `gamma_q`, `chi_square_p`, and `chi_square_segments`. Avoid a second carrier abstraction: `CarrierAnalysis` wraps the existing `ImageCover`/`AudioCover` from `covers.py` and does not change carrier loading or export code.

In `difference.py`, keep the existing 256-entry popcount lookup but define it once at module scope as `POPCOUNT`. For image difference maps, use the selected preview stride and all RGB channels exactly as today. For audio, use `square_preview` and keep `amplified` as `None`.

- [ ] **Step 4: Run focused modular and characterization tests**

Run: `..\..\.venv\Scripts\python.exe -m pytest tests/test_analysis_common.py tests/test_analysis_difference.py tests/test_analysis_service.py -q`

Expected: PASS with unchanged legacy semantics.

- [ ] **Step 5: Run existing workflow Chi-Square tests after the move**

Run: `..\..\.venv\Scripts\python.exe -m pytest tests/test_workflows.py::test_gamma_q_matches_known_chi_square_values tests/test_workflows.py::test_chi_square_detects_randomised_lsbs -q`

Expected: PASS. The structural commit must not leave the existing helper imports or analysis response broken.

- [ ] **Step 6: Commit the structural split**

```powershell
git add -A backend/app/stego tests/test_analysis_common.py tests/test_analysis_difference.py tests/test_analysis_service.py
git commit -m "refactor: split steganalysis modules"
```

### Task 3: Add rich pairs-of-values Chi-Square results and legacy projections

**Files:**
- Modify: `backend/app/stego/analysis/chi_square.py`
- Create: `tests/test_analysis_chi_square.py`
- Modify: `backend/app/stego/analysis/__init__.py`
- Modify: `backend/app/stego/analysis/service.py`
- Modify: `tests/test_analysis_service.py`

Use these constants and schemas:

```python
SEGMENT_COUNT = 64
MIN_EXPECTED_COUNT = 5.0
PRESENTATION_HEURISTIC = 0.95
METHOD = "westfeld-pfitzmann-pairs-of-values"

def gamma_q(a: float, x: float) -> float: ...
def measure(values: np.ndarray) -> dict[str, object]: ...
def analyse(values: np.ndarray, segments: int = SEGMENT_COUNT) -> dict[str, object]: ...
def chi_square_p(values: np.ndarray) -> float | None:
    return measure(values)["p_value"]
```

Every measurement returned by `measure` has exactly:

```json
{
  "sample_count": 200000,
  "valid_category_count": 87,
  "degrees_of_freedom": 86,
  "statistic": 81.25,
  "p_value": 0.624,
  "interpretable": true,
  "reason": null
}
```

`valid_category_count` means the number of value pairs `(2i, 2i+1)` whose pair mean is at least `MIN_EXPECTED_COUNT`; the historical degrees-of-freedom rule remains `valid_category_count - 1`. If fewer than two pairs remain, return `degrees_of_freedom`, `statistic`, and `p_value` as `None`, `interpretable` as `False`, and reason `"At least two value pairs with expected count >= 5 are required."`. Do not return a stego verdict.

`analyse` returns exactly:

```json
{
  "method": "westfeld-pfitzmann-pairs-of-values",
  "pair_count": 128,
  "minimum_expected_count": 5.0,
  "segment_count": 64,
  "presentation_heuristic": 0.95,
  "descriptive_only": true,
  "explanation": {
    "high_p_value": "A high p-value is consistent with equalised pairs produced by random LSB replacement; it does not prove embedding.",
    "limitations": [
      "Texture or naturally noisy data can equalise pairs.",
      "Flat regions and small samples can violate or weaken the approximation.",
      "Preprocessing can alter the histogram independently of embedding.",
      "Embedding methods other than LSB replacement may not produce this pattern."
    ]
  },
  "overall": {"...": "measurement fields"},
  "segments": [
    {"index": 0, "start": 0, "end": 3125, "...": "measurement fields"}
  ]
}
```

Segment bounds come from `np.linspace(0, len(values), segments + 1).astype(np.int64)`, preserving the current embedding-order segmentation. The service adds `chi_square_details` with this object and derives compatibility fields only from it:

```python
result["chi_square"] = [segment["p_value"] for segment in details["segments"]]
result["chi_square_overall"] = details["overall"]["p_value"]
```

- [ ] **Step 1: Write failing known-value, low-count, and segmentation tests**

Cover the existing `gamma_q` values, the smooth/randomized fixture, a hand-built histogram with two retained pairs, exact statistic/df/sample count, exclusion of pairs with expected count below 5, uninterpretable one-pair input, 64 ordered segment bounds, and the explanatory metadata/heuristic wording.

For the hand-built case, construct values from counts and calculate expected output in the test without calling production helpers:

```python
values = np.repeat(np.arange(6, dtype=np.uint8), [12, 8, 4, 4, 20, 10])
# (0,1) expected 10, (2,3) expected 4 excluded, (4,5) expected 15
expected_statistic = ((12 - 10) ** 2 / 10) + ((20 - 15) ** 2 / 15)
assert result["valid_category_count"] == 2
assert result["degrees_of_freedom"] == 1
assert result["statistic"] == pytest.approx(expected_statistic)
```

- [ ] **Step 2: Run the Chi-Square tests to verify red**

Run: `..\..\.venv\Scripts\python.exe -m pytest tests/test_analysis_chi_square.py tests/test_workflows.py -k "chi_square or gamma_q" -q`

Expected: FAIL because the moved legacy module does not yet expose `measure`, rich `analyse`, or metadata fields.

- [ ] **Step 3: Implement the minimal rich analyzer**

Move `gamma_q` without changing its numerical algorithm. Build one 256-bin `float64` histogram, pair even/odd bins, apply `expected >= 5`, and calculate the existing one-observation-per-pair statistic. Clamp only the gamma result as the old implementation does; do not invent detector thresholds.

- [ ] **Step 4: Project legacy fields in the service**

Call `chi_square.analyse(context.sequence(channel))` once. Add `chi_square_details`; derive both old fields from that result so rich and legacy values cannot diverge.

- [ ] **Step 5: Run focused and regression tests**

Run: `..\..\.venv\Scripts\python.exe -m pytest tests/test_analysis_chi_square.py tests/test_analysis_service.py tests/test_workflows.py -k "analysis or chi_square or gamma_q" -q`

Expected: PASS; existing callers still receive 64 nullable p-values and one nullable overall p-value.

- [ ] **Step 6: Commit the Chi-Square contract**

```powershell
git add backend/app/stego/analysis/chi_square.py backend/app/stego/analysis/__init__.py backend/app/stego/analysis/service.py tests/test_analysis_chi_square.py tests/test_analysis_service.py
git commit -m "feat: describe chi-square analysis results"
```

## Chunk 2: BPCS, assembly, API validation, and timing

### Task 4: Define central BPCS defaults and valid-adjacency edge behavior

**Files:**
- Create: `backend/app/stego/analysis/bpcs.py`
- Create: `tests/test_analysis_bpcs.py`

The backend constants are authoritative:

```python
DEFAULT_CHANNEL = 0
DEFAULT_BLOCK_SIZE = 8
DEFAULT_BIT_PLANE_START = 0
DEFAULT_BIT_PLANE_END = 7
DEFAULT_COMPLEXITY_THRESHOLD = 0.30
ALLOWED_BLOCK_SIZES = (2, 4, 8, 16, 32, 64)
MAP_SIDE_LIMIT = 512
PARTIAL_BLOCK_POLICY = "include-valid-adjacencies"

@dataclass(frozen=True, slots=True)
class BPCSConfig:
    channel: int = DEFAULT_CHANNEL
    block_size: int = DEFAULT_BLOCK_SIZE
    bit_plane_start: int = DEFAULT_BIT_PLANE_START
    bit_plane_end: int = DEFAULT_BIT_PLANE_END
    complexity_threshold: float = DEFAULT_COMPLEXITY_THRESHOLD

    @classmethod
    def from_values(
        cls,
        channel: object = None,
        block_size: object = None,
        bit_plane_start: object = None,
        bit_plane_end: object = None,
        complexity_threshold: object = None,
    ) -> "BPCSConfig": ...

    def as_dict(self) -> dict[str, int | float | str]: ...

def block_complexities(plane: np.ndarray, block_size: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]: ...
```

`as_dict()` returns all five user values plus `partial_block_policy`. Parse omitted/blank values as defaults. Reject booleans, fractional integer text, NaN, and infinities. Use these exact validation rules and messages:

| Field | Rule | `ValueError` message |
| --- | --- | --- |
| `channel` | integer 0..2 | `BPCS channel must be a whole number from 0 through 2.` |
| `block_size` | one of 2, 4, 8, 16, 32, 64 | `BPCS block size must be one of 2, 4, 8, 16, 32, or 64.` |
| either plane | integer 0..7 | `BPCS bit planes must be whole numbers from 0 through 7.` |
| plane range | start <= end | `BPCS first bit plane must not exceed the last bit plane.` |
| threshold | finite float 0..1 inclusive | `BPCS complexity threshold must be a number from 0 through 1.` |

Partial blocks are not discarded and synthetic padding must not affect statistics. Partition with ceiling division. An edge block uses its actual `h x w` valid pixels and:

```text
transitions = count(B[:, 1:] != B[:, :-1]) + count(B[1:, :] != B[:-1, :])
possible = h * (w - 1) + (h - 1) * w
complexity = transitions / possible, or 0.0 when possible == 0
complex = complexity >= threshold
```

Implementation may edge-pad once for vectorized reshaping, but must apply valid horizontal/vertical masks so padded cells and padded adjacencies contribute neither transitions nor denominator. `block_complexities` returns matrices `(complexity, transition_count, possible_transition_count)` in block-row/block-column order.

- [ ] **Step 1: Write failing default and validation tests**

Assert `BPCSConfig.from_values().as_dict()` returns the exact defaults and policy. Parameterize every invalid field and exact message. Include `"8.0"`, `True`, `float("nan")`, `float("inf")`, reversed planes, and blank strings.

- [ ] **Step 2: Write failing known-pattern complexity tests**

Use:

```python
zeros = np.zeros((8, 8), dtype=np.uint8)                    # complexity 0
checker = np.indices((8, 8)).sum(axis=0).astype(np.uint8)   # complexity 1
stripes = np.tile(np.arange(8) % 2, (8, 1)).astype(np.uint8)  # 56 / 112 = 0.5
```

Add a `3 x 2` checkerboard partial block and assert transitions `7`, possible `7`, complexity `1.0`. Add a `1 x 1` edge block and assert `0/0` is represented as complexity `0.0`, not NaN. Add a regression where padded edge values would create transitions if unmasked and assert they do not.

- [ ] **Step 3: Run BPCS core tests to verify red**

Run: `..\..\.venv\Scripts\python.exe -m pytest tests/test_analysis_bpcs.py -k "config or complexity or partial" -q`

Expected: FAIL because `analysis.bpcs` is missing.

- [ ] **Step 4: Implement config parsing and the minimal correct kernel**

Prefer direct per-block code first if that makes the edge policy obvious. Correctness precedes optimization; Task 13 converts the proven kernel to batched NumPy while retaining these tests.

- [ ] **Step 5: Run BPCS core tests**

Run: `..\..\.venv\Scripts\python.exe -m pytest tests/test_analysis_bpcs.py -k "config or complexity or partial" -q`

Expected: PASS with exact transition counts and no discarded edge blocks.

- [ ] **Step 6: Commit central config and complexity behavior**

```powershell
git add backend/app/stego/analysis/bpcs.py tests/test_analysis_bpcs.py
git commit -m "feat: define bpcs complexity analysis"
```

### Task 5: Add BPCS maps, summaries, capacity, and descriptive comparison

**Files:**
- Modify: `backend/app/stego/analysis/bpcs.py`
- Modify: `tests/test_analysis_bpcs.py`

Add the public analyzer:

```python
def analyse(
    suspect: CarrierAnalysis,
    reference: CarrierAnalysis | None,
    config: BPCSConfig,
) -> dict[str, object]: ...
```

For audio, return exactly this shape without calling `image_channel` or generating maps:

```json
{
  "supported": false,
  "reason": "BPCS analysis is available only for image inputs.",
  "config": {"channel": 0, "block_size": 8, "bit_plane_start": 0, "bit_plane_end": 7, "complexity_threshold": 0.3, "partial_block_policy": "include-valid-adjacencies"},
  "image": null,
  "planes": [],
  "summary": null,
  "comparison": null
}
```

For images, return the complete supported envelope below. `config` is always the exact validated/applied configuration, `planes` are in ascending bit order, and `comparison` is `null` unless a matching reference was supplied:

```json
{
  "supported": true,
  "reason": null,
  "config": {"channel": 0, "block_size": 4, "bit_plane_start": 0, "bit_plane_end": 0, "complexity_threshold": 0.3, "partial_block_policy": "include-valid-adjacencies"},
  "image": {"width": 6, "height": 6},
  "planes": [
    {
      "bit_plane": 0,
      "block_rows": 2,
      "block_columns": 2,
      "block_count": 4,
      "complex_blocks": 4,
      "non_complex_blocks": 0,
      "complex_percent": 100.0,
      "transition_count": 48,
      "possible_transition_count": 48,
      "transition_ratio": 1.0,
      "mean_complexity": 1.0,
      "minimum_complexity": 1.0,
      "maximum_complexity": 1.0,
      "capacity_bits": 36,
      "capacity_bytes_floor": 4,
      "capacity_remainder_bits": 4,
      "complexity_map": "data:image/png;base64,...",
      "classification_map": "data:image/png;base64,...",
      "map_rows": 2,
      "map_columns": 2,
      "map_block_stride": 1
    }
  ],
  "summary": {
    "selected_plane_count": 1,
    "block_count": 4,
    "complex_blocks": 4,
    "non_complex_blocks": 0,
    "complex_percent": 100.0,
    "transition_count": 48,
    "possible_transition_count": 48,
    "transition_ratio": 1.0,
    "mean_complexity": 1.0,
    "minimum_complexity": 1.0,
    "maximum_complexity": 1.0,
    "capacity_bits": 36,
    "capacity_bytes_floor": 4,
    "capacity_remainder_bits": 4
  },
  "comparison": null
}
```

Each populated plane has:

```json
{
  "bit_plane": 0,
  "block_rows": 2,
  "block_columns": 2,
  "block_count": 4,
  "complex_blocks": 3,
  "non_complex_blocks": 1,
  "complex_percent": 75.0,
  "transition_count": 98,
  "possible_transition_count": 120,
  "transition_ratio": 0.8166666667,
  "mean_complexity": 0.79,
  "minimum_complexity": 0.4,
  "maximum_complexity": 1.0,
  "capacity_bits": 36,
  "capacity_bytes_floor": 4,
  "capacity_remainder_bits": 4,
  "complexity_map": "data:image/png;base64,...",
  "classification_map": "data:image/png;base64,...",
  "map_rows": 2,
  "map_columns": 2,
  "map_block_stride": 1
}
```

Map rules:

- Encode complexity as 8-bit grayscale `round(complexity * 255)`.
- Encode classification as 255 for complex and 0 for non-complex.
- Maps have one pixel per sampled block and preserve block-row/block-column layout.
- Set `map_block_stride = max(1, ceil(max(block_rows, block_columns) / 512))` and sample both axes with `[::map_block_stride]` before PNG encoding.
- `map_rows` and `map_columns` describe encoded dimensions and are each <= 512. Full-resolution counts and capacity always use every block.

Capacity is theoretical payload space in the selected channel/plane only. A complex block contributes its actual valid pixel count, including partial blocks but excluding padded cells. For each plane and the all-plane summary:

```text
capacity_bits = sum(valid_pixel_count for each complex block)
capacity_bytes_floor = capacity_bits // 8
capacity_remainder_bits = capacity_bits % 8
```

Document that framing, metadata, error correction, and any conjugation map are not deducted; this phase analyzes BPCS and does not implement BPCS embedding.

The summary adds `selected_plane_count` and repeats aggregate `block_count`, complex/non-complex counts and percentage, transitions/possible/ratio, mean/min/max across all selected block complexities, and capacity fields. Do not average per-plane percentages to obtain aggregate percentage; calculate from aggregate counts.

When a matching image reference is present, return descriptive suspect-minus-reference data:

```json
{
  "summary": {
    "changed_blocks": 2,
    "classification_flips": 1,
    "flips_to_complex": 1,
    "flips_to_non_complex": 0,
    "mean_complexity_delta": 0.04,
    "mean_absolute_complexity_delta": 0.06,
    "capacity_bits_delta": 8,
    "capacity_bytes_floor_delta": 1
  },
  "planes": [
    {
      "bit_plane": 0,
      "changed_blocks": 2,
      "classification_flips": 1,
      "flips_to_complex": 1,
      "flips_to_non_complex": 0,
      "mean_complexity_delta": 0.04,
      "mean_absolute_complexity_delta": 0.06,
      "capacity_bits_delta": 8,
      "capacity_bytes_floor_delta": 1
    }
  ]
}
```

Definitions:

- A changed block has at least one different valid bit in that bit plane.
- A classification flip crosses the inclusive `complexity >= threshold` boundary.
- `flips_to_complex` and `flips_to_non_complex` use reference -> suspect direction.
- `mean_complexity_delta` is mean `(suspect - reference)` over blocks; the summary mean is over every selected block, not a mean of rounded plane means.
- `capacity_bits_delta` is suspect minus reference. `capacity_bytes_floor_delta` is `suspect_total_bits // 8 - reference_total_bits // 8` at the relevant plane/summary scope.
- No field may be named `detected`, `suspicious`, `verdict`, or otherwise imply a binary classifier.

- [ ] **Step 1: Write failing map-bound and capacity tests**

Create an RGB image whose selected channel/plane is a `6 x 6` checkerboard and use block size 4 with one selected plane. Assert the complete envelope has `supported is True`, `reason is None`, the exact applied config, exact image dimensions, populated planes/summary, and `comparison is None`. Assert four complex partial/full blocks, `capacity_bits == 36`, `capacity_bytes_floor == 4`, and remainder 4. Decode both map data URLs with Pillow and verify their pixel values and dimensions.

Create a `1025 x 1025` plane with block size 2; assert full block grid `513 x 513`, encoded map `257 x 257`, stride 2, and no response-side raw complexity matrix.

- [ ] **Step 2: Write failing comparison tests**

Use small reference/suspect arrays that produce one unchanged block, one changed block without a threshold crossing, and one changed block with a crossing. Assert exact direction, signed/absolute complexity deltas, flips, and capacity deltas. Assert `comparison is None` when no reference is supplied.

- [ ] **Step 3: Write the failing audio unsupported test**

Build stereo WAV input, call `analyse`, and assert the exact unsupported shape, reason, returned config, empty planes, and no maps. Monkeypatch `CarrierAnalysis.image_channel` to raise if called so the test proves image-only work is skipped.

- [ ] **Step 4: Run result tests to verify red**

Run: `..\..\.venv\Scripts\python.exe -m pytest tests/test_analysis_bpcs.py -k "map or capacity or comparison or audio" -q`

Expected: FAIL because the public analyzer/results are not implemented.

- [ ] **Step 5: Implement result assembly minimally**

Reuse `common.png_data_url`. Keep full complexity/classification arrays local; expose only bounded PNG maps and scalar summaries. Compute reference data only when present. Do not add BPCS embedding helpers.

- [ ] **Step 6: Run all BPCS tests**

Run: `..\..\.venv\Scripts\python.exe -m pytest tests/test_analysis_bpcs.py -q`

Expected: PASS, including edge, bounds, capacity, comparison, and audio behavior.

- [ ] **Step 7: Commit complete BPCS results**

```powershell
git add backend/app/stego/analysis/bpcs.py tests/test_analysis_bpcs.py
git commit -m "feat: report bpcs maps and capacity"
```

### Task 6: Assemble modular results and per-analyzer durations

**Files:**
- Modify: `backend/app/stego/analysis/service.py`
- Modify: `tests/test_analysis_service.py`

Change the public service signature to:

```python
def analyse(
    data: bytes,
    compare_data: bytes | None = None,
    channel: int = 0,
    bpcs_config: BPCSConfig | None = None,
) -> dict[str, object]: ...
```

`None` means `BPCSConfig()`; callers do not pass five loose BPCS values below the endpoint. Assemble all old fields plus:

```json
{
  "chi_square_details": {"...": "Task 3 schema"},
  "bpcs": {"...": "Task 5 schema"},
  "durations_ms": {
    "load": 1.234,
    "bit_planes": 2.345,
    "histogram": 0.456,
    "chi_square": 4.567,
    "bpcs": 3.456,
    "difference": 1.111,
    "total": 13.169
  }
}
```

Use `time.perf_counter()` and round milliseconds to three decimals only when serializing. Always include all seven keys. `load` includes both carriers and comparison validation. Time the audio unsupported BPCS branch normally; do not report fabricated zero. `total` spans the whole service call and can be slightly larger than the sum due to assembly/rounding. Durations are observability data, never correctness or authenticity evidence.

- [ ] **Step 1: Write failing assembly and timing tests**

Assert default BPCS config appears in an image response, audio returns unsupported, rich/legacy Chi-Square values agree, comparison remains present, exact duration keys exist, every value is finite/non-negative, and `total` is at least each individual duration. Do not assert a millisecond ceiling or exact ordering.

- [ ] **Step 2: Run service tests to verify red**

Run: `..\..\.venv\Scripts\python.exe -m pytest tests/test_analysis_service.py -q`

Expected: FAIL on missing `bpcs`, `chi_square_details`, and `durations_ms` fields.

- [ ] **Step 3: Implement timed orchestration**

Keep orchestration in `service.py`; analyzer modules must not import the service. Build `AnalysisInputs` once, validate the existing visual/statistical `channel`, then call analyzers in this order: bit planes, histogram, Chi-Square, BPCS, difference. The result order does not affect JSON semantics but keeps timings and benchmark output repeatable.

- [ ] **Step 4: Run service and analyzer suites**

Run: `..\..\.venv\Scripts\python.exe -m pytest tests/test_analysis_common.py tests/test_analysis_chi_square.py tests/test_analysis_bpcs.py tests/test_analysis_difference.py tests/test_analysis_service.py -q`

Expected: PASS.

- [ ] **Step 5: Commit service assembly and timing**

```powershell
git add backend/app/stego/analysis/service.py tests/test_analysis_service.py
git commit -m "feat: assemble timed modular analysis"
```

### Task 7: Add optional BPCS form fields with clear 400 responses

**Files:**
- Modify: `backend/app/main.py:17,251-259`
- Modify: `tests/test_api.py`

Preserve `file`, `compare`, and `channel` exactly. Add optional raw strings so malformed multipart values reach central BPCS validation and produce 400 rather than FastAPI's generated 422:

```python
@app.post("/api/analyse")
async def analyse(
    file: UploadFile = File(...),
    compare: UploadFile | None = File(None),
    channel: int = Form(0),
    bpcs_channel: str | None = Form(None),
    bpcs_block_size: str | None = Form(None),
    bpcs_bit_plane_start: str | None = Form(None),
    bpcs_bit_plane_end: str | None = Form(None),
    bpcs_complexity_threshold: str | None = Form(None),
):
    ...
```

Keep upload reads outside the CPU worker, but place both central BPCS parsing and the worker call inside the existing `ValueError` to 400 boundary:

```python
try:
    config = BPCSConfig.from_values(
        bpcs_channel,
        bpcs_block_size,
        bpcs_bit_plane_start,
        bpcs_bit_plane_end,
        bpcs_complexity_threshold,
    )
    return await run_in_threadpool(analysis.analyse, data, other, channel, config)
except ValueError as exc:
    raise _bad_request(exc)
```

This retains the CPU-heavy boundary around carrier loading and all analyzers while guaranteeing malformed-but-string BPCS values use the same clear 400 path as analyzer validation. Do not move `channel` to raw-string parsing: legacy malformed `channel` remains FastAPI 422 as characterized in Task 1.

- [ ] **Step 1: Add failing omitted/default and custom-parameter API tests**

Post the existing request with no BPCS fields and assert 200 plus exact central defaults. Post an image with all fields, including channel 2, block size 4, planes 1..3, threshold 0.45; assert the returned config and planes `[1, 2, 3]`.

- [ ] **Step 2: Add failing 400 validation tests**

Parameterize malformed, out-of-range, non-finite, and reversed form values. Assert status 400 and the exact Task 4 message in `response.json()["detail"]`, proving `BPCSConfig.from_values` is inside the `try`. Re-run the four legacy status cases from Task 1 after adding BPCS forms. Add one audio request with valid custom BPCS fields and assert 200 plus unsupported BPCS and returned reproducibility config.

- [ ] **Step 3: Run endpoint tests to verify red**

Run: `..\..\.venv\Scripts\python.exe -m pytest tests/test_api.py -k analyse -q`

Expected: FAIL because the endpoint ignores BPCS fields/new response assertions are absent.

- [ ] **Step 4: Implement endpoint parsing and service call**

Import `BPCSConfig` from `.stego.analysis.bpcs`. Do not duplicate defaults or range checks in `main.py`.

- [ ] **Step 5: Run endpoint and compatibility tests**

Run: `..\..\.venv\Scripts\python.exe -m pytest tests/test_api.py tests/test_analysis_service.py -q`

Expected: PASS. Existing requests remain 200 and retain legacy fields; invalid BPCS values are clear 400 responses.

- [ ] **Step 6: Commit the endpoint extension**

```powershell
git add backend/app/main.py tests/test_api.py
git commit -m "feat: accept validated bpcs analysis options"
```

## Chunk 3: Typed Operate-mode frontend expansion

### Task 8: Add a focused frontend component-test harness

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Modify: `frontend/tsconfig.json`
- Create: `frontend/vitest.config.ts`
- Create: `frontend/src/test/setup.ts`
- Create: `frontend/src/pages/analyse/fixtures.ts`

Use versions compatible with the repository's stated Node 20.19+ floor:

```powershell
npm --prefix frontend install --save-dev --save-exact vitest@4.0.17 jsdom@27.0.1 @testing-library/react@16.3.3 @testing-library/dom@10.4.2 @testing-library/user-event@14.6.7 @testing-library/jest-dom@6.9.1
```

Add scripts:

```json
"test": "vitest run",
"test:watch": "vitest"
```

Configure `environment: "jsdom"`, `setupFiles: ["./src/test/setup.ts"]`, `restoreMocks: true`, and `globals: false`. Import `@testing-library/jest-dom/vitest` in setup. Do not add `vitest/globals` to `tsconfig.json`; every test explicitly imports `describe`, `it`/`test`, `expect`, `vi`, and lifecycle functions from `vitest`. Add only `vitest.config.ts` to the TypeScript include list.

`fixtures.ts` exports complete typed image and audio `Analysis` values matching Tasks 3, 5, and 6. Use one-pixel data URLs; tests should inspect labels/state, not image rendering.

- [ ] **Step 1: Install exact test dependencies and scripts**

Run the install command above, edit scripts with `apply_patch`, and retain lockfile changes. Do not replace Vite or React versions.

- [ ] **Step 2: Add config, setup, and a smoke test**

Create `frontend/src/test/setup.ts` and a temporary `frontend/src/pages/analyse/harness.test.tsx` that explicitly imports `{ expect, test }` from `vitest`, renders `<Stat label="Blocks" value="4" />`, and finds both strings.

- [ ] **Step 3: Run the harness test**

Run: `npm --prefix frontend test -- src/pages/analyse/harness.test.tsx`

Expected: one passing test. npm runs Vitest with `frontend` as its package root, so all later focused frontend paths use `src/...`.

- [ ] **Step 4: Add complete fixtures and remove the temporary test**

Fixtures must satisfy strict TypeScript without `as unknown as Analysis`. Include both legacy fields even though new UI sections will read rich objects.

- [ ] **Step 5: Run typecheck/build**

Run: `npm --prefix frontend run build`

Expected: TypeScript and Vite production build PASS. The planning baseline already passed this command with Vite 8.3.0.

- [ ] **Step 6: Commit the test harness**

```powershell
git add frontend/package.json frontend/package-lock.json frontend/tsconfig.json frontend/vitest.config.ts frontend/src/test frontend/src/pages/analyse/fixtures.ts
git commit -m "test: add analysis component harness"
```

### Task 9: Add precise shared API result types and request defaults

**Files:**
- Modify: `frontend/src/api.ts:127-146`
- Create: `frontend/src/pages/analyse/model.ts`
- Create: `frontend/src/pages/analyse/model.test.ts`

Replace the inline analysis children with named interfaces that exactly mirror the backend:

```typescript
export interface ChiSquareMeasurement {
  sample_count: number;
  valid_category_count: number;
  degrees_of_freedom: number | null;
  statistic: number | null;
  p_value: number | null;
  interpretable: boolean;
  reason: string | null;
}

export interface ChiSquareSegment extends ChiSquareMeasurement {
  index: number;
  start: number;
  end: number;
}

export interface ChiSquareDetails {
  method: "westfeld-pfitzmann-pairs-of-values";
  pair_count: 128;
  minimum_expected_count: number;
  segment_count: number;
  presentation_heuristic: number;
  descriptive_only: true;
  explanation: { high_p_value: string; limitations: string[] };
  overall: ChiSquareMeasurement;
  segments: ChiSquareSegment[];
}

export interface BpcsConfig {
  channel: number;
  block_size: number;
  bit_plane_start: number;
  bit_plane_end: number;
  complexity_threshold: number;
  partial_block_policy: "include-valid-adjacencies";
}
```

Define the remaining response contract explicitly:

```typescript
export interface BpcsMetrics {
  block_count: number;
  complex_blocks: number;
  non_complex_blocks: number;
  complex_percent: number;
  transition_count: number;
  possible_transition_count: number;
  transition_ratio: number;
  mean_complexity: number;
  minimum_complexity: number;
  maximum_complexity: number;
  capacity_bits: number;
  capacity_bytes_floor: number;
  capacity_remainder_bits: number;
}

export interface BpcsPlane extends BpcsMetrics {
  bit_plane: number;
  block_rows: number;
  block_columns: number;
  complexity_map: string;
  classification_map: string;
  map_rows: number;
  map_columns: number;
  map_block_stride: number;
}

export interface BpcsSummary extends BpcsMetrics {
  selected_plane_count: number;
}

export interface BpcsComparisonMetrics {
  changed_blocks: number;
  classification_flips: number;
  flips_to_complex: number;
  flips_to_non_complex: number;
  mean_complexity_delta: number;
  mean_absolute_complexity_delta: number;
  capacity_bits_delta: number;
  capacity_bytes_floor_delta: number;
}

export interface BpcsComparisonPlane extends BpcsComparisonMetrics {
  bit_plane: number;
}

export interface BpcsComparison {
  summary: BpcsComparisonMetrics;
  planes: BpcsComparisonPlane[];
}

export type BpcsResult =
  | {
      supported: true;
      reason: null;
      config: BpcsConfig;
      image: { width: number; height: number };
      planes: BpcsPlane[];
      summary: BpcsSummary;
      comparison: BpcsComparison | null;
    }
  | {
      supported: false;
      reason: string;
      config: BpcsConfig;
      image: null;
      planes: [];
      summary: null;
      comparison: null;
    };

export interface AnalysisDurations {
  load: number;
  bit_planes: number;
  histogram: number;
  chi_square: number;
  bpcs: number;
  difference: number;
  total: number;
}

export interface AnalysisComparison {
  slots_changed: number;
  bits_changed: number;
  max_difference: number;
  psnr_db: number | null;
  mse: number;
  changed_map: string;
  amplified: string | null;
}

export interface Analysis {
  info: CoverInfo;
  channel: number;
  channel_names: string[];
  stride: number;
  bit_planes: string[];
  /** @deprecated Use chi_square_details.segments. */
  chi_square: (number | null)[];
  /** @deprecated Use chi_square_details.overall.p_value. */
  chi_square_overall: number | null;
  chi_square_details: ChiSquareDetails;
  histograms: number[][];
  lsb_composite: string | null;
  compare: AnalysisComparison | null;
  bpcs: BpcsResult;
  durations_ms: AnalysisDurations;
}
```

Do not consume the deprecated compatibility fields in new UI code.

In `model.ts` define draft strings to preserve user input and enable client validation:

```typescript
export const DEFAULT_BPCS_FORM = {
  channel: "0",
  blockSize: "8",
  bitPlaneStart: "0",
  bitPlaneEnd: "7",
  complexityThreshold: "0.3",
} as const;

export type BpcsForm = {
  channel: string;
  blockSize: string;
  bitPlaneStart: string;
  bitPlaneEnd: string;
  complexityThreshold: string;
};

export type SectionState<T> =
  | { status: "empty"; data: null; message: string }
  | { status: "loading"; data: T | null; message: string }
  | { status: "error"; data: T | null; message: string }
  | { status: "data"; data: T; message: null };

export function validateBpcsForm(form: BpcsForm): string;
export function appendBpcsForm(data: FormData, form: BpcsForm): void;
export function formFromConfig(config: BpcsConfig): BpcsForm;
export function sectionState<T>(options: {
  data: T | null;
  busy: boolean;
  error: string;
  emptyMessage: string;
}): SectionState<T>;
```

The frontend defaults mirror the authoritative backend defaults for initial display; every completed response renders the backend-returned applied config, so reproducibility never depends on the mirror. `validateBpcsForm` applies the same ranges/options and returns the backend wording, or `""`. `appendBpcsForm` uses exact keys `bpcs_channel`, `bpcs_block_size`, `bpcs_bit_plane_start`, `bpcs_bit_plane_end`, and `bpcs_complexity_threshold`. `sectionState` returns `loading` before checking `error`, then `error`, then `data`, then `empty`; both loading and error preserve prior data when supplied.

Use this state contract consistently:

| Section | Empty | Loading | Error | Data / special data |
| --- | --- | --- | --- | --- |
| Bit planes | `Run analysis to view bit planes.` | First load shows `Analysing bit planes...`; rerun retains prior planes under `Refreshing bit planes...` | Show request error; retain prior planes when available | Eight planes and channel controls |
| BPCS | `Run analysis to inspect image BPCS complexity.` | First load shows `Analysing BPCS...`; rerun retains prior BPCS result under `Refreshing BPCS...` | Show request error; retain prior BPCS result | Supported image result or explicit unsupported-audio result |
| Chi-Square | `Run analysis to calculate pairs-of-values statistics.` | First load shows `Calculating Chi-Square statistics...`; rerun retains prior statistics under `Refreshing Chi-Square statistics...` | Show request error; retain prior statistics | Rich overall/segment result, including uninterpretable measurements |
| Histogram | `Run analysis to view value histograms.` | First load shows `Calculating histograms...`; rerun retains prior histogram under `Refreshing histograms...` | Show request error; retain prior histogram | Histogram and optional image composite |
| Difference | `Add a matching original cover to calculate changed values and difference maps.` | First comparison load shows `Calculating differences...`; rerun retains prior comparison under `Refreshing differences...` | Show request error; retain prior comparison when available | Comparison maps/statistics; successful no-reference response remains empty |
| Analysis timing | `Run analysis to measure analyzer durations.` | First load shows `Measuring analysis durations...`; rerun retains prior timings under `Refreshing analysis timings...` | Show request error; retain prior timings | Seven measured duration values |

`empty` is not an error. `loading` with data means stale data is visibly labelled `Refreshing`; `error` with data means stale data remains visible below `Last successful result; rerun failed.`. These states are local render contracts over one shared endpoint response, not separate network requests.

- [ ] **Step 1: Write failing model tests**

Assert defaults, all exact form keys, valid custom values, invalid/reversed fields, no append on invalid input, backend-config conversion, and every `SectionState` branch both with and without prior data. Use a real jsdom `FormData`. Explicitly import all Vitest APIs.

- [ ] **Step 2: Run model tests to verify red**

Run: `npm --prefix frontend test -- src/pages/analyse/model.test.ts`

Expected: FAIL because `model.ts` does not exist.

- [ ] **Step 3: Add named API interfaces and model helpers**

Keep interfaces in `api.ts` because it is the existing shared API contract. Keep only page-local draft/validation behavior in `pages/analyse/model.ts`.

- [ ] **Step 4: Run model tests and build**

Run: `npm --prefix frontend test -- src/pages/analyse/model.test.ts`

Expected: PASS.

Run: `npm --prefix frontend run build`

Expected: PASS with strict types.

- [ ] **Step 5: Commit types and form model**

```powershell
git add frontend/src/api.ts frontend/src/pages/analyse/model.ts frontend/src/pages/analyse/model.test.ts
git commit -m "feat: type modular analysis results"
```

### Task 10: Split presentational analysis sections without changing visual language

**Files:**
- Create: `frontend/src/pages/analyse/BitPlanesSection.tsx`
- Create: `frontend/src/pages/analyse/BpcsSection.tsx`
- Create: `frontend/src/pages/analyse/ChiSquareSection.tsx`
- Create: `frontend/src/pages/analyse/HistogramSection.tsx`
- Create: `frontend/src/pages/analyse/DifferenceSection.tsx`
- Create: `frontend/src/pages/analyse/AnalysisTiming.tsx`
- Create: `frontend/src/pages/analyse/sections.test.tsx`
- Modify: `frontend/src/components.tsx:411-437`
- Modify: `frontend/src/styles.css:297-327`

Each result section accepts the applicable `SectionState<T>`, wraps one existing `Panel` in an element with `aria-busy={state.status === "loading"}`, and remains presentational. Keep network/file state in `AnalysePage`. A shared small renderer inside each file (do not add a generic abstraction until duplication proves useful) handles its empty/loading/error note and renders retained data beneath refreshing/error notes.

Required section behavior:

- `BitPlanesSection`: preserve current bit ordering, captions, selected-channel text, audio square-layout note, and channel buttons supplied via props.
- `BpcsSection`: for images show applied config, per-plane maps, aggregate counts/percent, transitions, and capacity as `N bits (M whole bytes + R bits)`; label capacity `Theoretical capacity`. Show comparison deltas only when present and say `Descriptive comparison only; no detector verdict.`
- `BpcsSection`: for audio show the exact backend unsupported reason in a `note note-warn`; render no map `<img>` elements.
- `ChiSquareSection`: consume `chi_square_details`, pass rich segments to `ChiStrip`, show sample count, valid categories, statistic, p-value, and interpretable-segment count. Label `p >= 0.95` as `presentation heuristic`, print the backend high-p explanation, and list all limitations. Never label a segment/file `embedded` or `natural`.
- `HistogramSection`: preserve histogram and image-only LSB composite.
- `DifferenceSection`: always render. With no reference, show an empty state: `Add a matching original cover to calculate changed values and difference maps.` With comparison, preserve all existing values/maps.
- `AnalysisTiming`: render one closed `<details className="advanced analysis-timing">` labelled `Analysis timings`, listing every `durations_ms` value. State `Measured on this run; timings are not a detection result.`

Change `ChiStrip` to accept `ChiSquareSegment[]`. Tooltips include segment number, sample count, valid categories, and either p-value or reason. Colors may continue to use teal/amber/coral, but accessible text must explain that they are descriptive ranges and 0.95 is only a display heuristic.

CSS additions must reuse `--teal`, `--coral`, `--amber`, surfaces, borders, radius, and existing `.stats`, `.planes`, `.note`, and `.panel` patterns. Add only analysis-specific grid/map/empty/timing rules. At <=1100px use two map columns; at <=800px use one. Do not change root palette, rail, typography, global panel shape, or unrelated pages.

- [ ] **Step 1: Write failing section tests**

With image and audio fixtures, assert:

- every section's applicable empty, first-load loading, refresh-with-data loading, first-error, error-with-retained-data, and data states from the Task 9 table;
- image BPCS config, capacity units, maps, and descriptive comparison text;
- audio unsupported reason and absence of BPCS map images;
- Chi-Square heuristic wording, rich statistics, low-count reason, and all limitation strings;
- no-reference difference empty state and compared difference statistics;
- timing details and all analyzer labels;
- `aria-busy="true"` during rerun.

- [ ] **Step 2: Run section tests to verify red**

Run: `npm --prefix frontend test -- src/pages/analyse/sections.test.tsx`

Expected: FAIL because section modules do not exist.

- [ ] **Step 3: Extract existing bit-plane, histogram, and difference markup**

Move markup without changing behavior first. Run the section tests after each extraction so errors stay local.

- [ ] **Step 4: Implement BPCS, rich Chi-Square, timing, and empty states**

Use semantic headings/figures, explicit `alt` text (`Bit 0 complexity map`, `Bit 0 complex-block classification map`), and existing `Stat`/`Panel` primitives. Do not introduce charts or a new component library.

- [ ] **Step 5: Add scoped responsive styles**

Use classes under `.bpcs-*`, `.analysis-empty`, and `.analysis-timing`. Ensure long explanations wrap and map images use `image-rendering: pixelated` with the existing technical border treatment.

- [ ] **Step 6: Run section tests and production build**

Run: `npm --prefix frontend test -- src/pages/analyse/sections.test.tsx`

Expected: PASS.

Run: `npm --prefix frontend run build`

Expected: PASS; no unrelated page type or CSS regressions.

- [ ] **Step 7: Commit section extraction and styles**

```powershell
git add frontend/src/pages/analyse frontend/src/components.tsx frontend/src/styles.css
git commit -m "feat: present modular steganalysis sections"
```

### Task 11: Wire controls, reruns, branching, and independent error states

**Files:**
- Modify: `frontend/src/pages/AnalysePage.tsx`
- Create: `frontend/src/pages/analyse/AnalysePage.test.tsx`

Keep these states in the page coordinator:

```typescript
const [suspect, setSuspect] = useState<File | null>(null);
const [reference, setReference] = useState<File | null>(null);
const [channel, setChannel] = useState(0);
const [bpcsDraft, setBpcsDraft] = useState<BpcsForm>({ ...DEFAULT_BPCS_FORM });
const [appliedBpcs, setAppliedBpcs] = useState<BpcsForm>({ ...DEFAULT_BPCS_FORM });
const [bpcsError, setBpcsError] = useState("");
const [busy, setBusy] = useState(false);
const [error, setError] = useState("");
const [result, setResult] = useState<Analysis | null>(null);
const requestGeneration = useRef(0);
```

`bpcsDraft` is editable and may be invalid; `appliedBpcs` is the last backend-confirmed valid configuration. Main Analyse and visual/statistical channel changes call `run(selectedChannel, appliedBpcs)` without inspecting the draft. Only `applyBpcs` validates `bpcsDraft`; a valid candidate is sent to `run`, and `setAppliedBpcs(formFromConfig(next.bpcs.config))` occurs only after that generation succeeds. Therefore invalid unapplied edits never block channel reruns and failed Apply requests do not replace the last successful settings.

Use a monotonic generation token rather than changing the shared `DropZone` API:

```typescript
async function run(selectedChannel = channel, settings = appliedBpcs) {
  if (!suspect) return;
  const generation = ++requestGeneration.current;
  const selectedSuspect = suspect;
  const selectedReference = reference;
  setBusy(true);
  setError("");
  const form = new FormData();
  form.append("file", selectedSuspect, selectedSuspect.name);
  if (selectedReference) form.append("compare", selectedReference, selectedReference.name);
  form.append("channel", String(selectedChannel));
  appendBpcsForm(form, settings);
  try {
    const next = await api.analyse(form);
    if (generation !== requestGeneration.current) return;
    setChannel(selectedChannel);
    setResult(next);
    setAppliedBpcs(formFromConfig(next.bpcs.config));
  } catch (requestError) {
    if (generation !== requestGeneration.current) return;
    setError(errorText(requestError));
  } finally {
    if (generation === requestGeneration.current) setBusy(false);
  }
}

function invalidateForInputChange() {
  requestGeneration.current += 1;
  setBusy(false);
  setError("");
  setBpcsError("");
  setResult(null);
}

function applyBpcs() {
  const nextError = validateBpcsForm(bpcsDraft);
  setBpcsError(nextError);
  if (!nextError) void run(channel, { ...bpcsDraft });
}
```

Call `invalidateForInputChange` before applying any suspect/reference file change and at the start of the handoff effect. This ensures an older deferred success, failure, or `finally` cannot restore stale results, errors, or busy state after new files/handoffs. Keep the previous successful result visible during ordinary reruns; construct each presentational `SectionState` from `busy`, `error`, and the applicable slice of `result`.

Controls in the existing first panel:

- Keep both current `DropZone`s and main `Analyse` button.
- Add a `<fieldset>` titled `BPCS image settings` using existing `.inline-fields` controls.
- BPCS channel select: Red/Green/Blue values 0/1/2.
- Block-size select: 2, 4, 8, 16, 32, 64; default 8.
- First/last plane numeric/select controls: 0..7, inclusive; defaults 0/7.
- Threshold number: min 0, max 1, step 0.01; default 0.3.
- Add `Apply BPCS settings and rerun`, disabled without suspect or while busy. It validates only `bpcsDraft`.
- After an audio result, hide/disable the fieldset body and show `BPCS settings apply to images only.`; keep the explicit unsupported BPCS result section.
- Changing files invalidates outstanding requests and clears `result`, `error`, and `bpcsError` but retains both draft and last-valid applied settings. Handoff invalidates first, then sets both files.
- Clicking an analysis channel button reruns only the visual/statistical channel with `appliedBpcs`, even when `bpcsDraft` is invalid. Applying a valid BPCS draft retains the visual/statistical channel.

Render all extracted sections, including their explicit empty states before the first result, in this order: bit planes, BPCS, Chi-Square, histogram, difference, analysis timings. Keep the current two-column grouping for Chi-Square/histogram at desktop width. This is an expansion of the established Operate-mode UI, not a redesign.

- [ ] **Step 1: Write failing interaction tests with a mocked API**

Mock `api.analyse` and use Testing Library/user-event. Cover:

- initial defaults visible;
- custom controls append all exact values;
- invalid reversed planes shows local message and makes no request;
- after that invalid unapplied draft, a visual-channel click still requests with the previous applied BPCS values and succeeds;
- Apply triggers a second request and displays backend-returned applied config;
- channel click reruns with new `channel` and unchanged BPCS values;
- busy state disables action, BPCS, and channel controls while leaving file controls available to invalidate the request and leaving old section data visible;
- rejected rerun displays error while old result remains;
- image result shows maps; audio result shows unsupported text and image-only settings note;
- no reference shows difference empty state; adding reference and rerunning shows comparison;
- handoff files populate and clear stale results;
- a deferred request started for file A, followed by selecting file B, cannot set result/error/busy when A resolves or rejects;
- a deferred request started before a handoff cannot set result/error/busy after handoff files are installed.

- [ ] **Step 2: Run page tests to verify red**

Run: `npm --prefix frontend test -- src/pages/analyse/AnalysePage.test.tsx`

Expected: FAIL on missing BPCS controls and modular section behavior.

- [ ] **Step 3: Implement page state and controls**

Use the existing async request pattern; do not add a state library, router, auto-submit effect, or speculative cancellation. A user action starts each run as required by the spec.

- [ ] **Step 4: Run all frontend tests**

Run: `npm --prefix frontend test`

Expected: PASS with model, section, and page interaction coverage.

- [ ] **Step 5: Run production build**

Run: `npm --prefix frontend run build`

Expected: PASS with TypeScript strict checking and Vite bundle generation.

- [ ] **Step 6: Manually inspect responsive Operate-mode behavior**

Run API: `..\..\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000`

Run UI in another shell: `npm --prefix frontend run dev`

Expected at desktop and <=800px widths: no horizontal page overflow; controls wrap; BPCS maps collapse to one column on mobile; existing dark rail/pale surface/teal-coral-amber visual language remains; image and WAV requests both finish; rerun states and explanations remain readable.

- [ ] **Step 7: Commit the page integration**

```powershell
git add frontend/src/pages/AnalysePage.tsx frontend/src/pages/analyse/AnalysePage.test.tsx
git commit -m "feat: add configurable analysis workflow"
```

## Chunk 4: Optimization, benchmark, documentation, and final proof

### Task 12: Add a repeatable benchmark and capture the correctness-first baseline

**Files:**
- Create: `scripts/__init__.py`
- Create: `scripts/benchmark_analysis.py`
- Modify: `.gitignore`
- Create: `tests/test_analysis_benchmark.py`
- Modify: `tests/test_analysis_service.py`

The benchmark must generate deterministic suspect/reference pairs in memory; do not commit large binaries. Use NumPy seed `20260922` and RGB PNG fixtures:

| Name | Dimensions | Purpose |
| --- | --- | --- |
| `small` | 256 x 256 | interactive/common case |
| `medium` | 1024 x 768 | representative photo-sized case |
| `large` | 2048 x 1536 | response-bounds and sustained work |

For each fixture, generate the reference from the seeded RNG, copy it to the suspect, then XOR bit 0 in channel 0 at deterministic coordinates (`suspect[::17, 5::19, 0] ^= 1`). Encode both byte strings outside timed repetitions. Warm up once, then run `analysis.analyse(suspect_bytes, reference_bytes, channel=0, bpcs_config=BPCSConfig())` at least 3 measured repetitions. Assert/report that both `compare` and `bpcs.comparison` are non-null so every benchmark exercises difference and BPCS comparison work.

Report median/min/max wall milliseconds plus medians from every `durations_ms` field. Also report Python/NumPy/Pillow versions, OS, dimensions, suspect/reference encoded bytes, repeat count, serialized response bytes, data-URL count/encoded bytes/aggregate pixels, and a semantic digest covering every response field except top-level `durations_ms`.

Semantic digest normalization is exact and recursive:

```python
def semantic_digest(response: dict[str, object]) -> str:
    semantic = {key: value for key, value in response.items() if key != "durations_ms"}
    normalized = normalize(semantic)
    payload = json.dumps(
        normalized, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False
    ).encode("ascii")
    return hashlib.sha256(payload).hexdigest()
```

`normalize` preserves dict keys, list order, numbers, booleans, strings, and `None`. For every `data:image/...;base64,...` string, decode the PNG and replace the string with an object containing MIME type, encoded byte length, SHA-256 of encoded PNG bytes, Pillow mode, `[width, height]`, and SHA-256 of decoded pixel bytes. Thus scalar, array, null, compressed-byte, and decoded-pixel changes all change the digest; only timing changes are ignored.

Use these response budgets, derived from all maximum-size image maps rather than observed compression:

```python
MAX_DATA_URLS = 27
MAX_AGGREGATE_MAP_PIXELS = 7_077_888
MAX_SERIALIZED_RESPONSE_BYTES = 16 * 1024 * 1024
```

The pixel bound is `8 * 512^2` bit planes + `1 * 512^2` LSB composite + `8 * 2 * 512^2` BPCS maps + `2 * 512^2` difference maps. The corresponding maximum raw raster samples are 8,126,464 bytes because the composite and amplified difference are RGB. A 16 MiB JSON cap allows base64 expansion, PNG/zlib/row overhead, histogram/scalar JSON, and safety margin. Full statistics still use all data; only response rasters are bounded.

CLI:

```text
python -m scripts.benchmark_analysis [--fixture all|small|medium|large] [--repeat 5] [--output PATH] [--baseline PATH]
```

- `--fixture` defaults to `all`; the single-fixture option supports a quick subprocess smoke test.
- `--repeat` must be >= 1.
- `--output` writes JSON and still prints a concise table.
- `--baseline` loads a prior JSON, requires matching fixture/config metadata and semantic digests, and prints percentage changes for total wall time and analyzer medians.
- Preserve unrounded timing observations in report JSON. If a baseline median is zero, set percentage change to `null` and print `N/A (baseline 0; absolute delta X ms)`; never divide by zero. Otherwise print the normal percentage and absolute delta.
- Never fail because a timing regressed or did not meet a fixed speed. Fail only for invalid CLI input, mismatched benchmark definitions, or changed semantic digests.
- Ignore `.benchmarks/` in `.gitignore`; benchmark reports are machine observations, not portable pass/fail artifacts.

- [ ] **Step 1: Write failing CLI/schema tests**

Test a one-repeat tiny injected suspect/reference fixture (allow `main` to accept an optional fixture mapping for in-process tests), output JSON keys, non-null difference/BPCS comparison, invalid repeats, and baseline semantic mismatch. Prove semantic digest stability, then mutate one scalar, one list item, one `None`, encoded PNG bytes, and decoded pixels and assert each mutation changes the digest. Test baseline comparisons with zero/zero and zero/nonzero timing medians return `percent_change is None`, include an absolute delta, and print `N/A`. Monkeypatch timing only to make report shape deterministic; do not assert actual speed.

Add a real subprocess test using the exact documented safe invocation:

```python
completed = subprocess.run(
    [
        sys.executable, "-m", "scripts.benchmark_analysis", "--fixture", "small",
        "--repeat", "1", "--output", str(tmp_path / "smoke.json"),
    ],
    cwd=PROJECT_ROOT,
    capture_output=True,
    text=True,
    check=False,
)
assert completed.returncode == 0, completed.stderr
```

In `tests/test_analysis_service.py`, add an automated deterministic `2048 x 1536` suspect/reference response-budget test. Serialize compact JSON to UTF-8, decode every data URL with Pillow, and assert URL count, aggregate pixel count, and JSON bytes are at or below the three explicit constants. Print actual serialized bytes/pixels in the assertion message. Also assert every individual preview/BPCS map side is <=512, `compare` and `bpcs.comparison` are present, and no raw block matrix appears.

- [ ] **Step 2: Run benchmark tests to verify red**

Run: `..\..\.venv\Scripts\python.exe -m pytest tests/test_analysis_benchmark.py tests/test_analysis_service.py -k "benchmark or response_budget" -q`

Expected: FAIL because the module and budget constants do not exist.

- [ ] **Step 3: Implement the benchmark harness**

Make `scripts` an explicit package with an empty `scripts/__init__.py`. Import production `analysis.analyse`; do not copy analyzers into the script. Use `statistics.median`, unrounded internal observations, and sorted-key JSON. Keep default output human-readable and bounded.

- [ ] **Step 4: Run benchmark tests**

Run: `..\..\.venv\Scripts\python.exe -m pytest tests/test_analysis_benchmark.py tests/test_analysis_service.py -k "benchmark or response_budget" -q`

Expected: PASS, including exact `python -m` subprocess invocation, zero-baseline handling, full semantic digest sensitivity, and the deterministic aggregate response budget; no hard machine-speed assertion.

- [ ] **Step 5: Capture the pre-optimization baseline**

Run: `..\..\.venv\Scripts\python.exe -m scripts.benchmark_analysis --repeat 3 --output .benchmarks/modular-before.json`

Expected: three fixture rows print; JSON is created under ignored `.benchmarks`; comparison fields are exercised, full-response semantic digests are non-empty, and serialized-byte/pixel measurements remain within bounds. Record observations in execution notes, not as an acceptance threshold.

- [ ] **Step 6: Commit the benchmark harness**

```powershell
git add scripts/__init__.py scripts/benchmark_analysis.py tests/test_analysis_benchmark.py tests/test_analysis_service.py .gitignore
git commit -m "perf: add repeatable analysis benchmark"
```

### Task 13: Vectorize proven kernels and reuse derived arrays

**Files:**
- Modify: `backend/app/stego/analysis/common.py`
- Modify: `backend/app/stego/analysis/bit_planes.py`
- Modify: `backend/app/stego/analysis/histogram.py`
- Modify: `backend/app/stego/analysis/chi_square.py`
- Modify: `backend/app/stego/analysis/bpcs.py`
- Modify: `backend/app/stego/analysis/difference.py`
- Modify: `tests/test_analysis_common.py`
- Modify: `tests/test_analysis_bpcs.py`
- Modify: `tests/test_analysis_service.py`

Optimization constraints:

- Carrier bytes are loaded once per suspect/reference in `prepare_inputs`.
- `CarrierAnalysis.sequence(channel)` and `bit_plane(channel, bit)` caches are the only shared derived-array cache; do not add global caches or retain uploads beyond the request.
- Bit-plane previews and BPCS use the same cached plane when channel/bit overlap.
- Use `np.bincount(..., minlength=256)` for histograms.
- Use array XOR/inequality and reductions for transitions, classifications, comparisons, popcount lookup, and difference maps.
- Batch BPCS blocks by padding channel planes and validity masks, reshaping to `(block_rows, block_size, block_columns, block_size)`, and transposing to block-major order. The validity masks must produce exactly the Task 4 partial-edge counts.
- Do not generate BPCS planes/maps/reference calculations for audio.
- Do not increase `PREVIEW_SIDE` or `MAP_SIDE_LIMIT`.
- Keep API response values and data URL image pixels unchanged.

- [ ] **Step 1: Add regression tests for reuse and skipped work**

Spy on `load_cover` to assert once per supplied file. For the concrete cache seam, call `CarrierAnalysis.sequence(channel)` and `bit_plane(channel, bit)` twice, assert each pair is the same object (`is`), assert exact expected array content, and assert the cache dictionaries contain only the requested keys. Do not attempt to spy on an inlined NumPy plane calculation that has no callable seam. Make both bit-plane preview and BPCS implementations obtain planes only through `context.bit_plane`; the cache identity/content test then guards their shared source. Monkeypatch the public image-only BPCS kernel to raise and verify audio service calls still return unsupported.

- [ ] **Step 2: Run the new tests before optimization**

Run: `..\..\.venv\Scripts\python.exe -m pytest tests/test_analysis_common.py tests/test_analysis_bpcs.py tests/test_analysis_service.py -q`

Expected: PASS. These are behavior-preservation guards around the optimization; the before/after benchmark, rather than a timing assertion, supplies the performance evidence.

- [ ] **Step 3: Vectorize one analyzer at a time**

After each module edit, run its focused test file. For BPCS, compare vectorized output to a simple scalar test-only reference over deterministic random dimensions including `1x1`, non-multiples of every allowed block size, and thresholds 0, 0.3, and 1.

- [ ] **Step 4: Run the complete backend analysis suite**

Run: `..\..\.venv\Scripts\python.exe -m pytest tests/test_analysis_common.py tests/test_analysis_chi_square.py tests/test_analysis_bpcs.py tests/test_analysis_difference.py tests/test_analysis_service.py tests/test_api.py tests/test_workflows.py -q`

Expected: PASS with exact schema/numerical/map regressions.

- [ ] **Step 5: Capture and compare post-optimization measurements**

Run: `..\..\.venv\Scripts\python.exe -m scripts.benchmark_analysis --repeat 3 --baseline .benchmarks/modular-before.json --output .benchmarks/modular-after.json`

Expected: semantic digests match and percentage deltas print for all fixtures/analyzers. Treat measured improvements, neutrality, or regressions as evidence to investigate, not a flaky gate. If a robust in-process regression is large, profile and either fix it or document it before proceeding; never tune by weakening correctness or bounds.

- [ ] **Step 6: Commit measured optimizations**

```powershell
git add backend/app/stego/analysis tests/test_analysis_common.py tests/test_analysis_bpcs.py tests/test_analysis_service.py
git commit -m "perf: vectorize modular steganalysis"
```

### Task 14: Document methods, limits, API, and benchmark reproduction

**Files:**
- Create: `docs/steganalysis.md`
- Modify: `README.md:5-11,78-82,165-189`
- Modify: `PRODUCT.md:25-34,44-54`

`docs/steganalysis.md` must include:

1. Module map and one-load/cached-array/thread-pool data flow.
2. Exact BPCS defaults, accepted ranges, form names, inclusive plane semantics, and image-only support.
3. The valid-adjacency partial-edge formula, inclusive threshold, bounded map sampling, and the distinction between full statistics and sampled visualization.
4. Capacity formula and units, including whole-byte floor/remainder and explicit exclusion of framing/conjugation metadata.
5. Descriptive comparison direction/definitions and the statement that there is no BPCS detector verdict.
6. Westfeld-Pfitzmann pairs `(0,1)..(254,255)`, expected means, expected-count exclusion, df/statistic/p-value fields, segment order, 0.95 presentation heuristic, high-p interpretation, and all false-positive/false-negative limitations from response metadata.
7. Image behavior, audio's retained visual/statistical/difference behavior, and explicit BPCS unsupported response.
8. Legacy top-level compatibility fields and the full new `chi_square_details`, `bpcs`, and `durations_ms` schemas.
9. Timing caveat; safe `python -m scripts.benchmark_analysis` commands; deterministic suspect/reference fixture sizes; full non-timing semantic digest behavior; serialized-byte/map-pixel budgets; zero-baseline `N/A` handling; output/baseline behavior; and no hard speed gate.

Update README's Steganalysis capability and project layout, link the detailed document, and add frontend test/benchmark commands. Update PRODUCT implementation status/principles only enough to reflect descriptive modular analysis; do not rewrite deferred product scope or brand commitments.

- [ ] **Step 1: Write the documentation from the implemented constants and types**

Copy names/numbers from code, not memory. Include one complete compact JSON example for image and one unsupported `bpcs` fragment for audio.

- [ ] **Step 2: Add documentation assertions**

In `tests/test_analysis_service.py`, read `docs/steganalysis.md` and assert it contains canonical method/default/form/heuristic/policy names: `westfeld-pfitzmann-pairs-of-values`, `include-valid-adjacencies`, `bpcs_complexity_threshold`, `0.30`, `0.95`, `capacity_bits`, and `descriptive_only`. This catches silent drift without snapshotting prose.

- [ ] **Step 3: Run documentation-linked tests**

Run: `..\..\.venv\Scripts\python.exe -m pytest tests/test_analysis_service.py -q`

Expected: PASS.

- [ ] **Step 4: Run docs commands once**

Run: `..\..\.venv\Scripts\python.exe -m scripts.benchmark_analysis --repeat 1`

Expected: all three fixture rows and environment metadata print successfully.

Run: `npm --prefix frontend test`

Expected: PASS using the command documented for frontend tests.

- [ ] **Step 5: Commit documentation**

```powershell
git add docs/steganalysis.md README.md PRODUCT.md tests/test_analysis_service.py
git commit -m "docs: explain modular steganalysis"
```

### Task 15: Run full verification and review compatibility

**Files:**
- Verify only; modify only files implicated by a failing check or review finding.

- [ ] **Step 1: Run the complete Python suite**

Run: `..\..\.venv\Scripts\python.exe -m pytest -q --basetemp=.pytest-final`

Expected: all tests PASS. Existing image/audio hide, verify, attack, desktop, security, and protocol tests must remain green.

- [ ] **Step 2: Run all frontend tests**

Run: `npm --prefix frontend test`

Expected: all model, section, and page interaction tests PASS.

- [ ] **Step 3: Run the production frontend build**

Run: `npm --prefix frontend run build`

Expected: `tsc --noEmit` and Vite build PASS.

- [ ] **Step 4: Run final benchmark report**

Run: `..\..\.venv\Scripts\python.exe -m scripts.benchmark_analysis --repeat 5 --output .benchmarks/modular-final.json`

Expected: semantic results agree with focused tests; timing measurements print with no fixed speed pass/fail gate.

- [ ] **Step 5: Exercise API compatibility explicitly**

Run: `..\..\.venv\Scripts\python.exe -m pytest tests/test_api.py -k "sender_to_receiver_flow or analyse" -q`

Expected: old no-BPCS requests and new configured requests both PASS for image and audio; old fields remain present.

- [ ] **Step 6: Review response size and descriptive wording**

Inspect `.benchmarks/modular-final.json` and the automated large-fixture assertion output. Confirm reported serialized bytes are <=16 MiB, data URLs <=27, aggregate map pixels <=7,077,888, every preview/BPCS map side <=512, no raw block matrix is serialized, audio has no BPCS maps, and no Chi-Square/BPCS text claims proof, authenticity, or a binary detector verdict.

- [ ] **Step 7: Review every commit from the captured base plus working changes**

Run:

```powershell
$BaseSha = Get-Content (git rev-parse --git-path modular-steganalysis-base)
git cat-file -e "$BaseSha^{commit}"
git log --oneline "$BaseSha..HEAD"
git diff --check "$BaseSha...HEAD"
git diff --stat "$BaseSha...HEAD"
git diff "$BaseSha...HEAD"
git diff --check
git diff
git diff --cached
git status --short
```

Expected: the saved object is a valid commit; `base...HEAD` includes the preliminary plan commit and every implementation commit; no whitespace errors; the committed diff contains only the modular analysis package, focused tests, Analyse-page sections, exact test dependencies/lockfile, benchmark, and docs. Unstaged and staged diffs are empty unless a verification fix is intentionally pending; ignored benchmark reports do not appear in status. Review the full `base...HEAD` diff, not only the last commit.

- [ ] **Step 8: Commit any verification fixes separately**

Only if verification required changes:

```powershell
git add <exact-files-fixed>
git commit -m "fix: address steganalysis verification findings"
```

Do not amend prior commits. Record actual test counts, Node/Python versions, benchmark measurements, and any unautomated visual checks in the implementation handoff.
