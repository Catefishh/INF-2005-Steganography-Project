# Steganography Full Audit and Repair Design

## Goal

Audit the Stegloc application end to end and repair confirmed bugs and important edge cases across its steganography protocols, media carriers, API, and frontend workflows. The highest priority is preserving byte-exact recovery and ensuring that unauthenticated or corrupted content is never reported as authentic or released to the user.

## Scope

The audit covers:

- Python steganography engines and protocol parsers for LSB, DCT, v2 media, and v3 text.
- Image, audio, video, and text carrier loading, capacity, placement, extraction, and malformed-input handling.
- FastAPI request validation, exception mapping, verification responses, and output storage behavior.
- Frontend API and workflow failures that can be reproduced with the existing local test/build setup.
- Focused regression tests for every confirmed defect.

Findings will be prioritized as follows:

1. Data loss, integrity failures, authentication bypasses, or incorrect trusted verdicts.
2. Crashes, uncontrolled exceptions, denial-of-service risks, or invalid bounds handling.
3. Incorrect extraction, capacity, placement, or protocol behavior.
4. User-visible workflow and presentation defects.

Existing worktree changes are treated as user work and will not be reverted or cleaned up unless a directly related defect requires working with them.

## Verification Strategy

Establish a baseline with the complete available Python and frontend checks:

- `pytest`
- `npm test` from `frontend`
- `npm run build` from `frontend`

Classify failures and suspicious behavior by protocol, carrier, API, and UI boundary. For each confirmed defect, add a minimal reproduction or focused regression before changing the implementation where practical. Validate the repair with targeted tests, then rerun the full relevant suites.

Protocol tests must include both successful round trips and malformed/unsafe inputs. Verification assertions must check explicit verdicts and content-release behavior so corrupted, unauthenticated, or inconsistent payloads cannot be returned as trusted content.

## Implementation Boundaries

- Keep fixes localized to the owning module and follow existing interfaces unless a defect requires a contract change.
- Introduce shared validators only when multiple protocols require identical bounds or structural checks.
- Convert expected malformed-input and verification failures into structured results at the existing protocol/API boundaries instead of leaking implementation exceptions.
- Preserve atomic output behavior: failed embedding or verification must not publish partial or untrusted output files.
- Because protocol changes are allowed, revise a format or reject an unsafe legacy case when necessary for correctness; document and test the changed behavior.
- Limit frontend changes to reproduced defects and verify them with the existing Vitest and TypeScript/Vite commands.

## Expected Deliverables

- Confirmed bug fixes across the audited surfaces, with no unrelated refactors.
- Regression coverage for each fixed defect and edge-case coverage for relevant protocol boundaries.
- Updated protocol or behavior documentation only where the externally observable contract changes.
- Test results covering targeted checks and the full available suites.
