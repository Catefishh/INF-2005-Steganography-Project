# Stegloc

Stegloc is a local React and Python steganography workbench. Tasks 1-6 provide PNG/RGBA, BMP, and integer PCM WAV inspection, LSB protection, encrypted signed locators, fresh-session API protect/verify flows, bounded uploads, cancellation, and structured verification evidence. The functional UI remains the next task.

## Prerequisites

- Python 3.12
- Node.js `^20.19.0 || >=22.12.0` and npm
- Windows PowerShell

## Backend Setup

From the repository root in PowerShell:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.lock
python -m pip install -e . --no-deps
```

Run the local API on loopback only:

```powershell
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

Check health from another PowerShell terminal:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/health
```

The expected payload is `{"status":"ok","service":"stegloc-api"}`.

The development CORS allowlist defaults only to `http://localhost:5173` and `http://127.0.0.1:5173`. Override it with a comma-separated `STEGLOC_DEV_ORIGINS` value when another explicit development origin is required.

## Frontend Development

```powershell
Set-Location frontend
npm install
npm run dev -- --host 127.0.0.1
```

The development shell uses `http://127.0.0.1:8000` for API requests. Keep the backend command running in a separate terminal.

## Production Shell Build

```powershell
Set-Location frontend
npm install
npm run build
Set-Location ..
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

When `frontend/dist` exists, FastAPI serves it at `/` while `/api/*` routes remain available.

## Tests

## Local workflow API

The API issues a random `stegloc_session` HttpOnly, SameSite=Strict cookie.
Clients retain that cookie (or send its value as `X-Session-Token`). Artifact
and job IDs are scoped to that session; downloads never accept filesystem paths.
Run one local server process. Sessions expire after one idle hour, with a
30-second cleanup sweep during application lifespan and cleanup on shutdown.
`DELETE /api/session` marks the session closed, cancels jobs, waits for active uploads/workers to stop, and then removes temporary artifacts.

Multipart `file` uploads use `/api/covers`, `/api/payloads`, `/api/recovery`,
and `/api/keys/public`. Covers are parsed as PNG/BMP/WAV. Limits are 100 MiB
for media/payloads, 64 KiB for sidecars, and 16 KiB for public keys.
`POST /api/payloads/text` accepts `{ "text": "..." }`, bounded to 10 MiB UTF-8.
There are at most 16 sessions, 64 artifacts and 64 jobs per session, with a
512 MiB artifact budget per session. Video is not accepted in this milestone.

`/api/keys/generate` returns public PEM; encrypted private PEM is returned only
with `include_private: true` and a nonempty `password`. `/api/estimate` accepts
`cover_artifact_id`, `payload_artifact_id`, and `depth` (1–8). `/api/protect`
adds encrypted `private_key` PEM and `password`; placement is selected by the
existing workflow. `/api/verify` accepts `stego_artifact_id`,
`sidecar_artifact_id`, `recovery_code`, and `public_key_artifact_id` (or public PEM
in `public_key`). Protect and verify return a `job_id` with HTTP 202.

Poll `/api/jobs/{id}` for status, progress, result and structured error.
Protect results contain stego/sidecar artifact IDs and the separate recovery
code; successful verification returns a verified-content artifact ID.
Download using `/api/artifacts/{id}`. `DELETE /api/jobs/{id}` requests
cancellation at workflow boundaries; an executing crypto/carrier operation
finishes before cancellation is observed. Cancelled work publishes no result.

### Running tests

```powershell
.venv\Scripts\python.exe -m pytest --basetemp=.pytest-tmp
```

## Progress

- [x] Tasks 1-6: protocol, carriers, protection/recovery, API sessions, bounded uploads, cooperative cancellation, atomic publication, and structured verification evidence.
- [ ] UI workflow: deferred to the next milestone.

## V1 Scope

- PNG: nonanimated 8-bit RGB/RGBA, dimensions preserved, encoded size explicitly variable.
- BMP: uncompressed 24-bit `BI_RGB`, exact byte length.
- WAV: RIFF integer PCM 8/16/24/32-bit mono/stereo, exact byte length.
- Recovery: encrypted `.stegloc` locator sidecar plus a separate random recovery code.
- Restricted uncompressed AVI only after mandatory image/audio support is complete.

See [PRODUCT.md](PRODUCT.md) for approved product decisions and [docs/protocol.md](docs/protocol.md) for the frozen v1 framing and cryptographic protocol.
