# Stegloc: LSB steganography with digital signatures

INF2005 ACW1: a web GUI that hides a signed and encrypted verification payload inside an **image** or **WAV audio** cover using **LSB replacement**, then extracts it and verifies it with **SHA-256** and an **RSA digital signature**.

| Page | What it does |
| --- | --- |
| **Keys** | Generate or load an RSA-2048 key pair (private key signs, public key verifies) |
| **Embed & sign** (party A) | Drag in a cover and a payload (text or any file), choose 1-8 LSBs and the start location, then embed |
| **Extract & verify** (party B) | Drag in the received stego file, enter the passphrase and public key, get a verdict |
| **Steganalysis** | Bit planes, histogram, chi-square attack, difference image (cover vs stego) |
| **Attack lab** | Runs up to 10 positive/negative scenarios and lets you download the tampered sample files |

## Setup (Windows PowerShell)

Requires Python 3.11+ and Node.js 20.19+.

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.lock

Set-Location frontend
npm install
Set-Location ..
```

## Run

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
| BMP | BMP | Yes for standard 24-bit BMP |
| PNG, JPEG, GIF, WEBP, TIFF, palette / 16-bit images | PNG | No: PNG re-compresses (pixels and dimensions are exact) |

MP3, AAC and MP4 cannot be covers because lossy codecs destroy LSBs. They can still be hidden as payloads.

## Limitations (be honest in the demo)

- LSB replacement is fragile: any re-compression, resizing or editing removes the payload (the verifier then reports *Payload Missing* or *Tampered*, never a false *Authentic*).
- The `STG1` header marks that this tool was used; steganalysis (chi-square, bit planes) can also reveal embedding. Encryption protects **confidentiality and integrity**, not the fact that data is hidden.
- The passphrase is the shared secret for the start location and encryption. A weak passphrase can be brute-forced offline (PBKDF2 only slows this down).
- The cover hash covers pixel/sample values, not PNG metadata chunks.
- Keys generated in the GUI are for the demo; a real deployment would protect the private key with a password or hardware.

## Project layout

```
backend/app/main.py            FastAPI endpoints
backend/app/stego/lsb.py       LSB encode / decode (lecture style)
backend/app/stego/covers.py    image and WAV cover objects -> slots
backend/app/stego/security.py  SHA-256, RSA-PSS, PBKDF2, AES-GCM
backend/app/stego/engine.py    hide / verify workflow and verdicts
backend/app/stego/analysis.py  bit planes, histogram, chi-square, difference
backend/app/stego/attacks.py   attack simulation module
frontend/src/                  React GUI (pages/, components.tsx, api.ts)
tests/                         pytest suite
```
