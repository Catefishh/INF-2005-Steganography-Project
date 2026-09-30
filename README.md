# Stegloc

Stegloc **0.4.0** is the INF2005 ACW1 steganography application for Windows desktop and local browser use. It hides signed, encrypted messages or files in images, PCM WAV audio, supported video, and text carriers, then checks the sender's signature and content integrity before releasing the recovered payload.

The React interface and Python FastAPI service run locally. The Windows distribution includes the frontend and FFmpeg tools and works offline after setup.

## Workflows

| Screen | Route | Purpose |
| --- | --- | --- |
| **Keys** | `/keys` | Generate or load an RSA key pair, check fingerprints, and download the keys |
| **Embed & Sign** | `/embed` | Hide text or any payload file in an image, audio clip, or video; show capacity and the resulting file |
| **Extract & Verify** | `/verify` | Reupload a protected file, supply its verification material, and inspect the verdict and verification stages |
| **Text Steganography** | `/text` | Generate and verify signed, encrypted acrostic, trailing-whitespace, or zero-width text |
| **Inspect a file** | `/inspect` | Examine bit planes, statistical measurements, and differences against an optional original |
| **Tamper tests** | `/tamper-tests` | Run controlled positive and negative verification cases and export evidence |

Embed and verification results have their own `/embed/result` and `/verify/result` routes. Browser Back/Forward navigation works within the studio. A working-file strip carries the selected media file and its SHA-256 between screens; **Replace file** and **Clear workspace** manage that selection. Keys, form inputs, and working files are kept in the current tab, so download them before refreshing or closing it.

### Protection formats and keys

| Workflow | Signature and encryption | Recipient needs |
| --- | --- | --- |
| Image / WAV spatial LSB | RSA-PSS, SHA-256, AES-256-GCM; passphrase-derived keys | Protected file, passphrase, RSA public key |
| Image **DCT · lossless PNG** | RSA-PSS, SHA-256, AES-256-GCM; passphrase-derived keys | Protected PNG, passphrase, RSA public key |
| Video / media recovery | Ed25519, SHA-256, AES-256-GCM; random recovery secret | Protected file, `.stegloc` recovery file, recovery code, Ed25519 public key |
| Signed text | Ed25519, SHA-256, AES-256-GCM; random recovery secret | Carrier text, `.stegloc-text` recovery file, recovery code, Ed25519 public key |

**Keys** manages RSA keys and generates RSA-2048 pairs. Video and text have their own Ed25519 key controls and require a password when generating an encrypted private PEM. RSA keys and Ed25519 keys are not interchangeable. The media recovery API also supports restricted image and WAV carriers; the main image/audio form uses RSA and a passphrase.

Keep the private key with the sender. Give the recipient the trusted public key, and share the passphrase or recovery code separately from the protected file and recovery material. Verification does not require the original cover or the private key.

## Supported media

Payload files are arbitrary bytes, including MP3, MOV, and MP4. Capacity includes the signed record, signature, encryption, and framing overhead; it is smaller than the raw available bit space.

| Cover or source | Protected output | Preservation and limits |
| --- | --- | --- |
| PNG, JPEG, GIF, WebP, TIFF, palette or 16-bit images | PNG for spatial LSB | Dimensions retained; decoded pixels are converted to 8-bit RGB/RGBA before embedding. Animated inputs use the first frame. File size can change. |
| BMP | BMP for spatial LSB | Exact byte length for standard 24-bit BMP; other BMP variants have no exact-size guarantee |
| Image with DCT selected | PNG | One bit per complete 8×8 RGB channel block; alpha and incomplete edge blocks remain unchanged. File size can change. |
| Integer PCM WAV, 8/16/24/32-bit, including PCM WAVE_FORMAT_EXTENSIBLE | WAV | The RSA adapter supports any channel count and patches sample low bytes in place, preserving headers, chunks, and exact file length |
| MP3 audio source | Prepared 16-bit PCM WAV, then protected WAV | Preparation changes the format; embedding preserves the prepared WAV length |
| Compatible MP4, MOV, M4V, MKV, WebM, FLV, WMV or 3GP | Lossless video in the source container | Audio retained; lossless encoding can substantially increase file size and needs a compatible player |
| Restricted uncompressed AVI, or a video requiring AVI preparation | AVI | Embedding preserves the prepared AVI's audio, timing, headers, and exact byte length; maximum 64 MiB |

