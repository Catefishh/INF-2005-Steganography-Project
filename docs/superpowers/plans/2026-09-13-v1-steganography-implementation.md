# V1 Steganography and Integrity Verification Implementation Plan

> **For agentic workers:** Use the executing-plans skill to implement this plan in dependency order, with review checkpoints. Delegate only when the user or applicable repository instructions authorize it. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a local GUI application that hides user content and signed verification data inside image and audio covers, verifies received files, preserves exact file size for supported formats, and subsequently demonstrates video hidden inside video.

**Architecture:** A React browser interface talks to a single local Python/FastAPI process. A shared protocol and LSB engine serve format-specific image, audio, and later video adapters; cryptographic code is independent of the UI. Local temporary workspaces hold bounded processing results, with no database or cloud service required.

**Tech Stack:** Proposed Python 3.12, FastAPI/Uvicorn, Pillow, NumPy, cryptography; React, TypeScript, Vite, plain CSS and native browser media controls; pytest and Playwright for verification. FFmpeg/ffprobe are introduced only for the video milestone and preview conversion.

**Status:** Draft for design approval. The file-size policy is confirmed. The proposed stack, encrypted recovery-file workflow, and video format limits need approval before implementation. This document plans work; no application features or passing tests are claimed.

**Source of truth:** The user's five-page INF2005 ACW1 specification, added requirements, dashboard reference, and confirmed exact-size-mode answer. Required sample text is preserved in `docs/reference/assignment-excerpts.md`. Before visual implementation, save the supplied dashboard attachment at `docs/reference/dashboard-reference.png` (currently not present); its palette and composition are described in Section 9. Repository baseline: commit `32b092b`, with only `LICENSE` and no application code.

---

## Chunk 1: Scope and design decisions

### 1. V1 outcomes and priorities

**Mandatory baseline:** Image and audio protect/verify flows, FR1–FR13 coverage, selectable depth and secured start locations, arbitrary supported user files, side-by-side comparisons, confidentiality for the custom payload, reproducible positive/negative evidence, and the submission package.

**Additional v1 milestone:** A real small video file embedded into a larger compatible video cover and recovered byte-for-byte. Implement after the mandatory baseline passes; report it as incomplete if its gate does not pass, rather than counting a preview as video steganography.

**Convenience:** 1, 2, and 3 bits are prominent presets. An expanded depth control exposes all values 1–8 to satisfy the brief. Here `k` means replacement of the lowest `k` bits of each eligible channel/sample, not arbitrary selection of individual bit planes. Confirm that interpretation with the lecturer if their wording is intended differently.

### 2. Delivery choice

| Approach | Benefit | Cost / limitation |
|---|---|---|
| **Local React + Python application — proposed** | Closely fits the supplied visual reference; Python media/crypto tools; normal browser drag/drop and playback | Two development toolchains; requires a bounded local processing API |
| Python/PySide6 desktop application | One language; direct file access and native drag/drop | More custom styling effort to match the reference; desktop packaging and media-backend differences |
| Browser-only application | No processing server | Binary media adapters, video processing, and crypto compatibility increase implementation risk for this assignment |

Use one local service bound to `127.0.0.1`. Serve the production frontend from that service. No accounts, database, external steganography service, cloud deployment, plugin system, or distributed job queue is needed for the stated scope.

### 3. Supported carriers versus payloads

A **cover/carrier** provides replaceable sample bits. A **payload** is the hidden content, whose bytes need not match the carrier's media type.

| Carrier | Planned v1 support | Exact-size promise |
|---|---|---|
| PNG | 8-bit RGB/RGBA, non-animated; preserve alpha; clear rejection for unsupported modes initially | Dimensions unchanged; compressed file length may change and is displayed |
| BMP | Uncompressed 24-bit BI_RGB; account for row padding and orientation | Stego byte length equals original byte length |
| WAV | RIFF/WAVE integer PCM, 8/16/24/32-bit, mono/stereo; preserve ancillary chunks and padding | Stego byte length equals original byte length |
| Video, later milestone | Narrowly supported classic AVI with one uncompressed 24-bit BI_RGB video stream; initially no audio stream, no OpenDML, no compressed frames | Byte-patch existing frame data; identical file byte length, frame count, dimensions, and timing |

Reject unsupported cover formats with the reason and supported choices. JPEG, MP3/AAC, arbitrary compressed MP4, palette/16-bit/animated PNG, floating-point WAV, RF64, and compressed WAV are outside the initial cover contract. These can still be hidden as payload files if they fit.

Payload inputs: typed UTF-8 text or one arbitrary file, including text, image, audio, PDF, ZIP, and video. Preserve exact content bytes, original display filename, and declared media type; sanitize the filename when saving. Use text/image/audio/video previews where supported. Other content gets a verified download. Never auto-execute extracted programs or render uploaded HTML as application content.

An unsupported video may be **explicitly prepared** as a compatible uncompressed AVI using FFmpeg. Preparation changes file size and creates a new cover. Compare exact-size embedding against that prepared cover, never against the source MP4. Show both sizes before the user proceeds. A browser playback proxy is a separate derivative, never the encoded carrier or extraction input.

### 4. Correct FR4 workflow

The requested `hash(private key) → unhash(public key)` expresses signer authentication, but hashing cannot be reversed and does not use these keys.

**Sender:**

`Choose cover + content → choose depth/start → calculate capacity → hash content and stable cover representation → create verification record → sign record with private key → encrypt signed package → LSB embed → export stego + recovery file`

