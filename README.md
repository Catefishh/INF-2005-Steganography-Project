# Stegloc: LSB steganography with digital signatures

## Demonstration workflow

1. Select an image or PCM WAV cover, or import MP3/MOV/MP4 and explicitly prepare a lossless cover. Video preparation selects a short silent segment and writes uncompressed AVI (64 MiB maximum). MP3 preparation writes PCM WAV. The Windows desktop build bundles FFmpeg and ffprobe; source runs require them on `PATH` or in `build/ffmpeg`.
2. Select any payload file, including MP3/MOV/MP4. Check its SHA-256 and the capacity estimate, then embed. The active stego file appears in the working-file strip and stays selected across screens during this app session.
3. Extract and verify. Compare the signed expected payload digest with the decoded digest. A wrong manual start keeps the same file and offers immediate retry or the authenticated stored location.
4. Inspect the prepared cover against the stego file with side-by-side, swipe, overlay, and heatmap views. For video, inspect individual frames and the timeline. For WAV, the strip shows changes across time and channels.
5. Open Tamper tests. Choose **Encode and test** or **Test protected file** for image, WAV, AVI, or text carriers. Watch each case finish, including wrong-location correction and a controlled legacy payload-hash mismatch, then download the evidence ZIP. Passwords, recovery codes, private keys, and extracted plaintext are excluded from that ZIP.

Prepared MOV/MP4 video uses the Ed25519 workflow with a separate recovery file and code. MP3 becomes WAV; MOV/MP4 becomes silent AVI. The downloaded stego format is the prepared lossless format. Working files live only for the current app session.

INF2005 ACW1: a desktop and web GUI that hides signed, encrypted content inside image and WAV covers using LSB replacement. It supports SHA-256/RSA signing and an Ed25519 media protocol with a separate recovery file/code and restricted AVI video carrier.

| Page | What it does |
| --- | --- |
| **Keys** | Generate or load an RSA-2048 key pair (private key signs, public key verifies) |
| **Embed & sign** (party A) | Drag in a cover and a payload (text or any file), choose 1-8 LSBs and the start location, then embed |
| **Extract & verify** (party B) | Drag in the received stego file, enter the passphrase and public key, get a verdict |
| **Steganalysis** | Bit planes, histogram, chi-square attack, difference image (cover vs stego) |
| **Tamper tests** | Runs live positive/negative cases for media and text, with downloadable evidence and variants |
| **Text Steganography** | Signed, encrypted messages in acrostic, trailing-whitespace, or zero-width text |

## Analysis and text

**Inspect a file** now offers image-only RS statistics, paired cover/stego histograms and bit planes 0–7, an even/odd filter (bit 0: even black, odd white), and full-resolution luminance SSIM. Its before/after slider and change overlay show exactly where pixels differ. RS, histograms and chi-square are descriptive evidence; they cannot prove a message is present. MSE, PSNR and SSIM require a same-size original image. SSIM uses 11×11 windows, so it is unavailable below 11×11 pixels.

The BPCS number in Inspect is a theoretical estimate. The image robustness simulator in **Tamper tests** independently applies resize, center crop, JPEG round-trip, noise and brightness changes, then reports actual legacy or v2 verifier outcomes. Resize/crop have no direct image-quality comparison because dimensions change.

**Text Steganography** (`/text`) uses existing Ed25519 keys and an independent v3 text format. Enter a message, select a method, generate an encrypted carrier, and download its text and `.stegloc-text` recovery material. Pass the code separately. Paste or import the carrier on the recipient side with the recovery file, code and public key. The hidden message and sender are authenticated; visible wording is not. Acrostic lines may be rewritten if the A–P initials and order remain exact. Trailing spaces/tabs and U+200B/U+200C characters must survive copying unchanged. The input message limit is 32 KiB and the resulting UTF-8 carrier limit is 2 MiB. See [the text format](docs/v3-text-protocol.md) for exact framing and limitations.

For a source-code walkthrough and Q&A, use the [code guide](docs/code-guide.md). It maps each concept to the implementation, call flow, limits and tests.

## Supported protocol formats

Stegloc supports the original RSA/passphrase `STG1` format, the v2 Ed25519 media protocol and the v3 signed text format in one application. The v2 API retains Ed25519 protection and verification for existing integrations. It uses a separate `.stegloc` recovery file and code; its key and recovery formats differ from the RSA/passphrase screens for `STG1` files.

Inspect a file also provides image-only BPCS settings and complexity maps, plus richer Chi-Square validity data. A high Chi-Square p-value is descriptive evidence, not proof of embedding. Use `python scripts/benchmark-analysis.py` for the focused BPCS algorithm comparison, or `python -m scripts.benchmark_analysis` for the full deterministic analysis benchmark. See [v2 protocol and AVI limits](docs/v2-protocol.md) for accepted headers, size limits, security handoff and verification boundaries.

## Desktop studio interface