Uploads are limited to **200 MiB**. Compatible encoded video must have one video stream and at most one audio stream, a constant frame rate of at most 60 fps, dimensions at most 1920×1080, decoded frames at most 512 MiB, and decoded audio at most 128 MiB. Other sources, including MPEG-PS, can be prepared as a selected AVI segment up to 640×360 and 64 MiB, with audio retained as PCM. Verification reads the received protected file directly; it does not prepare or transcode it.

File selection and drag-and-drop enforce each upload's allowed types. Media covers reject text documents; text, recovery, code and key uploads use their own restrictions. Backend parsers validate the actual contents, and media preparation excludes FFmpeg's text renderers and playlists. Payload files remain unrestricted by type because their bytes are hidden inside the cover.

The Ed25519 media adapters accept 8-bit RGB/RGBA PNG, uncompressed 24-bit BMP, integer PCM mono/stereo WAV, the restricted AVI subset, and compatible encoded video. See [media recovery and video limits](docs/media-recovery.md) for the exact accepted formats.

## Sender-to-recipient walkthrough

### Images and audio

1. In **Keys**, generate or load an RSA pair. Save the private and public PEM files.
2. In **Embed & Sign**, select a cover and enter a message or choose a payload file. MP3 sources require PCM WAV preparation. Check the payload SHA-256 and capacity estimate.
3. For spatial LSB, choose 1–8 low bits per carrier value and an automatic or manual start. The image picker supports zoom, drag-to-zoom, live `(X, Y)` hover coordinates, and arrow-key/Enter selection. Pixel `(0, 0)` is rejected as the start. WAV placement can be selected by time. Higher LSB depths increase capacity but can make changes visible or audible.
4. For images, optionally choose **DCT · lossless PNG**. DCT uses automatic placement and one bit per transform block; spatial LSB depth and manual pixel settings do not apply. Small images may have no usable capacity.
5. Enter a passphrase, embed, and download the protected file. Send it to the recipient with the RSA public key and share the passphrase separately.
6. In **Extract & Verify**, the recipient loads the downloaded file, passphrase, and public key. DCT is detected from the image itself. Review the verdict and download the payload only after successful verification. A wrong spatial start offers a retry or the authenticated stored location without replacing the file.

### Video

Select a video through **Embed & Sign**. The app checks whether it can retain its container or needs AVI preparation. Generate or load an Ed25519 pair in the video form, choose the LSB depth, and embed the payload file. Save the protected video, `.stegloc` recovery file, recovery code, and public key. The recipient supplies those four items in **Extract & Verify**; the private-key password is for sender key use, not recipient recovery.

### Text

In **Text Steganography**, enter a message and choose acrostic, trailing whitespace, or zero-width encoding. Generate or paste Ed25519 keys, then encrypt, sign, and hide the message. Save the UTF-8 carrier, `.stegloc-text` recovery file, code, and public key. The recipient imports or pastes the carrier on the same screen and supplies the recovery material to extract and verify.

The message limit is **32 KiB** and the UTF-8 carrier limit is **2 MiB**. Acrostic sentence bodies may be rewritten if the A–P initials and line order stay exact. Trailing spaces/tabs and U+200B/U+200C characters must survive copying unchanged. The hidden message and signer are authenticated; visible wording is outside that guarantee. See [text protection](docs/text-protection.md).

## Inspection and tamper evidence

**Inspect a file** provides bit planes 0–7, channel histograms, Chi-Square measurements, and image-only RS statistics and BPCS complexity maps. Bit 0 is the even/odd filter: even values are black and odd values are white. An original enables paired bit planes and histograms, difference maps, and image MSE, PSNR, and full-resolution luminance SSIM. SSIM requires a same-size image of at least 11×11 pixels. WAV analysis shows changes across time and channels; video has frame comparison and a change timeline.

Image comparisons include side-by-side, swipe, overlay, and heatmap views. Bit-plane thumbnails and the composite RGB lowest-bit image can be enlarged in a zoomable dialog. **Pop out graph** opens a larger chart in a separate desktop window or browser tab while its source analysis remains available. Generated WAV playback supports seeking through the native audio controls.