**Recipient:**

`Choose stego + recovery file + recovery code + trusted public key → authenticate recovery information → extract encrypted bits → decrypt → verify embedded signature → recompute content/media hashes → show verdict → preview/save verified content`

Extraction of the internal package necessarily precedes checking its embedded signature. The application releases the content for normal viewing/saving after verification. The interface can label this combined action **Extract & verify**.

- SHA-256 supplies integrity digests.
- Ed25519 signs the deterministic verification record through `cryptography`; verify using the public key selected by recipient B.
- AES-256-GCM protects content and start-location information.
- A public-key fingerprint supports comparison over a trusted channel. A key bundled with an unknown file does not establish signer identity by itself.
- A valid signature proves agreement with that key, not independent proof of the claimed person, a trusted timestamp, or replay prevention.

### 5. Secured start-location and recipient handoff

**Proposed v1 design: an encrypted `.stegloc` recovery file plus a generated recovery code.** This avoids needing an unprotected locator at the image's top-left or a guessable clear-text header inside the carrier.

1. Generate a cryptographically random 32-byte recovery secret, presented as a copyable/exportable recovery code. It is separate from the signing private key. V1 does not accept low-entropy free-form passwords.
2. Generate a random 16-byte salt. Use HKDF-SHA256 with separate versioned context labels to derive the payload-encryption, locator-encryption, and start-selection keys.
3. Allow either a manually selected start or a keyed suggested start. Suggest a nonzero location when capacity permits; report when only start zero would fit instead of silently selecting it for a nonzero demo.
4. For keyed suggestion, apply HMAC-SHA256 to the salt, carrier descriptor, depth, and required span; rejection-sample into the valid start range. Do not use Python's noncryptographic `random`.
5. Express an image start as `(x, y, R/G/B)`; an audio start as `(sample frame, channel)` with a time display; video as `(frame, x, y, B/G/R)`. Convert each to the adapter's deterministic logical slot index.
6. Embed contiguously from that slot, without wraparound. Show valid ranges and remaining capacity from the selected start.
7. Construct a bounded locator with protocol version, carrier descriptor, `k`, start, encoded byte length, media ID, and the expected encrypted-package SHA-256. Sign its exact serialized bytes with Ed25519 and encrypt locator plus signature with AES-GCM.
8. The recovery file contains only magic/version, salt, fresh locator nonce, and the encrypted signed locator. Authenticate the clear header as AES-GCM associated data. The payload uses its own fresh nonce and distinct key.
9. B supplies the code and file, authenticates/decrypts the locator, verifies its signature with the chosen public key, validates all bounds, then extracts exactly the described bytes. Compare the extracted ciphertext digest before decryption.
10. The embedded signed record repeats the media ID and placement parameters. Reject disagreement with the authenticated locator; reject substituted carrier/recovery-file pairs.

**Transfer demonstration:** Send the stego file and `.stegloc` as actual attachments; transmit the recovery code separately and establish the public-key fingerprint separately. B downloads into a different folder and performs verification using a fresh session. The original cover and sender's private key are not needed at B.

**Limits:** Location secrecy is an additional obstacle, not encryption by itself. Anyone possessing the code and recovery file can locate/decrypt the payload. Losing either prevents normal extraction. V1 does not claim recovery-file-free extraction, compression robustness, or replay protection. Include all required recipient artifacts in the demo instructions.

### 6. Payload protocol and circular-hash avoidance

Freeze a versioned binary framing format in `docs/protocol.md` before adapters are integrated. Use standard-library `struct` for fixed-length fields and bounded UTF-8 JSON for the record; content remains raw bytes, never base64 inside the carrier.

**Inner signed package:** fixed magic/version/flags/record-length/content-length header, deterministic record bytes, a 64-byte Ed25519 signature, and content bytes. Define byte order, field widths, maximum lengths, LSB bit order, and last-slot padding in the protocol document and golden vectors. The signature is over a versioned domain separator and the exact record bytes; its signed content digest binds the content.

**Record fields:** media ID (UUID), UTC timestamp, random nonce, team metadata, content filename/type/byte length, content SHA-256, carrier canonical SHA-256, carrier descriptor, depth, start slot, encoded byte length, protocol/hash/signature algorithms, and signer public-key fingerprint. Unknown algorithms or protocol versions fail closed.

**Outer embedded bytes:** 12-byte AES-GCM payload nonce followed by encrypted inner package and its 16-byte authentication tag. The record, content and signature overhead must all count toward capacity. The locator is an external artifact and does not consume carrier slots.

The original file's ordinary hash cannot simply be checked against the stego file: embedding changes it. Define a stable, explicitly scoped representation:

- Determine the occupied slots from `start`, `k`, and encoded length.
- In a canonical copy, zero only the low `k` bits of occupied slots. Retain higher bits and all untouched slots. For the final partial slot, write zero padding and validate that padding during decoding.
- For exact-size BMP/WAV/AVI, hash the entire original file byte sequence with only those carrier bits masked, prefixed by a versioned domain separator. This covers retained headers, padding and ancillary chunks as well as unoccupied media bytes.
- For PNG, hash a versioned fixed descriptor (width, height, supported color mode) plus decoded channel bytes with occupied RGB bits masked; include alpha unchanged. PNG compression choices and ancillary metadata are outside this PNG authenticity scope.
- Recompute the same representation at verification. The extracted encrypted package and content hashes protect embedded bits; the canonical carrier hash protects the remaining representation.