The application uses a workflow-first collapsible sidebar with transparent frosted glass. The active file and its digest remain visible across screens; the Inspect workspace presents descriptive chi-square and BPCS charts, while the image robustness simulator under Tamper tests compares measured PSNR values. Use **Pop out graph** to open a separate graph-only Stegloc window (or browser tab) with a larger plot, zoom and measured-value details. The source analysis must remain available in the main window. Sidebar components follow the local [shadcn sidebar pattern](https://ui.shadcn.com/blocks/sidebar); measured charts adapt [shadcn area charts](https://ui.shadcn.com/charts/area) using Recharts. Watermelon UI remains a visual reference and Motion for React handles short, reduced-motion-aware transitions. Fonts and chart code are included in the packaged frontend for offline use. Details: [UI adoption](docs/ui-library-adoption.md).

## Run the packaged Windows app

Open `dist\Stegloc\Stegloc.exe` from a built distribution. Keep the **entire `Stegloc` folder** together, including `_internal`; copying the executable alone will not work. End users do not need Python or Node.js.

The desktop app requires the [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/). Install the Evergreen Runtime if it is missing.

Processing runs locally and works offline. The app starts its internal server automatically on a private loopback port and stops it when the window closes. Download keys and generated files before exiting: unsaved outputs and session keys are lost on exit.

## Development setup (Windows PowerShell)

Requires Python 3.11+ and Node.js 20.19+ (or 22.12+ on newer release lines).

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.lock

Set-Location frontend
npm install
Set-Location ..
```

## Run the desktop app from source

Install the desktop dependency, build the React assets, then launch with the project Python:

```powershell
.\.venv\Scripts\python.exe -m pip install ".[desktop]"
Set-Location frontend
npm run build
Set-Location ..
.\.venv\Scripts\python.exe desktop.py
```

With the virtual environment activated, the launch command is `python desktop.py`. WebView2 is also required for source launches.

## Build the Windows distribution

Build on Windows after completing development setup:

```powershell
.\.venv\Scripts\python.exe -m pip install ".[desktop,build]"
.\scripts\build-desktop.ps1
```

The script builds the frontend and packages a windowed application at `dist\Stegloc\Stegloc.exe`. It uses `.venv\Scripts\python.exe` by default; select another prepared environment with `-Python "C:\path\to\python.exe"`. Distribute the entire `dist\Stegloc` folder, for example as a ZIP archive.

## Run in a browser during development

Terminal 1 (API):

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

Terminal 2 (GUI):

```powershell
Set-Location frontend
npm run dev
```

Open <http://127.0.0.1:5173>. Vite forwards `/api` calls to the API on port 8000.

Single-server alternative: `npm run build` inside `frontend`, then start only the API and open <http://127.0.0.1:8000>.

## Tests

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

## Demo flow (party A to party B)

1. **Keys**: generate a key pair, then download `private_key.pem` (sender) and `public_key.pem` (receiver).
2. **Embed & sign**: drop a PNG/BMP/JPEG or a WAV and pick a payload (the *Short* and *Large* brief samples are one click; a file works too). Choose the LSBs and watch the capacity meter. Enter a passphrase, then click **Embed & sign**. Compare cover and stego with the slider or waveforms, then **Download** the stego file.
3. Email the stego file to party B and share the passphrase separately. B downloads the file.
4. **Extract & verify**: B drops the downloaded file, types the passphrase, loads `public_key.pem`, then clicks **Extract & verify**. The verdict, every check and the extracted payload are shown.
5. **Attack lab**: run the suite for the negative cases and download the tampered files as evidence.

## How it works

### LSB replacement (lecture code, extended)

`backend/app/stego/lsb.py` follows the lecture's `to_bin` / `encode` / `decode`. A **slot** is one byte that may carry hidden bits:

- **Image:** every R, G, B byte, in the lecture's loop order (row, pixel, R G B). Alpha is never changed.
- **Audio:** the least significant byte of every PCM sample.

With `n` LSBs, every slot becomes `int(slot_bits[:-n] + payload_bits[i:i+n], 2)`. Payload bits are taken MSB first, as in the lecture.

### What is hidden

```
slot 0 ... start ............ start+span ...... last 520 slots
| unused | PAYLOAD (n LSBs)   | unused          | HEADER (1 LSB) |
```

- **HEADER** (65 bytes): `"STG1" | salt | AES-GCM(start slot, payload length, n LSBs)`.
- **PAYLOAD**: `AES-GCM(record length | record JSON | signature length | RSA signature | content)`.
- **Record** (FR3): media ID (UUID4), UTC timestamp, 128-bit nonce, team metadata, cover SHA-256, payload SHA-256, payload name/type/size, LSB count, start and header slots, signer fingerprint.

### Security workflow

**Sender:**

1. Hash the payload (SHA-256).
2. Hash the cover, with the LSBs that will carry data set to 0, so the cover and stego give the same hash.
3. Build the record.
4. `digest = SHA-256(record)`.
5. `signature = RSA-PSS-sign(private key, digest)`.
6. Derive 3 keys from the passphrase (PBKDF2-HMAC-SHA256, 200,000 rounds, random salt).
7. Choose the start slot = `HMAC-SHA256(start key, salt | cover descriptor | size)` (or manual, never slot 0).
8. AES-256-GCM encrypt the payload and the header.
9. LSB-embed the payload at the start and the header at the end.

**Receiver:**

1. Read the header (1 LSB, last 520 slots).
2. Decrypt the start location with the passphrase.
3. Extract the payload.
4. AES-GCM decrypt and authenticate it.
5. Recompute `SHA-256(record)` and verify the RSA signature with the public key.
6. Compare the payload SHA-256.
7. Recompute and compare the cover SHA-256.

### Start location security

- The header sits at a fixed, public place so the decoder can always find it. The payload start inside it is AES-GCM encrypted.
- Without the passphrase the start cannot be read, guessed, or changed without detection.
- The auto start comes from a keyed HMAC, so it is different for every protection (fresh salt) and never the top-left slot.

### Verdicts (FR10)

| Verdict | When |
| --- | --- |
| Authentic | Signature valid, payload hash and cover hash match |
| Tampered | Payload bits changed (AES-GCM tag fails), payload hash mismatch, or cover changed outside the hidden bits |
| Signature Invalid | Wrong public key, or the record was altered by someone who knew the passphrase |
| Payload Missing | No `STG1` header (clean cover, LSB plane overwritten, JPEG re-compression) |
| Wrong Start Location | Payload read from a manually entered start that is not the real one |
| Cannot Verify | Unsupported/corrupt file, invalid key, wrong passphrase (header cannot be decrypted) |

## Supported files

| Cover | Output | Size preserved? |
| --- | --- | --- |
| PCM WAV 8/16/24/32-bit, any channel count (incl. WAVE_FORMAT_EXTENSIBLE) | WAV, patched in place | **Yes, byte-identical length** |
| MP3 audio source | Prepared 16-bit PCM WAV, then WAV stego | Conversion changes the source format; embedding preserves the prepared WAV length |
| MP4 or MOV video source | Selected silent uncompressed 24-bit AVI segment, then AVI stego | Conversion changes the source format; embedding preserves the prepared AVI length |
| BMP | BMP | Yes for standard 24-bit BMP |
| PNG, JPEG, GIF, WEBP, TIFF, palette / 16-bit images | PNG | No: PNG re-compresses (pixels and dimensions are exact) |

The v2 carrier protocol accepts 8-bit RGB/RGBA PNG, uncompressed 24-bit BMP, integer PCM mono/stereo WAV, and a single-stream uncompressed 24-bit AVI up to 64 MiB. BMP, WAV and accepted AVI preserve exact byte length; PNG is recompressed. This stricter carrier contract belongs to v2 only. See [v2 protocol and AVI limits](docs/v2-protocol.md).

Compressed MP3 covers are explicitly decoded to PCM WAV before embedding. MOV and MP4 covers are explicitly decoded to a selected, silent uncompressed AVI segment. The compressed source is never used as the LSB carrier, and a received stego file is never transcoded during verification. Arbitrary files, including MP3, MOV and MP4, can be hidden as byte-exact payloads.

## Limitations (be honest in the demo)

- LSB replacement is fragile: any re-compression, resizing or editing removes the payload (the verifier then reports *Payload Missing* or *Tampered*, never a false *Authentic*).
- The `STG1` header marks that this tool was used; steganalysis (chi-square, bit planes) can also reveal embedding. Encryption protects **confidentiality and integrity**, not the fact that data is hidden.
- The passphrase is the shared secret for the start location and encryption. A weak passphrase can be brute-forced offline (PBKDF2 only slows this down).
- The cover hash covers pixel/sample values, not PNG metadata chunks.
- Keys generated in the GUI are for the demo; a real deployment would protect the private key with a password or hardware.

## Project layout

```
backend/app/main.py            FastAPI app setup, middleware and frontend serving
backend/app/api/               HTTP routes, uploads, sessions and jobs
backend/desktop.py             desktop window and internal server lifecycle
desktop.py                     desktop launch entry point
Stegloc.spec                   Windows folder distribution
scripts/build-desktop.ps1      frontend and desktop build
backend/app/stego/lsb.py       LSB encode / decode (lecture style)
backend/app/stego/covers.py    legacy image/WAV cover objects -> slots
backend/app/stego/carriers/    V2 image, WAV and AVI adapters
backend/app/stego/security.py  SHA-256, RSA-PSS, PBKDF2, AES-GCM
backend/app/stego/legacy_*.py  legacy record, capacity, sender, receiver and report
backend/app/v2_*.py            V2 records, sender, receiver and verdict stages
backend/app/stego/text_*.py    V3 signed text and carrier encoding
backend/app/stego/analysis/    analysis coordinator and core analyzers
backend/app/stego/analysis_parts/  focused statistical and visual analyzers
backend/app/stego/attacks.py   attack simulation module
frontend/src/                  React GUI (pages/, ui/, api/)
tests/                         pytest suite
```
