# Stegloc code guide for a presentation

Start at [the app factory](../backend/app/main.py) for HTTP registration and [App](../frontend/src/App.tsx) for screen routing. [The desktop launcher](../backend/desktop.py) starts the same service inside a WebView window. Browser and desktop use the same local API.

For an individual module, explain its input, output, main function, security boundary and one test. All paths below are relative to the repository root.

## Module map

| Topic | Input → output | Implementation | Evidence |
| --- | --- | --- | --- |
| Spatial LSB | Eligible bytes, depth and start → embedded or recovered bytes | `backend/app/stego/lsb.py` | `tests/test_lsb.py` |
| Image/audio covers | Image or PCM WAV → slots and exported media | `backend/app/stego/covers.py` | `tests/test_image.py`, `tests/test_audio.py` |
| RSA record and capacity | File details and payload size → framed record and safe placement | `backend/app/stego/lsb_record.py`, `backend/app/stego/lsb_capacity.py` | `tests/test_workflows.py` |
| RSA sender and receiver | Cover/payload/key/passphrase → protected file or checked content | `backend/app/stego/lsb_embed.py`, `backend/app/stego/lsb_verify.py`, `backend/app/stego/lsb_report.py` | `tests/test_workflows.py`, `tests/test_api.py` |
| RSA cryptography | Keys, plaintext and digests → signatures and authenticated ciphertext | `backend/app/stego/security.py` | `tests/test_security.py` |
| DCT PNG | Image and envelope → transform blocks and verifiable PNG | `backend/app/stego/dct_codec.py`, `backend/app/stego/dct_protocol.py` | `tests/test_dct.py`, `tests/test_dct_api.py` |
| Media recovery cryptography | Ed25519 key and recovery secret → signed encrypted bundle and locator | `backend/app/stego/recovery_security.py`, `backend/app/stego/protocol.py` | `tests/test_protocol.py`, `tests/test_recovery_security.py` |
| Media sender and receiver | Carrier/payload/key → protected carrier; recovery inputs → checked content | `backend/app/media_record.py`, `backend/app/media_protect.py`, `backend/app/media_verify.py`, `backend/app/media_results.py` | `tests/test_media_api.py`, `tests/test_video.py` |
| Video carriers | AVI or compatible encoded video → frame slots and lossless output | `backend/app/stego/carriers/video.py`, `backend/app/stego/carriers/video_mp4.py` | `tests/test_video.py`, `tests/test_media_workflows.py` |
| Preparation, comparison and retry | Source/options or manual location → prepared cover, differences or verdict | `backend/app/api/media.py`, `backend/app/api/video_verify.py` | `tests/test_media_workflows.py`, `frontend/src/pages/VideoWorkflow.test.tsx` |
| Signed text | Message/key → encrypted text; recovery inputs → verified message | `backend/app/stego/signed_text.py`, `backend/app/stego/text_carrier.py` | `tests/test_text.py` |
| Steganalysis | Image/audio and optional original → descriptive statistics and differences | `backend/app/stego/analysis/service.py`, `backend/app/stego/analysis/`, `backend/app/stego/analysis_parts/` | `tests/test_analysis_service.py`, `tests/test_analysis_chi_square.py`, `tests/test_analysis_bpcs.py` |
| Tamper cases and evidence | Protected file and credentials → verdicts, variants and ZIP | `backend/app/stego/attacks.py`, `backend/app/api/tamper_tests.py` | `tests/test_workflows.py`, `tests/test_media_workflows.py` |
| Jobs and artifacts | Session and task → progress, cancellation and scoped downloads | `backend/app/api/session_jobs.py`, `backend/app/api/sessions.py`, `backend/app/session.py` | `tests/test_media_api.py`, `tests/test_module_boundaries.py` |
| Interface | User inputs → typed requests and result panels | `frontend/src/api/`, `frontend/src/pages/`, `frontend/src/ui/` | `frontend/src/pages.test.tsx`, `frontend/src/logic.test.ts` |

`engine.py` selects the image/audio method; `workflows.py` exposes workflow entry points. `media_api.py` and `text_api.py` register handlers. RSA image/audio, DCT PNG, Ed25519 media recovery and signed text are current, distinct formats. Stored format identifiers remain fixed so existing protected files remain readable.

## Call traces