**Avoid a length/start/hash dependency cycle:** Build the record using fixed-width encodings for placement/length values and fixed-length hexadecimal hash placeholders. Freeze timestamp, ID, nonce and metadata for that operation. Measure the complete encrypted envelope, compute the occupied span and valid start, hash the canonical cover, then replace placeholders and sign/encrypt. Assert that the final serialized byte length equals the measured length before any write. The exact fixed widths and canonical JSON rules must be specified in the protocol task and covered by golden-vector tests.

Authenticity here refers to the signed canonical stego-media representation and hidden content. It does not restore the original overwritten bits or promise that every PNG file byte is authenticated. At `k=8`, occupied 8-bit channels are fully replaced; explain the potentially severe visible/audible impact.

### 7. Capacity and exact-size invariants

For `N` eligible slots, zero-based start `s`, depth `k`, and encrypted package length `E` bytes:

```text
available_bytes = floor((N - s) * k / 8)
required_slots  = ceil(E * 8 / k)
fits           = 0 <= s < N and s + required_slots <= N
```

- PNG/BMP: one slot per usable R/G/B channel; alpha, headers and BMP row padding are not carrier slots.
- WAV: one slot per integer channel sample, replacing its low `k` bits, not low bits of every byte in a multi-byte sample. Preserve signedness, endianness and original sample width.
- AVI: one slot per usable color channel in accepted frame chunks; container/index bytes and row padding are not slots.
- Show raw content bytes, protocol/security overhead, total embedded bytes, usable bytes from start, and remaining bytes. Do not compare payload length only with total cover file length.
- Recalculate after any change to cover, content, metadata, depth or start. The backend repeats validation at encode time.
- Clone and patch raw exact-size carriers; never reconstruct them using a writer that silently drops chunks or metadata.
- Enforce `len(stego) == len(original)` before releasing every exact-size export. If it fails, stop with a processing error.
- For PNG show original/export bytes and signed delta; never display an exact-size guarantee for it.

### 8. Verdicts must follow the evidence

Return structured stage results as well as an overall verdict: locator authentication, extraction, decryption, signature, content hash, carrier hash, and size policy. Stages can be passed, failed, skipped, or unavailable.

| Verdict | Evidence required / explanation |
|---|---|
| **Authentic** | Locator and embedded signatures valid under the chosen key, placement consistent, decryption successful, both hashes match |
| **Tampered** | A trusted expected ciphertext/content/carrier digest mismatches; identify the failed check |
| **Signature Invalid** | A parseable locator or record fails verification under the selected key; may be wrong key or altered signed data |
| **Payload Missing** | Reserved, not emitted by this encrypted v1 protocol: random-looking extracted bytes cannot establish absence. Use Cannot Verify without recovery evidence, or Tampered when an authenticated expected digest mismatches |
| **Wrong Start Location** | An explicit diagnostic override disagrees with the authenticated recovery location; do not infer this from random bytes alone |
| **Cannot Verify** | Missing recovery material/key, unsupported format/version, invalid lengths, or ambiguous authentication/decryption failure |

Wrong recovery code and corrupted encrypted locator are indistinguishable without additional evidence: say **Cannot Verify — recovery code or recovery file is invalid**. A ciphertext corruption with a previously authenticated locator digest is **Tampered**. Do not turn an AEAD failure into a claim that the signature was checked. The brief gives example verdict categories rather than requiring an unsupported diagnosis; document the reserved Payload Missing label instead of building an unreachable UI state.

## Chunk 2: Interface and implementation boundaries

### 9. Impeccable-guided visual brief

**Mode: Operate.** A student sender or recipient must complete and explain a security task in a classroom lab. The supplied reference is the visual authority: a cool, light scientific instrument panel with dark left navigation and cyan/coral signal graphics.

**Direction: media verification workbench.** The central visual is the user's original and protected media, with a useful capacity strip and verification trace. Translate the reference's technical precision into real measurements rather than filling the interface with unrelated gauges.

Provisional tokens, visually derived from the reference rather than claimed as exact sampled pixels:

| Role | Color | Usage |
|---|---|---|
| Canvas | `#EDF3F5` | Cool pale application background |
| Surface | `#FFFFFF` | Working panels and input fields |
| Navigation | `#304B57` | Dark slate left rail |
| Primary text | `#203640` | Readable headings/body |
| Secondary text | `#526873` | Labels and supporting copy |
| Divider | `#CDDCE1` | Panel boundaries and chart grids |
| Signal cyan | `#27C3D3` | Media traces, selection highlights, capacity fills |
| Action teal | `#087F8C` | Primary action with white text, subject to contrast verification |
| Coral | `#EE7078` | Protected/difference trace accent |
| Amber | `#E4B95B` | High-depth/capacity caution background |
| Success/error ink | `#176B54` / `#A52E43` | Verdict text with explicit icons and words |

Use Segoe UI/system sans-serif for Windows-friendly readability; a system monospace for hashes/byte counts. Target 15–16 px body text, clear 12–13 px minimum secondary labels, 24–28 px page headings, an 8 px spacing rhythm, fine dividers, restrained shadows, and modest corner rounding. Bright cyan/coral are graphical accents, not low-contrast body text.

**Navigation:** Protect, Verify, Keys, Demo Lab. Image/audio/video is a carrier selection within the workbench. Video is visibly unavailable until implemented.

**Protect layout at classroom laptop width:**