Chi-Square, RS, histograms, and BPCS are descriptive evidence, not proof of hidden content or authenticity. BPCS capacity is a theoretical analysis estimate, not an embedding method or payload allowance. Preview sampling is labelled in the UI. See [steganalysis methods and limits](docs/steganalysis.md).

**Tamper tests** verifies the supplied file as a baseline, then runs applicable negative cases against protected image, WAV, video, or text inputs. Cases include wrong credentials, incorrect placement and correction, payload/carrier modifications, and a controlled RSA payload-hash mismatch. The summary shows every applicable case and failed verification checks when available. **Test passed** means the file verified as **Authentic**; **Test failed** means verification rejected the file or its inputs. A deliberately modified case should fail verification when the change is detected. Expand **Reasoning** to see the expected verdict, whether the scenario behaved as expected, and the actual verification explanation. A failed baseline stops the remaining cases. DCT cases that require spatial LSB slots are marked not applicable. Results arrive as cases finish, with downloadable variants and an evidence ZIP.

The baseline uses your selected protected file and credentials unchanged. The wrong-key case temporarily substitutes a freshly generated, unrelated public key; it does not change your workspace keys. Carrier and payload edits use separate copies. The optional original-cover case verifies a separate reference and expects **Payload Missing** only for an unsigned original; an already protected reference may contain a payload signed by another key. Each case's **Reasoning** explains its purpose, inputs, expected verdict, and observed verification result.

Media ZIPs contain supplied original/protected files, optional recovery material, the public key, the passphrase or video recovery code, generated variants under `tampered/`, replay steps, `results.json`, an offline `report.html`, and a SHA-256 manifest. **These exports contain verification secrets.** Private keys and extracted plaintext are excluded. The report embeds its heatmap so it can be opened on its own; extract the full ZIP to use its file links. Text exports record test outcomes without the complete media input/credential bundle.

## Run the packaged Windows app

Open `dist\Stegloc\Stegloc.exe` from a built distribution. Keep the **entire `Stegloc` folder**, including `_internal`, together; copying the executable alone will not work. End users do not need Python or Node.js.

The desktop app requires the [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/). Install the Evergreen Runtime if it is missing.

The app starts its internal service on a private loopback port and stops it when the window closes. Download keys, payloads, recovery material, and evidence before exiting. Outputs are temporary and can also expire or be evicted by storage limits. Startup diagnostics are written to `%LOCALAPPDATA%\Stegloc\logs\desktop.log`.

## Development setup

Use Windows PowerShell from the repository root. Requirements are **Python 3.11+** and **Node.js 20.19+ on the 20.x line, or 22.12+** (see `frontend/package.json`). Source runs need both FFmpeg and ffprobe on `PATH` or in `build/ffmpeg` for MP3 preparation and encoded-video processing. The Windows build script supplies these tools.

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.lock
npm ci --prefix frontend
```

`requirements.lock` pins the Python runtime and test dependencies; `frontend/package-lock.json` pins the frontend dependency tree. Use `npm ci` to install the locked frontend versions.

### Desktop from source

```powershell
.\.venv\Scripts\python.exe -m pip install ".[desktop]"
npm run build --prefix frontend
.\.venv\Scripts\python.exe desktop.py
```

WebView2 is also required for Windows source launches. Rebuild the frontend after editing it; the desktop launcher serves `frontend/dist`.

### Browser development

Terminal 1, from the repository root:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

Terminal 2, from the repository root:

```powershell
npm run dev --prefix frontend
```

Open <http://127.0.0.1:5173>. Vite forwards `/api` calls to port 8000. Alternatively, run `npm run build --prefix frontend`, start only the API, and open <http://127.0.0.1:8000>. The API is intended for local use and accepts `localhost` and `127.0.0.1` hostnames. `/api/health` reports service availability.

### Windows distribution build

```powershell
.\build-windows.bat
```

The script creates `.venv` if needed, installs pinned Python and frontend dependencies plus desktop/build extras, downloads and checks the pinned FFmpeg archive when its binaries are missing, builds the frontend, and packages `dist\Stegloc\Stegloc.exe`. Close that executable before rebuilding its distribution. Distribute the entire `dist\Stegloc` folder, for example as a ZIP. Initial setup/build requires access to dependency and FFmpeg downloads; running the resulting app is local.

## Checks and benchmarks

Run from the repository root after development setup:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
npm test --prefix frontend
npm run build --prefix frontend
```

