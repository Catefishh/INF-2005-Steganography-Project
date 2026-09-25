# Steganography Full Audit and Repair Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Find and repair confirmed correctness, integrity, malformed-input, and workflow edge-case bugs across the Stegloc steganography application.

**Architecture:** Establish backend and frontend baselines, then audit the protocol owners in severity order. Each confirmed defect gets a focused regression test before the smallest owning-module fix; shared validation is added only when the same unsafe boundary exists in multiple protocols. Finish with targeted and full-suite verification.

**Tech Stack:** Python 3.11+, FastAPI, Pillow, NumPy, cryptography, pytest; React 19, TypeScript, Vite, Vitest.

---

## Files and Responsibilities

- Modify `backend/app/stego/lsb.py` only for LSB bounds, zero-length, type, and arithmetic defects.
- Modify `backend/app/stego/protocol.py`, `v2_security.py`, `text_v3.py`, or `dct_protocol.py` only for confirmed protocol parsing, authentication, framing, or size defects.
- Modify carrier modules under `backend/app/stego/` only for confirmed image/audio/video/text boundary defects.
- Modify `backend/app/api/*.py` only when expected malformed input escapes as a server error or untrusted content is published.
- Add regressions to the narrowest existing `tests/test_*.py`; add a new test module only when no existing module owns the behavior.
- Modify frontend files only for a reproduced client-side defect; use existing Vitest and build coverage.
- Update `README.md` or protocol docs only when externally visible behavior changes.

## Chunk 1: Baseline and Failure Inventory

- [ ] **Step 1: Locate the usable Python test environment.**
  Run `py -3 -m pytest --version`, `python -m pytest --version`, and inspect available project interpreters without changing files.
  Expected: identify a working interpreter or record that Python dependencies are unavailable.

- [ ] **Step 2: Run the backend baseline.**
  Run `py -3 -m pytest` or the discovered equivalent from the repository root.
  Record failing tests, import errors, warnings, and duration. Do not edit code for environment-only failures.

- [ ] **Step 3: Preserve the frontend baseline evidence.**
  From `frontend`, run `npm test` and `npm run build`.
  Expected: 102 Vitest tests pass and the TypeScript/Vite build succeeds unless the installed environment has changed.

- [ ] **Step 4: Classify failures and suspicious boundaries.**
  Inspect the failing test owners and protocol entry points. Create a short local inventory in working notes or the plan checklist with severity, reproduction command, owner module, and expected behavior.

## Chunk 2: LSB and Legacy Workflow Audit

- [ ] **Step 1: Add regressions for confirmed LSB boundary defects.**
  In `tests/test_lsb.py` or the owning legacy test module, cover zero-byte payloads, zero/negative/oversized starts, invalid depth types, exact capacity, one-bit padding, and NumPy/bytearray input compatibility for any behavior not already covered.
  Run the focused tests and confirm each new test fails only when it represents a real defect.

- [ ] **Step 2: Fix only confirmed LSB defects.**
  Update `backend/app/stego/lsb.py` with explicit validation and overflow-safe calculations. Preserve the distinction between legacy `encode`/`decode` and authenticated workflow helpers unless the regression demonstrates a shared contract failure.

- [ ] **Step 3: Audit legacy hide/verify publication behavior.**
  Inspect `legacy_embed.py`, `legacy_verify.py`, `legacy_capacity.py`, and `engine.py` for malformed header handling, manual-start consistency, capacity mismatch, and content release before all integrity checks pass.
  Add focused tests in `tests/test_app.py`, `tests/test_api.py`, or the closest existing module, then patch the owning function.

- [ ] **Step 4: Run the LSB/legacy regression set.**
  Run `py -3 -m pytest tests/test_lsb.py tests/test_image.py tests/test_api.py tests/test_app.py tests/test_workflows.py -q`.

## Chunk 3: DCT and Media Carrier Audit