```text
┌──────────┬────────────────────────────────────────────────────────┐
│          │ Protect media                   Local session          │
│ Protect  ├────────────────────────────────────────────────────────┤
│ Verify   │ Image / Audio / Video     [drop cover or browse]       │
│ Keys     ├───────────────────────────┬────────────────────────────┤
│ Demo Lab │ ORIGINAL                  │ PROTECTED                  │
│          │ image / waveform / player │ image / waveform / player  │
│          │ file facts + exact bytes  │ file facts + size delta    │
│          ├───────────────────────────┴────────────────────────────┤
│          │ Payload: Text / File       [drop file or type message] │
│          │ Depth [1][2][3] [1–8]      Start [keyed / manual]       │
│          │ Capacity: content | overhead | remaining               │
│          │ Signing key ••••           [Protect & export]          │
│          ├────────────────────────────────────────────────────────┤
│          │ Hash → Sign → Encrypt → Embed → Export                 │
└──────────┴────────────────────────────────────────────────────────┘
```

After encoding, keep the original visible and fill the protected pane. Provide zoom/link-pan for images; play/pause and matched time controls for audio/video. Waveforms are calculated from actual audio. Optional difference overlay follows the core comparison; it is not a prerequisite for baseline completion.

**Verify:** drop stego and recovery file; provide recovery code and public key; run Extract & verify. Show received media and recovered content together, an explicit verdict, and expandable stage evidence with expected/actual digests, fingerprint, media ID, timestamp and scope. If the user supplies the original cover for comparison, show it too; successful verification must not depend on having it.

**Keys:** generate/import Ed25519 keys, show fingerprint, export public key and password-encrypted private PEM. Keep signing keys in memory for the active operation/session; explicit export is required for persistence. B's Verify screen never requests the signing private key.

**Interaction and states:**

- Drag/drop is paired with keyboard-accessible native file pickers; cover and payload zones have distinct labels.
- Empty state explains supported formats and invites the user's file. A separate labelled example action can load demo fixtures.
- Show inline unsupported-format, insufficient-capacity, missing-key, invalid-start, incorrect-recovery and processing errors with a next action.
- Disable the primary action only when required inputs are invalid; display the reason nearby. Invalidate stale estimates/results when inputs change.
- Expose real processing stages and measured byte progress where available; never animate fake security-check percentages.
- Support cancel/reset and release temporary files, object URLs, players and sensitive state.
- At wide widths use two comparable panes; at narrow widths stack Original before Protected with both accessible. Collapse navigation into a labelled compact menu.
- Verify contrast (4.5:1 body text, 3:1 applicable controls/large text), visible focus, non-color verdict cues, labelled errors, live announcements and reduced motion.
- Use native media controls; no autoplay. Animate only task transitions, about 150–200 ms, with reduced-motion fallback.

**Design acceptance:** The reference should be recognizable through the slate rail, pale instrument surfaces, cyan/coral media graphics and precise spacing. The workbench must remain legible at 1366×768 and on a projector. Store approved durable tokens in `DESIGN.md` during implementation; the image attached in chat is a reference, not an application background asset.

### 10. Planned repository structure

```text
PRODUCT.md                              confirmed context and marked assumptions
DESIGN.md                               approved interface rules (implementation task)
README.md                               setup, supported formats, sender/recipient walkthrough
pyproject.toml                          Python dependencies and test configuration
backend/app/main.py                     local API, lifespan, static frontend delivery
backend/app/workflows.py                inspect/protect/verify orchestration and verdicts
backend/app/session.py                  temporary artifacts, limits, cancellation and cleanup
backend/app/stego/lsb.py                 capacity, bit replacement/extraction, masks
backend/app/stego/protocol.py            framing, record/locator serialization and limits
backend/app/stego/security.py            hash, Ed25519, HKDF and AES-GCM operations
backend/app/stego/carriers/image.py      PNG and exact-size BMP adapters
backend/app/stego/carriers/audio.py      exact-size PCM WAV adapter
backend/app/stego/carriers/video.py      restricted AVI adapter, added at video milestone
frontend/package.json                   frontend commands/dependencies
frontend/src/App.tsx                    navigation and session routing
frontend/src/api.ts                     typed API client and result contracts
frontend/src/styles.css                 reference-led tokens, layout, states, responsiveness
frontend/src/features/protect/Protect.tsx
frontend/src/features/verify/Verify.tsx
frontend/src/features/keys/Keys.tsx
frontend/src/features/demo/DemoLab.tsx
frontend/src/components/FileDropZone.tsx
frontend/src/components/MediaComparison.tsx
frontend/src/components/CapacityMeter.tsx
frontend/src/components/VerificationTrace.tsx
tests/test_protocol.py
tests/test_security.py
tests/test_lsb.py
tests/test_image.py
tests/test_audio.py
tests/test_workflows.py
tests/test_api.py
tests/test_video.py                      added at video milestone
frontend/tests/workflows.spec.ts
scripts/make_demo_assets.py              explicit reproducible fixture generation
samples/README.md                        fixture provenance and generation instructions
docs/protocol.md                         wire format, canonicalization, trust and limits
docs/reference/assignment-excerpts.md    exact required sample text and visual-asset prerequisite
docs/reference/dashboard-reference.png  user-supplied reference; must be provided before visual build
docs/demo-plan.md                        timed sequence and named speakers
docs/test-evidence/                      real reports and screenshots
docs/submission-checklist.md
docs/originality-and-ai-use.md           template for team review/signature
docs/contributions.md                    real owners and agreed percentages
```

