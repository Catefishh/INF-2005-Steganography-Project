# Studio Fixes and DCT Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan. Steps use checkbox syntax for tracking. Do not commit without an explicit user request.

**Goal:** Deliver the five approved studio changes, including independently recoverable signed DCT PNGs.

**Architecture:** An isolated DCT codec and signed envelope sit behind the current protection API; shared detection dispatch preserves LSB compatibility. React keeps media result routing state at the application boundary, uses a dedicated DCT result presentation, and adds an accessible bit-plane dialog.

**Tech Stack:** Python, NumPy, Pillow, cryptography, FastAPI; React, TypeScript, CSS, Vitest and pytest.

**Specification:** `docs/superpowers/specs/2026-09-25-studio-fixes-dct-design.md` is authoritative for bit ordering, header layout, capacity, retries, coverage, and failure semantics.

## Chunk 1: DCT backend

### Task 1: Codec and signed envelope

Files: create `backend/app/stego/dct_codec.py`, `backend/app/stego/dct_protocol.py`, `tests/test_dct.py`.

- [ ] Add codec tests for actual PNG round trips, structural capacity, edge/alpha preservation, black/white/textured carriers, malformed ranges and header handling.
- [ ] Run `.venv/Scripts/python.exe -m pytest tests/test_dct.py -q` and confirm missing implementation failures.
- [ ] Implement orthonormal DCT using a precomputed NumPy cosine matrix (no new dependency). Public codec operations expose capacity, read bytes, write disjoint ranges with bounded strength escalation, serialization recovery proof, and canonical covered-pixel hashing.
- [ ] Implement the versioned signed/encrypted protocol using existing security primitives and distinct framing. Use fixed-width record fields to fix package size before placement. Its `hide`/`verify` signatures follow legacy equivalents; success releases bytes only after every check in the spec passes.
- [ ] Add protocol tests for signed text/binary recovery after reload, wrong credentials, tampering, supported integrity scope, and framing/version failures. Required black/white fixture successes must not be replaced by blanket safe failures.
- [ ] Run the focused tests and resolve failures.

Implementation sequence and interfaces for Task 1:
- [ ] Implement `DctCarrier(data)` exposing decoded RGB/alpha, width/height, `n_slots`, and `capacity_bytes`; verify complete-block counts and alpha/edge preservation tests.
- [ ] Implement `read_bytes(length, start)` using row-major channel-block traversal, MSB-first packing and coefficient comparison; test fixed hand-constructed bits and invalid ranges.
- [ ] Implement `embed_ranges([(start, bytes), ...]) -> png_bytes`, reconstructing only occupied channel blocks with strengths 32/64/128/256. Reopen and compare all ranges after each attempt; test safe exhaustion and successful textured/mid-gray/black/white fixtures.
- [ ] Implement `coverage(start, package_bytes)` and `stable_hash(start, package_bytes)` with the canonical channel-specific exclusion and alpha inclusion specified in the design. Test occupied versus unoccupied channel edits.
- [ ] Implement protocol record construction and `estimate_package_bytes(...)` with fixed-width placement/count fields, then bootstrap encryption/decryption and bounds checks.
- [ ] Implement protocol `hide(...)`, building placeholder record, selecting placement, hashing covered pixels, signing/encrypting, invoking the codec, and assembling the report.
- [ ] Implement protocol `verify(...)` one stage at a time, returning no content on any failure, then add shared `detect_method(cover)` framing detection used by inspect and engine dispatch.
- [ ] In `tests/test_dct.py`, assert no content release on signed/header placement mismatch, dimension mismatch, or covered-pixel hash mismatch; assert a bit-preserving occupied-block edit may pass.
- [ ] In `tests/test_dct_api.py`, assert ambiguous framing is rejected and recognized DCT failures never invoke the LSB decoder. Expected: all assertions pass after implementation; before implementation imports or missing method behavior fail.

### Task 2: HTTP integration and dispatch

Files: modify `backend/app/stego/engine.py`, `backend/app/stego/attacks.py`, `backend/app/api/protection.py`, `backend/app/api/common.py`; create `tests/test_dct_api.py`; inspect `backend/app/api/robustness.py` for shared verification dispatch.

- [ ] Add failing API tests for image capacity metadata, method-aware estimate/hide, download/reupload verification, unsupported methods, manual override rejection, and DCT tamper handling.
- [ ] Run `.venv/Scripts/python.exe -m pytest tests/test_dct_api.py -q`.
- [ ] Extend inspect with `dct: { max_package_bytes, n_slots }` for images and `embedding_method` for recognizable DCT/LSB files. Add `method: "lsb" | "dct"` to estimate and hide, defaulting to LSB.
- [ ] The DCT estimate accepts the existing descriptor and payload fields and calculates exact package bytes. DCT hide returns the standard `{stego, report}` wrapper with a method-specific report: `method: "dct"`, cover, start/header locations, package/capacity/span counts, signed record, signature/hash/salt, steps, and `coverage: { protected_rgb_values, total_rgb_values, alpha_values, description }`. No LSB-specific tutorial fields are required. Output extension and MIME must be PNG.
- [ ] Shared `engine.verify` detects framing without sender memory, rejects ambiguity and unsupported versions, and never falls back after recognized DCT authentication failure. DCT verification sets `info.method` and coverage and uses existing verdict names with accurate summaries.
- [ ] Route general tamper scenarios to shared verification. Produce labelled unsupported results for attacks that assume LSB framing instead of attempting them on DCT. Preserve transformed artifact downloads.
- [ ] Run `.venv/Scripts/python.exe -m pytest tests/test_dct.py tests/test_dct_api.py tests/test_api.py tests/test_workflows.py -q`.

