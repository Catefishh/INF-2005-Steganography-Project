import os
import re
import threading
import uuid
import json
import asyncio
import secrets
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import Response, StreamingResponse
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, Field, ConfigDict

from . import workflows
from .session import Registry, current_session, require_artifact, Session, Job
from .cancellation import installed as install_cancel
from .stego.carriers.image import inspect_image
from .stego.carriers.audio import inspect_audio
from .stego.security import (generate_ed25519_private_key, export_private_key_pem,
    export_public_key_pem, import_private_key_pem, import_public_key_pem)


DEFAULT_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"
FRONTEND_DIST = Path(__file__).parents[2] / "frontend" / "dist"
MAX_MEDIA = 100 * 1024 * 1024
MAX_TEXT = 10 * 1024 * 1024
SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")


class EstimateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    cover_artifact_id: str
    payload_artifact_id: str
    depth: int = Field(3, ge=1, le=8)
    start: int | None = Field(None, ge=0)
    filename: str | None = Field(None, max_length=255)
    media_type: str | None = Field(None, max_length=127)
    team: dict[str, str] = Field(default_factory=dict, max_length=16)


class ProtectRequest(EstimateRequest):
    private_key: str = Field(max_length=16384, repr=False)
    password: str = Field(max_length=4096, repr=False)
    filename: str | None = Field(None, max_length=255)
    media_type: str | None = Field(None, max_length=127)
    team: dict[str, str] = Field(default_factory=dict, max_length=16)


class VerifyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    stego_artifact_id: str
    sidecar_artifact_id: str
    recovery_code: str = Field(min_length=1, max_length=4096)
    public_key: str | None = Field(None, max_length=16384)
    public_key_artifact_id: str | None = None


class KeyRequest(BaseModel):
    include_private: bool = False
    password: str | None = Field(None, min_length=1, max_length=4096)


class TextRequest(BaseModel):
    text: str = Field(max_length=MAX_TEXT, repr=False)


def _filename(name: str | None) -> str:
    clean = SAFE_NAME.sub("_", Path(name or "upload.bin").name).strip("._")
    return (clean or "upload.bin")[:120]


async def _read_upload(registry, session: Session, upload: UploadFile, limit: int, destination: Path) -> int:
    total = 0
    reserved = 0
    complete = False
    try:
        with destination.open("wb") as output:
            while chunk := await upload.read(1024 * 1024):
                if total + len(chunk) > limit:
                    raise HTTPException(413, "upload is too large")
                registry.reserve_upload_bytes(session, len(chunk))
                reserved += len(chunk)
                total += len(chunk)
                output.write(chunk)
        complete = True
    finally:
        if not complete:
            registry.release_upload_bytes(session, reserved)
    return total


def _media(data: bytes):
    try:
        if data[:2] == b"BM" or data[:8] == b"\x89PNG\r\n\x1a\n":
            inspect_image(data); return "image"
        inspect_audio(data); return "audio"
    except Exception as exc:
        raise HTTPException(422, "unsupported or malformed media") from exc


def _start_job(session: Session, fn):
    if session.active_job:
        active = session.jobs.get(session.active_job)
        if active and active.status in {"queued", "running"}:
            raise HTTPException(409, "a job is already active")
    ident = uuid.uuid4().hex
    if len(session.jobs) >= 64:
        raise HTTPException(429, "job limit reached; reset session")
    job = session.jobs[ident] = Job(session.root)
    session.active_job = ident
    session.active_operations += 1
    def run():
        try:
            with session.lock:
                _check_job(job, session)
                job.status = "running"
            if job.cancel.is_set(): raise InterruptedError
            with install_cancel(lambda: _check_job(job, session)):
                result = fn(job)
            with session.lock:
                if job.cancel.is_set() or session.closed: raise InterruptedError
                job.result = result
                job.status = "succeeded"
        except InterruptedError:
            job.status = "cancelled"
            job.result = None
        except Exception as exc:
            job.status = "failed"
            job.error = {"code": "workflow_error", "message": "Operation could not be completed"}
        finally:
            with session.lock:
                session.active_operations = max(0, session.active_operations - 1)
                session.operations_done.notify_all()
                if session.active_job == ident: session.active_job = None
    threading.Thread(target=run, daemon=True).start()
    return ident