Adapters expose the same small contract: inspect descriptor and eligible slot count; read/write logical slots; stream the canonical hash; export. Implement shared behavior with functions and simple data classes. Avoid a plugin framework. Split a file further only when its actual responsibilities justify it.

**Proposed API:**

- `POST /api/covers`: streamed multipart ingestion; return session-scoped artifact ID, descriptor, size policy, preview information and eligible slots.
- `POST /api/payloads`: upload a content file, or use bounded text in the protect request.
- `POST /api/estimate`: validate current inputs/metadata/depth/start and return exact envelope capacity details.
- `POST /api/keys/generate`: generate exportable key material; import validation is part of the key operations. Never log responses containing secrets.
- `POST /api/protect`: create a bounded local job; result includes stego/recovery artifact IDs, size comparison and operation evidence.
- `POST /api/verify`: create a verification job with uploaded stego/recovery material, recovery code and public key; return staged verdict and verified-content artifact ID on success.
- `GET /api/jobs/{id}` and `DELETE /api/jobs/{id}`: poll progress/results and request cooperative cancellation.
- `GET /api/artifacts/{id}`: scoped download/preview with explicit content type and safe content-disposition.
- `DELETE /api/session`: remove artifacts and sensitive transient state.

Keep one bounded processing job active per local session; a standard worker thread is sufficient for baseline. Polling is enough; no WebSocket or external queue. Video adds chunk-level progress/cancellation to the same job contract. Long uploads/large raw media use temporary files and chunked processing rather than repeated full-memory copies.

Bind loopback only, validate Host/Origin, use same-origin production requests and a session token, and whitelist only the frontend development origin. Artifact IDs resolve through the session registry rather than arbitrary filesystem paths. Enforce upload, metadata, record, locator, image pixel and processing limits before allocation. Set initial limits as documented provisional values (e.g. 100 MiB image/audio and 512 MiB video input), then validate against demo hardware before release.

## Chunk 3: Ordered implementation tasks

Each task names its deliverable and proof. For algorithm, crypto, parser and workflow work, write the named failing regression/acceptance tests first, run them to establish the failure, implement the smallest passing solution, and rerun that focused group. Visual styling uses browser review rather than tests that mirror CSS. Commit milestones only when the user requests commits.

### Task 1 — Approve contracts and establish a runnable application

**Files:** `pyproject.toml`, `backend/app/main.py`, `frontend/package.json`, `frontend/src/App.tsx`, `frontend/src/api.ts`, `README.md`, `.gitignore`, `docs/protocol.md`.

- [ ] Approve the local-web stack, sidecar/code handoff and supported video subset; record decisions in this plan/PRODUCT.md.
- [ ] Make the original dashboard attachment available at `docs/reference/dashboard-reference.png` before Task 7; use the preserved assignment excerpts for Task 8 rather than inventing fixture text.
- [ ] Document exact carrier scope, depth interpretation, byte-length policy, canonical hash scope and verdict precedence in `docs/protocol.md`.
- [ ] Initialize Python package and Vite React/TypeScript application with only the listed dependencies; record tested versions and lock dependencies.
- [ ] Add local health endpoint and production frontend serving; add explicit development-origin configuration.
- [ ] Document Windows PowerShell setup/run commands and ignore keys, uploads, transient jobs, virtual environments and build outputs.
- [ ] Verify a fresh local startup and health request from the browser; confirm the backend is loopback-bound.

**Gate:** One documented startup path loads the empty application; no media/security feature is represented as implemented.

### Task 2 — Freeze the wire format and cryptographic operations

**Files:** `backend/app/stego/protocol.py`, `backend/app/stego/security.py`, `tests/test_protocol.py`, `tests/test_security.py`, `docs/protocol.md`.

- [ ] Write protocol golden vectors for empty/small content, Unicode filenames, fixed-width placement fields, maximum bounds, truncated buffers and unknown versions.
- [ ] Implement deterministic record serialization and fixed framing with explicit byte order and bounded length parsing. Verify signatures over exact received bytes before treating record contents as trusted.
- [ ] Implement SHA-256, Ed25519 generation/import/export/sign/verify, encrypted private PEM export, fingerprint display and malformed-key errors through `cryptography`.
- [ ] Implement random recovery code, salt, HKDF-separated keys, payload encryption, and signed/encrypted locator construction and validation.
- [ ] Test right/wrong public keys, changed signed bytes, altered ciphertext, wrong recovery code, distinct nonces, locator swaps, and payload/locator agreement checks.
- [ ] Assert envelope measurement remains exact when placeholder hashes and placement fields become final values.
- [ ] Run `python -m pytest tests/test_protocol.py tests/test_security.py -q`.

**Gate:** Deterministic framing and tamper/failure tests pass; no custom cryptographic primitives or private-key-based “hashing” appear in the implementation.

### Task 3 — Shared LSB engine, capacity and start selection

**Files:** `backend/app/stego/lsb.py`, `tests/test_lsb.py`.

- [ ] Test all `k=1..8`, starts at the beginning/middle/last-fitting location, final partial slots, exact fit, one-byte overflow, empty content with nonempty envelope, and invalid depths/indices.
- [ ] Implement integer capacity arithmetic, deterministic bit packing, low-bit replacement/extraction, padding checks and occupied-slot masks.
- [ ] Implement keyed nonzero start suggestion and manual coordinate/index conversion contracts; reject out-of-range requests before writes.
- [ ] Assert all untouched slots and all nonselected bits remain identical after embedding.
- [ ] Run `python -m pytest tests/test_lsb.py -q`.

