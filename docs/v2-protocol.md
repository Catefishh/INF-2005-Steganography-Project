# V2 workflow and recovery format

V2 is a supported Ed25519 media protocol within the Stegloc application. Its sidecar wire format uses the independent `stegloc-v1` record and `STLC\x01` recovery-file version. This does not replace the older `STG1` in-carrier header described in [protocol.md](protocol.md). The RSA/passphrase screens and `/api` endpoints remain available for previously protected files. A v2 file must be verified with the v2 recovery file, code and Ed25519 public key.

## Sender and recipient

The sender generates an Ed25519 key pair. The UI requires a password when exporting the private PEM. The public PEM and its SHA-256 fingerprint can be shared with the recipient over a trusted channel. A private key is never needed for verification.

The sender selects PNG, 24-bit BI_RGB BMP, integer PCM mono/stereo WAV, or the AVI subset below. Content is arbitrary bytes, including a complete smaller AVI file. The sender chooses 1–8 low bits per eligible sample and optionally a start slot or AVI frame/pixel/channel. A random 32-byte recovery secret, 16-byte salt and keyed nonzero start are generated when no start is supplied. HKDF-SHA256 derives distinct keys for the embedded package, external locator and start selection. The signed record contains the content SHA-256, canonical carrier SHA-256, placement, media ID, timestamp, filename/type, algorithms and signer fingerprint. AES-256-GCM encrypts the signed package. The external `.stegloc` file authenticates an Ed25519-signed locator carrying the exact embedded ciphertext digest and placement.

The recovery file is `STLC\x01 | salt (16) | locator nonce (12) | AES-GCM(ciphertext and tag)`. The clear 21-byte prefix is authenticated as associated data. The locator plaintext is a two-byte big-endian JSON length, the canonical JSON bytes and a 64-byte Ed25519 signature over `stegloc/v1/locator\0 | JSON`. The embedded package uses its own nonce and distinct key and authenticates `stegloc/v1/payload` as associated data. The signed record uses `stegloc/v1/record\0 | JSON` as the signing input. Both structures have strict bounds in `backend/app/stego/protocol.py`.

The recipient supplies the protected carrier, `.stegloc`, generated recovery code and the trusted public key. The application authenticates the locator, extracts exactly the stated bit span, checks its SHA-256, decrypts, verifies the signed record and content hash, compares locator and record placement, and recomputes the canonical carrier hash. It releases content only for **Authentic**. Wrong code or damaged encrypted locator yields **Cannot Verify**; an unrelated public key yields **Signature Invalid**; changed ciphertext or canonical carrier bits yields **Tampered**. The original cover and sender's private key are not required by the recipient.

The recovery code is base64url without padding for the 32-byte secret. Send it separately from the carrier and recovery file. It is an encryption secret, not a password to remember. Losing the code or recovery file prevents normal recovery. This format does not claim replay prevention or concealment from steganalysis.

## AVI carrier subset

The v2 AVI adapter accepts one classic RIFF `AVI ` container up to **64 MiB**, exactly one `hdrl` and `movi` list, one video stream and no audio stream. Headers must agree on dimensions, frame count and nonzero frame timing. Frames must be `00db` chunks of uncompressed 24-bit BI_RGB with the expected padded row size. Optional `idx1` entries must match frame count, chunk ID and frame size. Compressed frames, multiple streams, OpenDML, nested record lists and additional movie chunk types are rejected. The adapter patches only B/G/R bytes, preserving frame headers, row padding, indexes, chunk lengths, frame count, timing and total byte length.

AVI slot order is frame, top-to-bottom pixel row, left-to-right pixel, then B/G/R byte. An AVI manual start can be specified as a zero-based frame, X, Y and channel (0 blue, 1 green, 2 red), or as a flat slot index. The embedded file may itself be any AVI; it is recovered byte-for-byte after a successful check. Browser playback of classic AVI is codec-dependent; download and open it in a compatible player. A machine with FFmpeg should independently decode original, protected and recovered AVI before a demonstration. FFmpeg playback verification was unavailable in the current workspace.

## Jobs and limits

The v2 API starts a local session, queues one protect or verify job at a time, exposes status/poll/cancel endpoints, and serves output artifacts only to that session. Uploads are read in bounded chunks and staged through a temporary file. Session reset and expiry remove temporary artifacts; cancelling a job prevents its outputs from being published. Media adapters still require the bounded uploaded file in memory during processing. The API input limit is 200 MiB, while the AVI adapter uses the stricter 64 MiB limit.