The Python suite covers protocols, security, carriers, APIs, desktop lifecycle, analysis, and workflows. Frontend tests cover forms, routing, accessibility, inspection controls, and media/text flows. The frontend build runs TypeScript checking before bundling. Automated checks do not replace a manual WebView2 or packaged-player check.

Optional deterministic analysis benchmarks:

```powershell
.\.venv\Scripts\python.exe scripts/benchmark-analysis.py
.\.venv\Scripts\python.exe -m scripts.benchmark_analysis --repeat 3 --output .benchmarks/modular.json
```

The first compares the vectorized BPCS calculation with a reference loop. The second measures the full analysis pipeline and records semantic digests and timings; it can compare a saved report with `--baseline`.

## Integrity boundaries

- Spatial LSB replaces low bits of RGB bytes or PCM sample low bytes. Its 65-byte `STG1` header occupies the final 520 slots at one bit per slot. The header authenticates encrypted placement; the encrypted package contains the RSA-signed record and exact payload bytes. Placement begins after slot zero.
- RSA/passphrase workflows derive separate header, payload, and placement keys with PBKDF2-HMAC-SHA256 (200,000 iterations and fresh salt). Media recovery and text use a random recovery secret and HKDF-SHA256. The public key establishes signature validity; a passphrase or recovery code alone does not establish sender identity.
- The spatial cover hash masks the permitted embedding bits. Image hashing includes decoded RGB and alpha rather than PNG metadata; WAV hashing covers the normalized WAV file. DCT hashes RGB outside occupied channel blocks and every alpha byte. Changes outside these integrity scopes may leave verification successful.
- DCT lossless PNG export does not make hidden data resilient to JPEG recompression or resizing. Spatial LSB is also fragile: editing, normalization, or transcoding can destroy framing or authentication. A failed extraction can report **Payload Missing**, **Tampered**, or **Cannot Verify**, depending on which check fails.
- **Authentic** means the required signature, payload, placement, and covered-carrier checks passed. Other verdicts include **Signature Invalid** and **Wrong Start Location**. It does not prove public-key ownership, concealment, replay prevention, or integrity of data outside the format's scope.
- Encryption protects content, not the fact that embedding occurred. Headers and statistical patterns can reveal use of steganography. Weak passphrases permit offline guessing. Generated RSA private-key downloads are unencrypted PEM; protect them appropriately. Losing recovery material prevents normal Ed25519 recovery.

## Module ownership and source-to-test map

Browser and desktop use the same local API. [backend/app/main.py](backend/app/main.py) registers the HTTP handlers; [frontend/src/App.tsx](frontend/src/App.tsx) owns screen composition and [frontend/src/router.ts](frontend/src/router.ts) owns navigation. Each row below connects a responsibility to its implementation and tests.