**Gate:** The same bitstream round-trips at every depth without changing slot count or touching unrelated data.

### Task 4 — Image vertical slice

**Files:** `backend/app/stego/carriers/image.py`, `backend/app/workflows.py`, `tests/test_image.py`, `tests/test_workflows.py`.

- [ ] Add varied generated RGB/RGBA PNG and 24-bit BMP fixtures including padded rows and both supported BMP orientations.
- [ ] Implement signature-based format validation, dimension/resource bounds and clear rejection of unsupported image modes.
- [ ] Implement logical RGB indexing, PNG alpha preservation, raw BMP cloning/patching and image canonical hashing.
- [ ] Integrate estimate → record/sign/encrypt → embed → export and locator → extract/decrypt → signature/hash verification.
- [ ] Test fresh-reader round trips at all depths and nonzero starts; exact BMP byte size; preserved PNG dimensions/alpha; actual PNG output size reporting.
- [ ] Test changes to occupied payload bits, unoccupied low bits, high bits and alpha, plus mismatched image/recovery artifacts. Verify the documented PNG metadata exclusion.
- [ ] Run `python -m pytest tests/test_image.py tests/test_workflows.py -q`.

**Gate:** A caller can protect and verify its own supported image without a demo-specific path, original cover at verification time, or in-memory sender state.

### Task 5 — Audio vertical slice

**Files:** `backend/app/stego/carriers/audio.py`, `backend/app/workflows.py`, `tests/test_audio.py`.

- [ ] Add integer PCM fixtures for 8/16/24/32-bit mono/stereo, odd ancillary chunks, nonstandard chunk ordering, negative sample values and near-limit values.
- [ ] Parse and validate RIFF chunk boundaries, alignment, format fields and data bounds. Reject unsupported encodings and inconsistent headers.
- [ ] Map one logical slot to one channel sample; use the low bits of its least-significant byte for `k<=8`, preserving the other sample bytes.
- [ ] Clone/patch original data and compute the canonical raw-file hash without stripping ancillary chunks.
- [ ] Test content round trips at every depth, nonzero sample/channel starts, unchanged file size/duration/rate/channel count and byte-identical untouched chunks.
- [ ] Test sample tampering outside the embedded range, payload corruption, wrong key and wrong locator.
- [ ] Run `python -m pytest tests/test_audio.py tests/test_workflows.py -q`.

**Gate:** Image and audio both satisfy the protect/verify protocol; encoding does not resample, normalize, clip through arithmetic, or rewrite the WAV container.

### Task 6 — Local processing API and lifecycle

**Files:** `backend/app/main.py`, `backend/app/session.py`, `backend/app/workflows.py`, `tests/test_api.py`.

- [ ] Add API tests for user uploads, estimate/protect/verify, result download, invalid inputs, secret redaction, cross-session artifact access and cleanup.
- [ ] Implement streamed uploads, temporary artifact IDs, one-job session processing, polling, cancellation and expiration cleanup.
- [ ] Validate all operation parameters server-side; use actual parsed formats rather than trusting file extensions or browser MIME types.
- [ ] Enforce finite limits and bounded parsing before allocations; implement safe response filenames and no arbitrary-path download access.
- [ ] Add loopback/Host/Origin/session checks and prevent secrets, payload contents and private keys from entering logs or evidence reports.
- [ ] Run `python -m pytest tests/test_api.py -q`.

**Gate:** A fresh recipient session verifies previously exported artifacts through the API without relying on the sender's temporary workspace.

### Task 7 — Reference-led Protect, Verify and Keys UI

**Files:** `DESIGN.md`, `frontend/src/styles.css`, `frontend/src/App.tsx`, `frontend/src/api.ts`, the protect/verify/keys feature files and four shared components listed above, `frontend/tests/workflows.spec.ts`.

- [ ] Record approved visual rules in `DESIGN.md`; build the slate navigation rail, pale work surface and paired comparison panes using the supplied reference.
- [ ] Implement separate keyboard-accessible drop zones and native pickers for cover/content/recovery/key inputs; validate ambiguous multi-file drops explicitly.
- [ ] Add text/file payload switching, 1/2/3 presets, full 1–8 control, manual/keyed start, precise capacity breakdown and size-policy labels.
- [ ] Connect Protect & export with progress, cancellation, stego/recovery downloads and separately presented recovery code.
- [ ] Connect Extract & verify with independent stage statuses, trusted fingerprint, scoped verdict details and recovered-content preview/download.
- [ ] Add key generation/import/export with clear private/public labels and session reset.
- [ ] Implement actual image and audio comparison, linked comparison controls, native media playback, stale-result invalidation and object-URL cleanup.
- [ ] Add Playwright flows using both drag/drop and file pickers, error recovery, changed parameters, separate recipient session and keyboard-only completion.
- [ ] Run `npm run build` and `npx playwright test` from `frontend` after the scripts/configuration are established.
- [ ] Review at 1366×768, 1920×1080 and a narrow 390 px viewport; check contrast, focus, screen-reader status, long names, large hashes, reduced motion and real empty/error/success states.

**Gate:** A person can complete image and audio protect/verify operations through the GUI and compare input/output without terminal intervention.