1. **Spatial image/audio.** Embed form → `api.hide()` → `/api/hide` → `engine.hide()` → `lsb_embed.hide()`. The sender hashes the payload and normalized cover, signs the record digest with RSA, encrypts package/header, then writes bits through `lsb.encode()`. `/api/verify` dispatches to `lsb_verify.verify()` to check the header, package, signature and hashes. `frontend/src/pages/verify/Result.tsx` renders the stages.
2. **DCT.** The image form supplies method `dct`. `engine.hide()` selects `dct_protocol.hide()` → `DctCarrier.embed_ranges()` → a reopened, checked PNG. Verification detects framing from image data and calls `dct_protocol.verify()`. Recognized invalid DCT framing is rejected rather than retried as spatial LSB.
3. **Media recovery.** `/api/session` establishes a session. `/api/jobs/media/protect` → `api/media_protection.py` → `media_protect` builds a signed encrypted package. Outputs include a carrier, `.stegloc` and separate code. `/api/jobs/media/verify` → `media_verify` checks locator, ciphertext, signature, payload and canonical carrier before publishing content.
4. **Video.** `VideoWorkflow.tsx` calls `/api/media/probe` and, when needed, `/api/media/prepare`, then the media protection job. `/api/video/verify` → `video_verify.verify_at()` evaluates stored or manual placement. `VideoInspect.tsx` calls `/api/video/compare` for frame previews and comparison data.
5. **Text.** `TextPage.tsx` → `api/text.py` → `signed_text.protect()` signs/encrypts the message → `text_carrier.encode()`. Verification decodes and authenticates using `.stegloc-text`, the code and public key. Visible prose is outside the signature.
6. **Analysis.** `/api/analyse` → `analysis.analyse()` → `analysis/service.py` runs bit-plane, histogram, Chi-Square, BPCS, RS and comparison helpers. `frontend/src/pages/analysis/Results.tsx` presents descriptive findings. An original enables exact differences and quality metrics.
7. **Evidence.** `AttackPage.tsx` → `/api/jobs/tamper-tests` → `attacks.run_suite()` or `_video_suite()`. Each case uses a separate copy. `/api/jobs/{ident}/evidence` assembles session files, steps and report. `TextShowcase.tsx` uses the separate `/api/jobs/text-tamper-tests` route and text inputs.

## Supplement: DCT image protection

**Start with `DctCarrier` in `dct_codec.py`.** A spatial slot is a carrier byte; a DCT slot is a complete 8×8 block in one RGB channel. It stores one bit by ordering coefficients `(2, 3)` and `(3, 2)`. Block order is row, column, then R/G/B. Incomplete edge blocks carry no data. Placement is automatic; spatial LSB depth and manual pixel settings do not apply.

**Explain capacity and output checks.** The last 1,024 transform slots hold a 128-byte encrypted bootstrap. The payload starts after slot zero and must end before it. Capacity includes record, signature, nonce and tag. `embed_ranges()` tries coefficient separations of 32, 64, 128 and 256, reopens the PNG and checks the exact hidden bytes. Failed recovery publishes no output. This handles transform rounding; it is not error correction.

**Show `dct_protocol.hide()` and `verify()`.** The RSA-signed record binds payload hash/length, image dimensions and placement. PBKDF2 derives separate encryption and placement keys; AES-GCM protects bootstrap and package. Verification checks authentication, bounds, signature, payload, placement, dimensions and cover hash before releasing content.

**State the boundary.** The cover hash includes RGB outside occupied channel blocks and every alpha byte. Edits inside occupied blocks can pass if encoded bits survive. PNG metadata is outside the hash. Lossless export does not promise survival after resizing or JPEG recompression. `test_dct.py` and `test_dct_api.py` cover round trips, capacity and damaged framing/payload. See [the DCT format](dct-protocol.md).

## Supplement: video processing and verification

**Preparation:** `api/media.py` probes codecs, streams, timing and dimensions through FFmpeg/ffprobe. Compatible constant-frame-rate inputs retain their container. Other sources can become a bounded AVI segment with PCM audio. MP3 preparation creates PCM WAV. `_run()` bounds subprocess execution and responds to cancellation. Preparation operates on the sender's cover; verification does not transcode received protected files.

**Adapters:** `carriers/video.py` patches uncompressed AVI frame bytes, preserving audio, padding, headers, index, timing and file length. Slots run frame, row, pixel, B/G/R. `carriers/video_mp4.py` decodes compatible video to RGB, embeds low bits and writes a lossless stream in the source container while copying audio. Slots run frame, row, pixel, R/G/B. Reopened frames must preserve embedded bytes; decoded audio participates in the canonical carrier hash. Lossless output can grow substantially and playback depends on codec support.

**Recovery and retries:** video uses Ed25519, an encrypted `.stegloc` locator and a random recovery code. `media_verify.verify_video()` checks locator/ciphertext, decrypts, checks signature/content/placement, then recomputes the carrier hash. `api/video_verify.py` accepts either a flat slot or complete frame/X/Y/channel coordinates. A wrong override on a valid baseline is **Wrong Start Location**. Failed attempts do not release content.

**Comparison:** `/api/video/compare` returns frame previews, low-bit views, changed pixels/bits, heatmap and timeline. A reference must match dimensions, frame count and timing. These describe edits; cryptographic checks determine authenticity. Start with `tests/test_video.py` for adapters and `tests/test_media_workflows.py` for preparation, retries, comparison and tamper cases. See [media recovery](media-recovery.md) for accepted limits.