| Module | Responsibility | Owner files | Tests |
| --- | --- | --- | --- |
| App and desktop lifecycle | Register HTTP handlers, serve the frontend, and manage the local WebView service | [backend/app/main.py](backend/app/main.py), [backend/desktop.py](backend/desktop.py), [desktop.py](desktop.py) | [tests/test_app.py](tests/test_app.py), [tests/test_desktop.py](tests/test_desktop.py), [tests/test_module_boundaries.py](tests/test_module_boundaries.py) |
| Spatial LSB | Eligible bytes, depth and start → embedded or recovered bytes | [backend/app/stego/lsb.py](backend/app/stego/lsb.py) | [tests/test_lsb.py](tests/test_lsb.py) |
| Image/audio covers | Image or PCM WAV → slots and exported media | [backend/app/stego/covers.py](backend/app/stego/covers.py) | [tests/test_image.py](tests/test_image.py), [tests/test_audio.py](tests/test_audio.py) |
| RSA record and capacity | File details and payload size → framed record and safe placement | [backend/app/stego/lsb_record.py](backend/app/stego/lsb_record.py), [backend/app/stego/lsb_capacity.py](backend/app/stego/lsb_capacity.py) | [tests/test_workflows.py](tests/test_workflows.py) |
| RSA sender and receiver | Cover/payload/key/passphrase → protected file or checked content | [backend/app/stego/lsb_embed.py](backend/app/stego/lsb_embed.py), [backend/app/stego/lsb_verify.py](backend/app/stego/lsb_verify.py), [backend/app/stego/lsb_report.py](backend/app/stego/lsb_report.py) | [tests/test_workflows.py](tests/test_workflows.py), [tests/test_api.py](tests/test_api.py) |
| RSA cryptography | Keys, plaintext and digests → signatures and authenticated ciphertext | [backend/app/stego/security.py](backend/app/stego/security.py) | [tests/test_security.py](tests/test_security.py) |
| DCT PNG | Image and envelope → transform blocks and verifiable PNG | [backend/app/stego/dct_codec.py](backend/app/stego/dct_codec.py), [backend/app/stego/dct_protocol.py](backend/app/stego/dct_protocol.py) | [tests/test_dct.py](tests/test_dct.py), [tests/test_dct_api.py](tests/test_dct_api.py) |
| Media recovery cryptography | Ed25519 key and recovery secret → signed encrypted bundle and locator | [backend/app/stego/recovery_security.py](backend/app/stego/recovery_security.py), [backend/app/stego/protocol.py](backend/app/stego/protocol.py) | [tests/test_protocol.py](tests/test_protocol.py), [tests/test_recovery_security.py](tests/test_recovery_security.py) |
| Media sender and receiver | Carrier/payload/key → protected carrier; recovery inputs → checked content | [backend/app/media_record.py](backend/app/media_record.py), [backend/app/media_protect.py](backend/app/media_protect.py), [backend/app/media_verify.py](backend/app/media_verify.py), [backend/app/media_results.py](backend/app/media_results.py) | [tests/test_media_api.py](tests/test_media_api.py), [tests/test_video.py](tests/test_video.py) |
| Video carriers | AVI or compatible encoded video → frame slots and lossless output | [backend/app/stego/carriers/video.py](backend/app/stego/carriers/video.py), [backend/app/stego/carriers/video_mp4.py](backend/app/stego/carriers/video_mp4.py) | [tests/test_video.py](tests/test_video.py), [tests/test_media_workflows.py](tests/test_media_workflows.py) |
| Preparation, comparison and retry | Source/options or manual location → prepared cover, differences or verdict | [backend/app/api/media.py](backend/app/api/media.py), [backend/app/api/video_verify.py](backend/app/api/video_verify.py) | [tests/test_media_workflows.py](tests/test_media_workflows.py), [frontend/src/pages/VideoWorkflow.test.tsx](frontend/src/pages/VideoWorkflow.test.tsx) |
| Signed text | Message/key → encrypted text; recovery inputs → verified message | [backend/app/stego/signed_text.py](backend/app/stego/signed_text.py), [backend/app/stego/text_carrier.py](backend/app/stego/text_carrier.py) | [tests/test_text.py](tests/test_text.py) |
| Steganalysis | Image/audio and optional original → descriptive statistics and differences | [backend/app/stego/analysis/service.py](backend/app/stego/analysis/service.py), [backend/app/stego/analysis/](backend/app/stego/analysis/), [backend/app/stego/analysis_parts/](backend/app/stego/analysis_parts/) | [tests/test_analysis_service.py](tests/test_analysis_service.py), [tests/test_analysis_chi_square.py](tests/test_analysis_chi_square.py), [tests/test_analysis_bpcs.py](tests/test_analysis_bpcs.py) |
| Tamper cases and evidence | Protected file and credentials → verdicts, variants and ZIP | [backend/app/stego/attacks.py](backend/app/stego/attacks.py), [backend/app/api/tamper_tests.py](backend/app/api/tamper_tests.py) | [tests/test_workflows.py](tests/test_workflows.py), [tests/test_media_workflows.py](tests/test_media_workflows.py) |
| Jobs and artifacts | Session and task → progress, cancellation and scoped downloads | [backend/app/api/session_jobs.py](backend/app/api/session_jobs.py), [backend/app/api/sessions.py](backend/app/api/sessions.py), [backend/app/session.py](backend/app/session.py) | [tests/test_media_api.py](tests/test_media_api.py), [tests/test_module_boundaries.py](tests/test_module_boundaries.py) |
| Interface | User inputs → typed requests and result panels | [frontend/src/api/](frontend/src/api/), [frontend/src/pages/](frontend/src/pages/), [frontend/src/ui/](frontend/src/ui/) | [frontend/src/pages.test.tsx](frontend/src/pages.test.tsx), [frontend/src/logic.test.ts](frontend/src/logic.test.ts) |
| Upload validation | Allowed file types and PEM checks → accepted selections or inline errors | [frontend/src/upload.ts](frontend/src/upload.ts), [frontend/src/ui/inputs.tsx](frontend/src/ui/inputs.tsx), [backend/app/api/media.py](backend/app/api/media.py) | [frontend/src/ui/inputs.test.tsx](frontend/src/ui/inputs.test.tsx), [tests/test_media_workflows.py](tests/test_media_workflows.py) |