### Task 8 — Required evidence and controlled failure demonstrations

**Files:** `frontend/src/features/demo/DemoLab.tsx`, `scripts/make_demo_assets.py`, `samples/README.md`, `docs/test-evidence/`, `tests/test_workflows.py`.

- [ ] Provide labelled, deterministic demo actions that mutate copies: carrier-bit tamper, embedded-bit corruption, unrelated public key, and diagnostic wrong-start override. Never alter the original user file.
- [ ] Generate short text and the exact Project Overview from `docs/reference/assignment-excerpts.md`, plus a custom encrypted file/message with recorded provenance. Preserve UTF-8 bytes as documented there.
- [ ] Run the acceptance matrix below and capture actual machine-readable reports/screenshots with software version and input/output hashes.
- [ ] Rehearse an actual A-to-B transfer with attachments and fresh recipient folder/session, retaining original-byte transfer evidence.
- [ ] Demonstrate that an unfamiliar supported cover and payload work through the same GUI.
- [ ] Run `python -m pytest -q` and the browser workflow tests once the baseline is integrated.

**Gate:** At least two successful cases and three meaningful failing cases, including success and failure for each mandatory carrier, are reproducible from documented instructions. Baseline demo is ready before video work starts.

### Task 9 — Video-inside-video milestone

**Files:** `backend/app/stego/carriers/video.py`, `backend/app/workflows.py`, `frontend/src/components/MediaComparison.tsx`, `tests/test_video.py`, `samples/README.md`, `README.md`.

- [ ] Prove the supported AVI subset first: inspect a real fixture's RIFF/stream/frame/index structure; document exact accepted headers and reject all other variants.
- [ ] Implement a bounded walker for classic RIFF AVI/LIST structures, video frame chunks and BGR row layouts; preserve indexes, padding and all chunk lengths. Add malformed/truncated/oversized-chunk tests before byte-patching.
- [ ] If preparation is included, use FFmpeg via argument arrays and a fixed preset such as rawvideo BGR24 AVI; validate its actual output against the supported subset. Do not assume every FFmpeg AVI is eligible.
- [ ] Map frame/pixel/channel coordinates to slots and process frames in bounded chunks. Add stage progress and cooperative cancellation.
- [ ] Hide a complete small playable video file as payload, extract it and compare SHA-256 to the original payload.
- [ ] Assert exact cover/stego byte length and unchanged dimensions, frame count, timing and all non-carrier bytes. Run an independent FFmpeg decode check on original and protected AVI.
- [ ] Produce browser-compatible preview proxies only where required; label them and use the raw AVI for extraction and size comparisons.
- [ ] Test more than one user-created cover/payload, overflow, nonzero frame start, k=1/2/3 and supported higher depths, damaged frames and cancellation.
- [ ] Run `python -m pytest tests/test_video.py -q` and add a video Playwright smoke workflow.

**Gate:** Demonstrate playable original/protected cover video and playable recovered video, byte-identical recovered payload, exact-size raw carrier preservation, and a documented capacity/resource ceiling on demo hardware.

### Task 10 — Submission and final rehearsal

**Files:** `README.md`, `docs/demo-plan.md`, `docs/submission-checklist.md`, `docs/originality-and-ai-use.md`, `docs/contributions.md`, `docs/test-evidence/`.

- [ ] Finish fresh-machine Windows setup instructions, tested Python/Node/browser versions, lockfiles, commands, optional FFmpeg installation, supported formats, limits and troubleshooting.
- [ ] Package original/stego/tampered samples, public keys, recovery artifacts and explicitly demonstration-only secrets or safe reproduction instructions. Never include real private signing keys.
- [ ] Explain security scope, start-location recovery, size guarantees, compression fragility, PNG metadata limits, key trust, missing recovery material and replay limitations.
- [ ] Record the implemented innovation and its evidence: secured variable-start handoff and explainable verification trace; add video only if its milestone passed.
- [ ] Have the team complete/sign the originality and AI-use disclosure and agree actual contribution percentages totaling 100%; do not invent contributions or signatures.
- [ ] Assign every member a named technical section and timed speaking slot, then rehearse within 25 minutes.
- [ ] Verify setup and required cases from a clean environment using exported artifacts rather than development-session state.
- [ ] Run the final backend tests, frontend build and browser suite; archive their actual results once, fixing and rerunning only failed/affected checks.

**Gate:** Complete reproducible submission, named individual accountability and a rehearsed demo. Submit demo plan/declarations/contributions one day before the assigned demo, and the final source/evidence package by Week 5 Friday, as stated in the brief.

## Chunk 4: Acceptance evidence and delivery checklist

### 11. Requirement traceability