def _check_job(job: Job, session: Session) -> None:
    if job.cancel.is_set() or session.closed:
        raise InterruptedError


def create_app(frontend_dist: Path | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app):
        async def sweep():
            while True:
                await asyncio.sleep(30)
                with app.state.registry.lock:
                    app.state.registry.expire()
        task = asyncio.create_task(sweep())
        try: yield
        finally:
            task.cancel()
            for token in list(app.state.registry.sessions): app.state.registry.reset(token)
    app = FastAPI(title="Stegloc API", lifespan=lifespan)
    app.state.registry = Registry()
    origins = [
        origin.strip()
        for origin in os.getenv("STEGLOC_DEV_ORIGINS", DEFAULT_ORIGINS).split(",")
        if origin.strip()
    ]
    if any("*" in origin for origin in origins):
        raise ValueError("STEGLOC_DEV_ORIGINS must not contain wildcard origins")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_methods=["*"],
        allow_headers=["*"],
        allow_credentials=True,
    )
    app.add_middleware(
        TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1"]
    )

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        return Response('{"detail":"invalid request"}', status_code=422, media_type="application/json")

    @app.middleware("http")
    async def request_limits(request, call_next):
        origin = request.headers.get("origin")
        if origin and origin not in origins and origin not in {"http://" + request.headers.get("host", ""), "https://" + request.headers.get("host", "")}:
            return Response(status_code=403)
        limit = MAX_MEDIA + 65536 if request.headers.get("content-type", "").startswith("multipart/") else MAX_TEXT + 65536
        received = 0
        receive = request._receive
        async def bounded_receive():
            nonlocal received
            message = await receive()
            received += len(message.get("body", b""))
            if received > limit: raise HTTPException(413, "request too large")
            return message
        request._receive = bounded_receive
        try:
            if int(request.headers.get("content-length", "0")) > limit: return Response(status_code=413)
        except ValueError: return Response(status_code=400)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": "stegloc-api"}

    @app.post("/api/keys/generate")
    def keys(body: KeyRequest, request: Request):
        token, _ = current_session(request)
        key = generate_ed25519_private_key()
        public = export_public_key_pem(key.public_key()).decode()
        result = {"public_key": public}
        if body.include_private:
            if not body.password: raise HTTPException(422, "password required")
            result["private_key"] = export_private_key_pem(key, body.password).decode()
        return _session_response(request, token, result)

    @app.post("/api/covers", status_code=201)
    async def covers(request: Request, file: UploadFile = File(...)):
        return await _store_upload(request, file, "cover", True)

    @app.post("/api/payloads", status_code=201)
    async def payloads(request: Request, file: UploadFile = File(...)):
        return await _store_upload(request, file, "payload", False)

    @app.post("/api/recovery", status_code=201)
    async def recovery(request: Request, file: UploadFile = File(...)):
        return await _store_upload(request, file, "recovery", False)

    @app.post("/api/keys/public", status_code=201)
    async def public_key_upload(request: Request, file: UploadFile = File(...)):
        return await _store_upload(request, file, "public_key", False)

    @app.post("/api/payloads/text", status_code=201)
    def text_payload(body: TextRequest, request: Request):
        token, session = current_session(request)
        data = body.text.encode("utf-8")
        if len(data) > MAX_TEXT: raise HTTPException(413, "text too large")
        ident = app.state.registry.artifact(session, data, "payload.txt", "text/plain", "payload")
        return _session_response(request, token, {"artifact_id": ident}, 201)

    @app.post("/api/estimate")
    def estimate(body: EstimateRequest, request: Request):
        token, session = current_session(request)
        cover = require_artifact(session, body.cover_artifact_id, {"cover"})
        payload = require_artifact(session, body.payload_artifact_id, {"payload"})
        try:
            result = workflows.estimate(cover.data, len(payload.data), metadata={"filename": body.filename or payload.filename, "media_type": body.media_type or payload.media_type, "team": body.team}, depth=body.depth)
            if body.start is not None:
                adapter = workflows._inspect(cover.data)
                result["start"] = body.start
                result["available_bytes"] = workflows.lsb.available_bytes(adapter.eligible_slots, body.start, body.depth)
                result["remaining_bytes"] = result["available_bytes"] - result["total_bytes"]
                result["fits"] = workflows.lsb.fits(adapter.eligible_slots, body.start, body.depth, result["total_bytes"])
        except Exception as exc: raise HTTPException(422, "invalid media or estimate") from exc
        return _session_response(request, token, result)

    @app.post("/api/protect", status_code=202)
    def protect(body: ProtectRequest, request: Request):
        token, session = current_session(request)
        cover = require_artifact(session, body.cover_artifact_id, {"cover"})
        payload = require_artifact(session, body.payload_artifact_id, {"payload"})
        try: key = import_private_key_pem(body.private_key.encode(), body.password)
        except Exception as exc: raise HTTPException(422, "invalid private key") from exc
        def work(job):
            kind = _media(cover.data)
            metadata = {"filename": body.filename or payload.filename, "media_type": body.media_type or payload.media_type, "team": body.team}
            result = workflows.protect_image(cover.data, payload.data, key, metadata=metadata, depth=body.depth, start=body.start) if kind == "image" else workflows.protect_audio(cover.data, payload.data, key, metadata=metadata, depth=body.depth, start=body.start)
            if job.cancel.is_set() or session.closed: raise InterruptedError
            staged = []
            registered = []
            try:
                for data, filename, kind_name in ((result.carrier, "protected." + cover.filename.split(".")[-1], "stego"), (result.sidecar, "locator.stegloc", "sidecar")):
                    path = Path(session.directory.name) / ("stage-" + secrets.token_hex(12))
                    path.write_bytes(data)
                    staged.append((path, filename, kind_name))
                _check_job(job, session)
                with session.lock:
                    _check_job(job, session)
                    for path, filename, kind_name in staged:
                        registered.append(session_registry(request).artifact_file(session, path, filename, "application/octet-stream", kind_name))
                    return {"stego_artifact_id": registered[0], "sidecar_artifact_id": registered[1], "recovery_code": result.recovery_code}
            except BaseException:
                with session.lock:
                    for ident in registered:
                        artifact = session.artifacts.pop(ident, None)
                        if artifact: artifact.path.unlink(missing_ok=True)
                for path, *_ in staged: path.unlink(missing_ok=True)
                raise
        with session.lock:
            return _session_response(request, token, {"job_id": _start_job(session, work)}, 202)

    @app.post("/api/verify", status_code=202)
    def verify(body: VerifyRequest, request: Request):
        token, session = current_session(request)
        stego = require_artifact(session, body.stego_artifact_id, {"stego", "cover"})
        sidecar = require_artifact(session, body.sidecar_artifact_id, {"sidecar", "recovery"})
        key_data = require_artifact(session, body.public_key_artifact_id, {"public_key"}).data if body.public_key_artifact_id else (body.public_key or "").encode()
        try: public = import_public_key_pem(key_data)
        except Exception as exc: raise HTTPException(422, "invalid public key") from exc
        def work(job):
            result = workflows.verify_image(stego.data, sidecar.data, body.recovery_code, public) if _media(stego.data) == "image" else workflows.verify_audio(stego.data, sidecar.data, body.recovery_code, public)
            if job.cancel.is_set() or session.closed: raise InterruptedError
            ident = None
            if result.overall is workflows.Verdict.AUTHENTIC:
                record = result.record or {}
                content = result.content or b""
                path = Path(session.directory.name) / ("stage-" + secrets.token_hex(12))
                path.write_bytes(content)
                try:
                    _check_job(job, session)
                    with session.lock:
                        _check_job(job, session)
                        ident = session_registry(request).artifact_file(session, path, record.get("content", {}).get("filename", "verified.bin"), record.get("content", {}).get("media_type", "application/octet-stream"), "content")
                except BaseException:
                    path.unlink(missing_ok=True)
                    raise
            return {"overall": result.overall.value, "stages": result.stages, "content_artifact_id": ident}
        with session.lock:
            return _session_response(request, token, {"job_id": _start_job(session, work)}, 202)

    @app.get("/api/jobs/{job_id}")
    def job(job_id: str, request: Request):
        _, session = current_session(request); item = session.jobs.get(job_id)
        if not item: raise HTTPException(404, "job not found")
        return {"job_id": job_id, "status": item.status, "progress": item.progress, "result": item.result, "error": item.error}

    @app.delete("/api/jobs/{job_id}", status_code=202)
    def cancel(job_id: str, request: Request):
        _, session = current_session(request); item = session.jobs.get(job_id)
        if not item: raise HTTPException(404, "job not found")
        with session.lock:
            item.cancel.set()
        return {"status": "cancellation_requested"}

    @app.get("/api/artifacts/{artifact_id}")
    def download(artifact_id: str, request: Request):
        _, session = current_session(request); artifact = require_artifact(session, artifact_id)
        def chunks():
            with artifact.path.open("rb") as stream:
                while chunk := stream.read(1024 * 1024): yield chunk
        return StreamingResponse(chunks(), media_type=artifact.media_type, headers={"Content-Disposition": f'attachment; filename="{_filename(artifact.filename)}"'})

    @app.delete("/api/session", status_code=204)
    def cleanup(request: Request):
        token = request.cookies.get("stegloc_session") or request.headers.get("X-Session-Token")
        if token: app.state.registry.reset(token)
        return Response(status_code=204)

    dist = frontend_dist or FRONTEND_DIST
    if dist.is_dir():
        app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")

    return app


