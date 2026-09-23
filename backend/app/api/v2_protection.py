"""V2 Protection endpoints."""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile

from ..stego.carriers.video import inspect_video
from ..stego.protocol import MAX_CONTENT_BYTES
from ..stego.v2_security import load_signing_key, load_verification_key
from ..workflows import estimate, protect_audio, protect_video, verify_audio, verify_image, verify_video

from .session_jobs import _read, _session, _check_origin, _launch

def _media(data: bytes):
    if data.startswith((b"BM", b"\x89PNG\r\n\x1a\n")):
        from .. import v2_api
        return "image", v2_api.protect_image, verify_image, ".png" if data.startswith(b"\x89PNG") else ".bmp"
    if data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return "audio", protect_audio, verify_audio, ".wav"
    if data[:4] == b"RIFF" and data[8:12] == b"AVI ":
        return "video", protect_video, verify_video, ".avi"
    raise ValueError("cover must be a supported PNG, BMP, PCM WAV or uncompressed AVI")




def attach(app: FastAPI) -> None:
    @app.post("/api/v2/estimate")
    async def capacity(request: Request, cover: UploadFile = File(...), content_length: int = Form(...), depth: int = Form(3),
                       start_slot: int | None = Form(None), content_name: str = Form("payload.bin"),
                       content_type: str = Form("application/octet-stream"), start_frame: int | None = Form(None),
                       start_x: int | None = Form(None), start_y: int | None = Form(None),
                       start_channel: int = Form(0)):
        _check_origin(request)
        data = await _read(cover, "cover")
        try:
            if start_frame is not None or start_x is not None or start_y is not None:
                if None in (start_frame, start_x, start_y) or start_slot is not None:
                    raise ValueError("AVI frame start requires frame, X and Y, and cannot be combined with a slot")
                start_slot = inspect_video(data).slot_for(start_frame, start_x, start_y, start_channel)
            return estimate(data, content_length, metadata={"filename": Path(content_name).name,
                                                             "media_type": content_type}, depth=depth, start=start_slot)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

    @app.post("/api/v2/jobs/protect")
    async def protect(request: Request, cover: UploadFile = File(...), content_file: UploadFile | None = File(None),
                      content_text: str | None = Form(None), private_key: str = Form(...), key_password: str = Form(""),
                      depth: int = Form(3), start_slot: int | None = Form(None),
                      start_frame: int | None = Form(None), start_x: int | None = Form(None),
                      start_y: int | None = Form(None), start_channel: int = Form(0)):
        _session(request)
        carrier = await _read(cover, "cover")
        if len(private_key) > 32768 or len(key_password.encode()) > 1024:
            raise HTTPException(400, "private key or password is too long")
        if content_file is not None and content_file.filename:
            content = await _read(content_file, "content", MAX_CONTENT_BYTES)
            filename = Path(content_file.filename).name
            mime = content_file.content_type or "application/octet-stream"
        elif content_text is not None:
            if len(content_text.encode("utf-8")) > 1024 * 1024:
                raise HTTPException(413, "text content exceeds 1 MiB")
            content = content_text.encode("utf-8")
            filename, mime = "message.txt", "text/plain; charset=utf-8"
        else:
            raise HTTPException(400, "choose a content file or enter text")
        try:
            key = load_signing_key(private_key.encode(), key_password.encode() if key_password else None)
            kind, sender, _, extension = _media(carrier)
            if start_frame is not None or start_x is not None or start_y is not None:
                if kind != "video" or None in (start_frame, start_x, start_y) or start_slot is not None:
                    raise ValueError("AVI frame start requires frame, X and Y, and cannot be combined with a slot")
                start_slot = inspect_video(carrier).slot_for(start_frame, start_x, start_y, start_channel)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

        def work(session, check):
            result = sender(carrier, content, key, metadata={"filename": filename, "media_type": mime}, depth=depth, start=start_slot)
            check()
            session.jobs[session.active_job].phase = "publishing"
            registry = request.app.state.registry
            output = registry.artifact(session, result.carrier, "stego" + extension,
                                       "video/x-msvideo" if kind == "video" else "audio/wav" if kind == "audio" else "image/png" if extension == ".png" else "image/bmp", "stego")
            sidecar = registry.artifact(session, result.sidecar, "recovery.stegloc", "application/octet-stream", "sidecar")
            return {"carrier": {"id": output, "filename": "stego" + extension, "size": len(result.carrier)},
                    "recovery": {"id": sidecar, "filename": "recovery.stegloc", "size": len(result.sidecar)},
                    "recovery_code": result.recovery_code, "record": result.record, "media_kind": kind}

        return _launch(request, "protect", work)

    @app.post("/api/v2/jobs/verify")
    async def verify(request: Request, stego: UploadFile = File(...), recovery: UploadFile = File(...),
                     recovery_code: str = Form(...), public_key: str = Form(...)):
        _session(request)
        carrier = await _read(stego, "stego")
        sidecar = await _read(recovery, "recovery", 8192)
        if len(recovery_code) > 100 or len(public_key) > 32768:
            raise HTTPException(400, "recovery code or public key is too long")
        try:
            key = load_verification_key(public_key.encode())
            _, _, recipient, _ = _media(carrier)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

        def work(session, check):
            result = recipient(carrier, sidecar, recovery_code, key)
            check()
            session.jobs[session.active_job].phase = "publishing"
            content_file = None
            if result.content is not None and result.record is not None:
                info = result.record["content"]
                name = Path(info["filename"]).name
                ident = request.app.state.registry.artifact(session, result.content, name, info["media_type"], "content")
                content_file = {"id": ident, "filename": name, "size": len(result.content), "media_type": info["media_type"]}
            return {"verdict": result.overall.value, "stages": result.stages, "record": result.record, "content": content_file}

        return _launch(request, "verify", work)