| Requirement | Planned implementation | Proof |
|---|---|---|
| FR1 Image input | Task 4 PNG + exact-size BMP | Own-file image import/round trip |
| FR2 Audio input | Task 5 PCM WAV | Own-file audio import/round trip |
| FR3 Payload generation | Task 2 record + Tasks 4/5 integration | Decode ID/timestamp/hash/nonce/metadata |
| FR4 Digital signature | Task 2 Ed25519, Task 7 Keys/Verify | Right-key success and wrong-key failure |
| FR5 Image embedding | Tasks 3/4 | Nonzero-start PNG/BMP LSB round trip |
| FR6 Audio embedding | Tasks 3/5 | Nonzero sample/channel PCM round trip |
| FR7 Variable secured start | Tasks 2/3/7 | Manual + keyed start; authenticated locator recovery; tamper/missing-code failure |
| FR8 Extraction/decoding | Tasks 4–7 | Fresh-session extraction and content comparison |
| FR9 Hash verification | Tasks 2/4/5 | Signed content + canonical carrier digest checks |
| FR10 Verdict generation | Tasks 4/6/7 | Evidence-specific status matrix |
| FR11 Positive/negative cases | Task 8 | At least 2 positive + 3 negative; both image/audio covered |
| FR12 Reproducibility | Tasks 8/10 | Clean setup, source, samples and recorded evidence |
| FR13 Innovation | Tasks 2/3/7/8, then 9 | Secured variable-start workflow and useful trace; actual video extension if passed |
| Selectable 1–8 LSBs | Tasks 3/7 | GUI and round trips at every depth |
| Drag/drop and flexible inputs | Task 7 | Text/file payloads and drop/picker parity |
| Input/output display/playback | Tasks 7/9 | Paired images/audio/video and recovered content |
| No hardcoded user files | Tasks 4–9 | New file names/content outside sample directory |
| File size unchanged | Tasks 4/5/9 | Exact byte-size assertions; explicit PNG exception |
| Video in video | Task 9 | Playable recovered payload with equal original/recovered SHA-256 |

### 12. Minimum evidence matrix

| ID | Case | Expected result |
|---|---|---|
| P1 | PNG + Learning Objective text, k=1, nonzero start, fresh recipient session | Authentic; exact recovered text; PNG byte-size delta shown |
| P2 | PCM WAV + full Project Overview text, k=2, nonzero sample start | Authentic; exact recovered text; equal cover/stego byte sizes |
| P3 | BMP + encrypted custom arbitrary file, k=3, keyed start | Authentic; recovered file digest matches; exact-size carrier |
| N1 | Change an unoccupied image channel bit while retaining the embedded package | Tampered; carrier digest mismatch |
| N2 | Change an unoccupied audio sample bit | Tampered; carrier digest mismatch |
| N3 | Verify with unrelated Ed25519 public key | Signature Invalid; no authenticity claim |
| N4 | Flip a bit in the encrypted hidden package with a valid recovery locator | Tampered; ciphertext digest mismatch |
| N5 | Supply incorrect recovery code or damaged encrypted locator | Cannot Verify; code/file ambiguity explained |
| N6 | Apply explicit start override differing from authenticated start | Wrong Start Location diagnostic |
| N7 | Envelope exceeds available capacity by one byte | Encode blocked; original unchanged; no output artifact |
| N8 | Supply stego from another operation with a valid but unrelated recovery file | Tampered or Cannot Verify according to the first failed check; never Authentic |
| N9 | Fresh ordinary image/audio file without recovery material | Cannot Verify; no unsupported claim of global payload absence |
| V1 | Small video in accepted larger AVI | Authentic; payload SHA-256 equality; exact-size carrier; all three videos playable |

Also cover all supported sample widths, both audio channel counts, every depth 1–8, partial-slot padding, corrupt lengths, unsigned metadata changes, expired jobs, and large-but-allowed files in automated tests. Select deterministic negative mutations that exercise distinct checks rather than expecting every corruption to produce the same verdict.

### 13. Milestones and demo allocation

| Milestone | Dependency | Exit criterion |
|---|---|---|
| M0 Contracts + runnable shell | Approval | Task 1 gate |
| M1 Security + bit engine | M0 | Tasks 2/3 gates |
| M2 Image + audio engine | M1 | Tasks 4/5 gates |
| M3 End-to-end GUI baseline | M2 | Tasks 6/7 gates |
| M4 Assessment-ready evidence | M3 | Task 8 gate |
| M5 Video demonstration | M4 | Task 9 gate |
| M6 Submission/rehearsal | M4, plus M5 if included | Task 10 gate |

Suggested workstream ownership: security/protocol, image adapter, audio adapter, frontend/integration/evidence; assign video after the baseline. These are responsibilities to allocate to actual members, not assumed team size or predetermined contribution percentages.

Suggested 25-minute maximum demonstration:

- 0–3 min: purpose, architecture, payload structure, signing versus hashing.
- 3–8 min: image protect/compare, depth/start/capacity and first negative case.
- 8–13 min: audio protect/play/compare, exact-size proof and audio negative case.
- 13–18 min: actual A-to-B received-file extraction, key trust, hashes and wrong-key case.
- 18–21 min: custom encrypted payload, secured-start explanation and video if passed.
- 21–23 min: limitations, implemented innovation, contribution and AI-use reflection.
- 23–25 min: questions/buffer.

Every member must have an explicit speaking/demo segment; adapt durations to the real team and avoid spending the buffer waiting for an email or a large video conversion.

### 14. Approval checkpoint

Confirmed: exact-size mode for compatible carriers, plus clearly labelled variable-size PNG exports.

Approve or amend these proposed choices before coding:

1. Local React + Python web application.
2. Recovery-file + separate generated-code workflow for secured start recovery and content confidentiality.
3. PNG/BMP and integer PCM WAV baseline; restricted uncompressed AVI video extension after baseline acceptance.
4. Instrument-workbench design derived from the supplied reference, with side-by-side media as the primary surface.

After approval, execute Tasks 1–8 in order to obtain the assessment-ready baseline, then Task 9 and final Task 10 rehearsal/package. Preserve the user-confirmed exact-size exception and never silently substitute a compressed-video export for an exact-size carrier.