## Supplement: tamper tests and evidence export

**Case runners:** `attacks.run_suite()` covers RSA image/WAV and DCT PNG. `_video_suite()` in `api/tamper_tests.py` covers baseline, unrelated public key, cover bit change outside the payload and payload bit change. An authentic baseline is required before interpreting negative cases. Spatial tests unsupported by DCT are marked not applicable. Text has its own baseline, wrong code/key, hidden-symbol and visible-wording cases.

**Inputs:** the media job stores the supplied protected file, optional original/recovery file, public PEM and passphrase or video recovery code. The original is included only when supplied; it is not reconstructed. Each completed case records mutation, expected verdict, observed verdict and available verification stages. A partial export reports only completed cases.

**ZIP writer:** `evidence()` uses standard-library `zipfile`, `hashlib` and `html`:

| Path | Purpose |
| --- | --- |
| `inputs/original.*`, `inputs/protected.*`, optional `inputs/recovery.*` | Reproduce the supplied media check |
| `keys/public_key.pem` | Repeat with the same public key |
| `credentials/passphrase.txt` or `credentials/recovery-code.txt` | Repeat decryption with the verification secret |
| `tampered/` | Generated test variants |
| `heatmaps/embedding.png`, when available | Compare image or first video frame |
| `results.json` | Structured outcomes, input descriptors and conversion settings |
| `sha256-manifest.json` | SHA-256 for every other archived file |
| `report.html` | Offline summary, file hashes/sizes, key, verification secret, replay steps and case details |

The report's rings/table summarize actual counts and verdicts. Embedded styles support offline reading and printing. Manifest hashes detect changes against that manifest; an unsigned manifest does not authenticate the archive's author. The ZIP includes verification secrets but excludes private keys and extracted plaintext. Session expiry/reset removes stored artifacts.

The text runner currently records outcomes without capturing the full media input/credential bundle. State that boundary in a text demonstration. `test_live_showcase_existing_file_and_export` in `tests/test_media_workflows.py` checks image/WAV inputs, credentials, variants, HTML and manifest hashes. `demo/evidence/stegloc-evidence.zip` is the reproducible WAV example.

## Function names and routes

Modules/tests use responsibility names such as `media_protect`, `media_verify`, `recovery_security`, `signed_text`, `video_verify` and `tamper_tests`. Current callers use:

| Responsibility | Routes |
| --- | --- |
| RSA image/audio and DCT | `/api/hide`, `/api/verify`, `/api/estimate` |
| Sessions/artifacts | `/api/session`, `/api/jobs/{ident}`, `/api/artifacts/{ident}` |
| Ed25519 keys | `/api/signing-keys/generate`, `/api/signing-keys/inspect` |
| Media recovery | `/api/media/estimate`, `/api/jobs/media/protect`, `/api/jobs/media/verify` |
| Preparation/video | `/api/media/probe`, `/api/media/prepare`, `/api/video/compare`, `/api/video/verify` |
| Text | `/api/text/estimate`, `/api/jobs/text/protect`, `/api/jobs/text/verify` |
| Tests/export | `/api/jobs/tamper-tests`, `/api/jobs/text-tamper-tests`, `/api/jobs/{ident}/evidence` |

Old numbered API paths have been replaced; external callers must use these paths. Stored magic bytes, signed protocol values and cryptographic domain strings remain unchanged. Changing them requires a separate file-format migration.

## Questions to prepare for

- **Encryption versus signatures:** AES-GCM encrypts and authenticates ciphertext. RSA or Ed25519 checks the signed record/message against a trusted public key. Knowing a passphrase does not establish sender identity.
- **Slot versus X/Y:** a spatial slot is one eligible channel/sample byte. X/Y select a pixel with `(0, 0)` at the top left; its channel selects the byte. Video also needs a frame. DCT slots index transform blocks. Each adapter owns its mapping.
- **Why less capacity than raw bit space?** Record, signature, nonce, tag and placement information occupy space. Capacity includes that envelope.
- **Why a normalized cover hash?** Embedding changes bits. The hash masks permitted low-bit changes or excludes occupied DCT blocks and checks remaining covered data. State its scope rather than claiming every byte is authenticated.
- **What does Authentic mean?** Required cryptographic and covered-carrier checks passed. It does not prove ownership of the key, covertness, or authenticity of data outside the integrity scope.
- **Can analysis prove hidden content?** No. Texture, noise, sample size and editing affect Chi-Square, RS and BPCS. An original enables measured comparison; signatures authenticate content.
- **Cancellation?** Jobs check cancellation and remove unpublished artifacts. Outputs/downloads belong to the current session.

Open one implementation and run its evidence file, for example `python -m pytest -q tests/test_dct.py`. Explain its input/output boundary, then one successful case and one rejected case.
