# Stegloc code guide for a presentation

Start at the [app factory](../backend/app/main.py) for the HTTP service and at [App](../frontend/src/App.tsx) for the screen router. The desktop launcher starts the same service inside a WebView window. The API calls are local; the browser and desktop interface use the same routes.

## Module map

| Topic | Input → output | Code to show | Proof to show |
| --- | --- | --- | --- |
| Media carriers | PNG/BMP, PCM WAV or AVI bytes → eligible sample slots and exported media | `backend/app/stego/covers.py`, `backend/app/stego/carriers/` | `tests/test_image.py`, `test_audio.py`, `test_video_v2.py` |
| Bit embedding | Slots, bytes, depth and start → changed slots or recovered bytes | `backend/app/stego/lsb.py` | `tests/test_lsb.py` |
| Legacy record | File details, hashes and placement → stable record and encrypted package shape | `backend/app/stego/legacy_record.py` | `tests/test_workflows.py`, `test_api.py` |
| Legacy capacity | Cover size and payload size → capacity and a safe nonzero start | `backend/app/stego/legacy_capacity.py` | `tests/test_workflows.py` |
| Legacy sender | Cover, content, RSA private key and passphrase → stego file and report | `backend/app/stego/legacy_embed.py`, `legacy_report.py` | `tests/test_workflows.py` |
| Legacy receiver | Stego file, passphrase and RSA public key → verdict, checks and content | `backend/app/stego/legacy_verify.py` | `tests/test_workflows.py`, `test_api.py` |
| V2 record and sender | Cover, content, Ed25519 key → protected carrier, sidecar and recovery code | `backend/app/v2_record.py`, `v2_protect.py` | `tests/test_protocol.py`, `test_v2_security.py`, `test_video_v2.py` |
| V2 receiver | Carrier, sidecar, code and public key → per-stage verdict and content | `backend/app/v2_verify.py`, `v2_results.py` | `tests/test_v2_security.py`, `test_v2_api.py` |
| Text carriers | Encrypted frame and method → acrostic, whitespace or zero-width carrier | `backend/app/stego/text_carrier.py` | `tests/test_v3.py` |
| Signed text | Message and Ed25519 key → signed, encrypted text; reverse with recovery material | `backend/app/stego/text_v3.py` | `tests/test_v3.py` |
| Steganalysis | Image/audio and optional original → descriptive statistics and comparison images | `backend/app/stego/analysis.py`, `analysis_parts/` | `tests/test_bpcs_v2.py`, `test_v3.py` |
| API and sessions | Form uploads → workflow calls, jobs and downloadable artifacts | `backend/app/api/`, `session.py` | `tests/test_api.py`, `test_v2_api.py`, `test_v3.py` |
| Interface | User inputs → typed requests and result panels | `frontend/src/api/`, `frontend/src/pages/`, `frontend/src/ui/` | `frontend/src/pages.test.tsx`, `logic.test.ts` |

`engine.py`, `workflows.py`, `v2_api.py`, `v3_api.py` and `components.tsx` keep existing imports working; the named modules above contain the implementations. The legacy `STG1` RSA/passphrase format, V2 Ed25519 sidecar format and V3 text format are separate protocols.

## Four call traces

1. **Legacy embedding and verification.** The Embed form calls `api.hide()`, then the `/api/hide` route calls `legacy_embed.hide()`. A carrier adapter exposes eligible slots. The sender builds a record, hashes the payload and stable cover, signs the record digest with RSA, encrypts the package and header, and writes bits through `lsb.encode()`. `/api/verify` calls `legacy_verify.verify()`, which reads the header, decrypts and extracts the package, checks the signature and hashes, and returns each stage and the final verdict. The page renders those stages in `pages/verify/Result.tsx`.
2. **V2 API protection.** The v2 API starts a session and protection job. `api/v2_protection.py` chooses the image, audio or video adapter; `v2_record.estimate()` accounts for the actual envelope size; `v2_protect` signs and encrypts the content. The carrier, `.stegloc` sidecar and separate code are stored as session artifacts. `v2_verify` checks the locator, ciphertext, signature, content and canonical carrier hash. The standalone V2 Workbench page has been removed.
3. **Text steganography.** The Text page sends the message, method and key to `api/text.py`. `text_v3.protect()` signs the hidden message, encrypts the frame and calls `text_carrier.encode()`. The receiver calls `text_carrier.decode()` and `text_v3.verify()` with the sidecar, code and public key. Acrostic words may change if their initials survive; trailing spaces/tabs and zero-width symbols must survive exactly. Visible prose is outside the signature.
4. **Analysis.** `/api/analyse` calls `analysis.analyse()` after upload checks. The coordinator loads one carrier, selects a channel and runs focused analyzers in `analysis_parts/`. `pages/analysis/Results.tsx` presents the findings through Chi-Square, RS, bit-plane, BPCS, histogram and exact comparison panels. A reference cover enables exact differences and quality metrics; statistical results alone are descriptive.

## Questions to prepare for

- **Encryption versus signatures:** AES-GCM protects confidentiality and detects ciphertext changes. RSA in legacy and Ed25519 in V2/V3 authenticate the sender's signed record or message. A valid signature is checked with the trusted public key.
- **What is a slot?** One eligible carrier byte whose least significant bits may hold payload bits. Image channels, PCM sample bytes and AVI frame bytes expose different slot layouts; the adapters own those details.
- **Why is capacity smaller than raw LSB space?** The signed record, signature, nonce, authentication tag and V2 recovery information take bytes too. Capacity is calculated before embedding.
- **Why choose a start?** The legacy header stores an encrypted position; V2 puts authenticated placement in the separate recovery material. The sender avoids an unusable start and checks the payload fits.
- **Why a canonical cover hash?** Embedding necessarily changes selected low bits, so hashing the raw carrier would fail. The hash calculation normalizes permitted embedded bits, then checks the rest of the carrier.
- **What does a verdict mean?** The receiver reports which checks passed or failed. `Authentic` requires the cryptographic and carrier checks; `Cannot Verify` means required evidence could not be established. A steganalysis score is never an authenticity verdict.
- **Can Chi-Square, RS or BPCS prove a hidden message?** No. Texture, noise, small samples, editing and other embedding methods can mislead them. The original carrier enables a stronger exact comparison.
- **What happens on cancellation?** `api/session_jobs.py` marks the job cancelled and removes artifacts created by that unsuccessful job. Session state and downloads are scoped to the session.

For a live Q&A, open the module in the third column, describe its input and output, and run the relevant test from the fourth column.