## Chunk 2: UI fixes

### Task 3: Routing, text workspace, inspection and tamper presentation

Files: modify `frontend/src/App.tsx`, `frontend/src/pages/analysis/Results.tsx`, `frontend/src/pages/analysis/BitPlanesPanel.tsx`, `frontend/src/pages/RobustnessPanel.tsx`, `frontend/src/styles.css`; create `frontend/src/ui/BitPlaneViewer.tsx` and focused regression tests.

Exact regression files: create `frontend/src/studio-navigation.test.tsx` and `frontend/src/ui/BitPlaneViewer.test.tsx`; update `frontend/src/pages/RobustnessPanel.test.tsx`. The viewer tests assert focus restoration and stale-analysis dismissal as well as labels and zoom. The navigation tests cover RSA image/audio results and video's independent inline result, sidebar return, explicit form URL, Back/Forward, edit download access, invalidation, and off-page completion. Modify `frontend/src/pages/VideoWorkflow.tsx` and `frontend/src/pages/HidePage.tsx` as required for availability callbacks: video must not pass through an RSA-only no-result redirect. UI-fixes ownership covers App and video callbacks; DCT integration owns HidePage and adapts these callbacks after coordination.

- [ ] Add failing tests for sidebar result restoration, text/media reset independence, correctly labelled original/stego dialogs and keyboard dismissal, and absence of tamper-quality output.
- [ ] Run `npm test -- --run` in `frontend` (or the new focused test paths).
- [ ] Track last embedding form/result route at App boundary; sidebar return restores it, explicit URLs/history remain authoritative, and a completed operation while another page is active does not steal navigation. Expose a stable callback for HidePage result availability/invalidation as needed.
- [ ] Render Working file only on media-related routes, and remove TextPage's media-reset key.
- [ ] Keep statistical panels responsive, put bit layers in a full-width section, and use independently flowing content without fixed card heights.
- [ ] Add a native or existing accessible dialog with zoom/reset, pixelated rendering, source/channel/bit label, sampling notice, focus return, Escape/close, and invalidation when its analysis changes. Both reference and inspected thumbnails must work.
- [ ] Remove PSNR/MSE/SSIM chart/card output from tamper tests while preserving input parameters, previews, dimensions, verification, downloads, and compatible API fields.
- [ ] Run relevant frontend tests; inspect layout CSS at wide and narrow breakpoints.

## Chunk 3: DCT frontend and final proof

### Task 4: Embedding and extraction UI

Files: modify `frontend/src/api.ts`, `frontend/src/api/types.ts`, `frontend/src/util.ts`, `frontend/src/pages/HidePage.tsx`, `frontend/src/pages/VerifyPage.tsx`, `frontend/src/pages/verify/Result.tsx`; create `frontend/src/pages/embed/DctResult.tsx`; modify applicable tests.

Exact DCT regression file: create `frontend/src/pages/DctWorkflow.test.tsx`. Assert DCT outgoing method and estimate fields, structural-capacity display, absence of manual/LSB controls, PNG download and handoff, and method-aware verification summaries. Expected: tests fail on missing DCT controls before changes and pass with existing LSB tests after changes.

- [ ] Extend types with `EmbeddingMethod`, optional image DCT capacity/detection, a discriminated DCT report, and coverage information. Preserve existing LSB mocks/types.
- [ ] Offer DCT only for images; include the method in estimates/submission and use its structural capacity. Hide LSB/manual placement controls in DCT mode. Preserve the default LSB behavior.
- [ ] Render a dedicated DCT result with PNG download, signed/encrypted payload evidence, coefficient capacity/placement, and explicit integrity scope. Keep previous successful downloads accessible from the form until invalidation. Handoff records the method as a hint.
- [ ] Detect independently uploaded DCT through inspect; hide/reset LSB override controls. Result copy uses DCT backend summary and coverage instead of blanket whole-cover authenticity claims.
- [ ] Add frontend tests for DCT selection, capacity and outgoing method, DCT result/download persistence, and method-aware verification display.
- [ ] Run `npm test -- --run` and `npm run build` in `frontend`.

### Task 5: Documentation and complete verification

Files: update `README.md`; add `docs/dct-protocol.md` describing the actual frozen format and integrity boundaries.

- [ ] Document UI steps, PNG round-trip guarantee, size/capacity constraints, and meaningful partial cover-integrity scope.
- [ ] Review implementation against the approved spec; fix spec-compliance and code-quality findings.
- [ ] Run `.venv/Scripts/python.exe -m pytest -q`, frontend `npm test -- --run`, and `npm run build`. Record exact results and environmental blockers.
- [ ] Inspect `git diff --check` and `git status --short`; report delivered changes and verification evidence. No commits or pushes.