[engine.py](backend/app/stego/engine.py) dispatches RSA image/audio requests to spatial LSB or DCT. [workflows.py](backend/app/workflows.py) exposes media protection and verification entry points. [media_api.py](backend/app/media_api.py) and [text_api.py](backend/app/text_api.py) register their route modules; [components.tsx](frontend/src/components.tsx) and [api.ts](frontend/src/api.ts) expose shared frontend components and requests.

Packaging is defined in [Stegloc.spec](Stegloc.spec) and [build-windows.bat](build-windows.bat). Analysis benchmarks live in [scripts/](scripts/), and example media and evidence live in [demo/](demo/).

## Call traces

1. **Spatial image/audio.** Embed form → `api.hide()` → `/api/hide` → `engine.hide()` → `lsb_embed.hide()`. The sender hashes the payload and normalized cover, signs the record digest with RSA, encrypts package/header, then writes bits through `lsb.encode()`. `/api/verify` dispatches to `lsb_verify.verify()` to check the header, package, signature and hashes. `frontend/src/pages/verify/Result.tsx` renders the stages.
2. **DCT.** The image form supplies method `dct`. `engine.hide()` selects `dct_protocol.hide()` → `DctCarrier.embed_ranges()` → a reopened, checked PNG. Verification detects framing from image data and calls `dct_protocol.verify()`. Recognized invalid DCT framing is rejected rather than retried as spatial LSB.
3. **Media recovery.** `/api/session` establishes a session. `/api/jobs/media/protect` → `api/media_protection.py` → `media_protect` builds a signed encrypted package. Outputs include a carrier, `.stegloc` and separate code. `/api/jobs/media/verify` → `media_verify` checks locator, ciphertext, signature, payload and canonical carrier before publishing content.
4. **Video.** `VideoWorkflow.tsx` calls `/api/media/probe` and, when needed, `/api/media/prepare`, then the media protection job. `/api/video/verify` → `video_verify.verify_at()` evaluates stored or manual placement. `VideoInspect.tsx` calls `/api/video/compare` for frame previews and comparison data.
5. **Text.** `TextPage.tsx` → `api/text.py` → `signed_text.protect()` signs/encrypts the message → `text_carrier.encode()`. Verification decodes and authenticates using `.stegloc-text`, the code and public key. Visible prose is outside the signature.
6. **Analysis.** `/api/analyse` → `analysis.analyse()` → `analysis/service.py` runs bit-plane, histogram, Chi-Square, BPCS, RS and comparison helpers. `frontend/src/pages/analysis/Results.tsx` presents descriptive findings. An original enables exact differences and quality metrics.
7. **Evidence.** `AttackPage.tsx` → `/api/jobs/tamper-tests` → `attacks.run_suite()` or `_video_suite()`. Each case uses a separate copy. `/api/jobs/{ident}/evidence` assembles session files, steps and report. `TextShowcase.tsx` uses the separate `/api/jobs/text-tamper-tests` route and text inputs.

## Further documentation

- [Spatial RSA format](docs/protocol.md), [DCT PNG format](docs/dct-protocol.md), [media recovery](docs/media-recovery.md), and [text protection](docs/text-protection.md): framing, verification order, and integrity limits.
- [Steganalysis](docs/steganalysis.md): measured statistics, capacity estimates, and benchmarks.
- [UI adoption](docs/ui-library-adoption.md): interface patterns and offline frontend assets.

Stegloc is one application with distinct protection formats. Stored format identifiers and cryptographic domain strings remain versioned independently of the application release.