- [ ] **Step 1: Exercise DCT edge cases.**
  Review `dct_codec.py` and `dct_protocol.py` for images smaller than one complete block, alpha-channel preservation, header placement, exact capacity, PNG mode conversion, corrupted coefficients, and conflicting LSB/DCT framing.
  Add regressions to `tests/test_dct.py` and `tests/test_dct_api.py` for every reproduced issue.

- [ ] **Step 2: Exercise audio/video carrier boundaries.**
  Review `covers.py` and the v2/v4 media modules for truncated headers, unsupported formats, empty streams, frame/channel offsets, duration limits, and exact final-slot extraction.
  Add regressions to `tests/test_audio.py`, `tests/test_video_v2.py`, `tests/test_v4_media.py`, or the closest owner.

- [ ] **Step 3: Implement localized media fixes.**
  Keep carrier parsing strict and bounded. Map expected bad media to the project’s existing error types and ensure failed processing does not write a partial artifact.

- [ ] **Step 4: Run the media regression set.**
  Run `py -3 -m pytest tests/test_dct.py tests/test_dct_api.py tests/test_audio.py tests/test_video_v2.py tests/test_v4_media.py tests/test_v2_api.py tests/test_v2_security.py -q`.

## Chunk 4: Protocol, Security, and Text Audit

- [ ] **Step 1: Audit bounded parsing and canonicalization.**
  Review `protocol.py` and `v2_security.py` for integer conversion, JSON limits, nonce/signature lengths, locator consistency, recovery-code parsing, and authenticated placement checks. Add malformed and tamper regressions before fixes.

- [ ] **Step 2: Audit v3 text framing.**
  Review `text_v3.py` and `text_carrier.py` for Unicode normalization, line endings, trailing whitespace, zero-width symbols, acrostic count mismatches, carrier-size limits, and visible-text authentication assumptions. Extend `tests/test_v3.py` only for confirmed failures.

- [ ] **Step 3: Fix authenticity and release boundaries.**
  Ensure content is returned only after locator/decryption/signature/content-hash/carrier-consistency checks required by the protocol. Expected failures should become structured verification results at API boundaries rather than uncaught 500 responses.

- [ ] **Step 4: Run the protocol/security regression set.**
  Run `py -3 -m pytest tests/test_protocol.py tests/test_security.py tests/test_v2_security.py tests/test_v2_api.py tests/test_v3.py tests/test_workflows.py -q`.

## Chunk 5: API and Frontend Workflow Audit

- [ ] **Step 1: Test malformed API requests.**
  Review `backend/app/api/protection.py`, `v2_protection.py`, `v4_media.py`, `v4_video.py`, and `text.py` for invalid optional integers/floats, missing payloads, bad key material, unsupported methods, and storage calls after failed verification.
  Add request-level regressions to the closest API test module.

- [ ] **Step 2: Patch API exception and output handling.**
  Map expected domain errors to existing 4xx/structured verdict behavior, bound preview/output sizes, sanitize user-controlled filenames, and ensure content artifacts are stored only for trusted results.

- [ ] **Step 3: Run frontend tests against any changed contract.**
  If API response shapes or error messages change, update only the affected frontend tests and consumers, then run `npm test` and `npm run build` from `frontend`.

## Chunk 6: Final Verification and Documentation

- [ ] **Step 1: Run the complete backend suite.**
  Run `py -3 -m pytest` from the repository root and resolve all code-related failures.

- [ ] **Step 2: Run the complete frontend suite and build.**
  Run `npm test` and `npm run build` from `frontend`.

- [ ] **Step 3: Review the final diff.**
  Run `git status --short` and `git diff --check`; inspect only files changed for this audit and ensure pre-existing user changes remain intact.

- [ ] **Step 4: Update documentation for contract changes.**
  If a protocol or externally observable failure behavior changed, update the relevant protocol README/doc and add the behavior to the relevant regression test.

- [ ] **Step 5: Report evidence and residual gaps.**
  Summarize fixed defects, tests run, environment limitations, and any areas that could not be exercised without unavailable dependencies such as FFmpeg.