def session_registry(request: Request):
    return request.app.state.registry


def _session_response(request: Request, token: str, body: dict, status_code: int = 200):
    response = Response(content=json.dumps(body), media_type="application/json", status_code=status_code)
    response.set_cookie("stegloc_session", token, httponly=True, samesite="strict")
    return response


async def _store_upload(request: Request, file: UploadFile, kind: str, parsed: bool):
    token, session = current_session(request)
    temporary = Path(session.directory.name) / ("upload-" + secrets.token_hex(12))
    registry = request.app.state.registry
    registry.reserve_upload(session)
    reserved = 0
    try:
        size = await _read_upload(registry, session, file, 16384 if kind == "public_key" else 65536 if kind == "recovery" else MAX_MEDIA, temporary)
        reserved = size
        data = temporary.read_bytes() if parsed or kind in {"public_key", "recovery"} else None
        media_type = "application/octet-stream"
        filename = _filename(file.filename)
        if parsed:
            media = _media(data)
            suffix = "wav" if media == "audio" else "bmp" if data[:2] == b"BM" else "png"
            media_type = {"wav": "audio/wav", "bmp": "image/bmp", "png": "image/png"}[suffix]
            filename = "cover." + suffix
        if kind == "public_key":
            try: import_public_key_pem(data)
            except ValueError as exc: raise HTTPException(422, "invalid public key") from exc
        if kind == "recovery":
            from .stego.security import _parse_sidecar
            try: _parse_sidecar(data)
            except ValueError as exc: raise HTTPException(422, "invalid recovery file") from exc
        ident = request.app.state.registry.artifact_file(session, temporary, filename, media_type, kind)
        return _session_response(request, token, {"artifact_id": ident, "filename": _filename(file.filename), "size": size}, 201)
    finally:
        try:
            temporary.unlink(missing_ok=True)
            await file.close()
        finally:
            registry.release_upload(session, reserved)


app = create_app()
