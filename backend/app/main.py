"""FastAPI server for the Stegloc GUI (local use only)."""

import os
import secrets
import threading
from collections import OrderedDict
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .stego import analysis, attacks, engine
from .stego.analysis.bpcs import BPCSConfig
from .stego.covers import CoverError, load_cover
from .stego.security import (KeyFormatError, fingerprint, generate_rsa_keys, load_private_key,
                             load_public_key)

DEFAULT_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"
FRONTEND_DIST = Path(__file__).parents[2] / "frontend" / "dist"
MAX_UPLOAD_BYTES = 200 * 1024 * 1024
TEXT_PREVIEW_BYTES = 200_000


class FileStore:
    """Keeps generated files (stego, extracted payloads, tampered samples) in memory."""

    def __init__(self, max_files=80, max_bytes=1024 * 1024 * 1024):
        self.items = OrderedDict()
        self.max_files = max_files
        self.max_bytes = max_bytes
        self.lock = threading.Lock()

    def put(self, data, filename, media_type):
        file_id = secrets.token_urlsafe(16)
        with self.lock:
            self.items[file_id] = (data, filename, media_type)
            while len(self.items) > self.max_files or sum(len(v[0]) for v in self.items.values()) > self.max_bytes:
                self.items.popitem(last=False)
        return {"id": file_id, "filename": filename, "media_type": media_type, "size": len(data)}

    def get(self, file_id):
        with self.lock:
            return self.items.get(file_id)


class EstimateRequest(BaseModel):
    cover_kind: str = Field(max_length=10)
    descriptor: str = Field(max_length=200)
    cover_filename: str = Field("", max_length=200)
    payload_filename: str = Field(max_length=200)
    payload_type: str = Field(max_length=200)
    payload_size: int = Field(ge=0)
    team: str = Field("", max_length=200)
    key_bits: int = Field(2048, ge=1024, le=16384)


class KeyInspectRequest(BaseModel):
    pem: str = Field(max_length=32768)
    password: str | None = Field(None, max_length=1024)


async def _read(upload, name):
    data = await upload.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"{name} is larger than 200 MB.")
    return data


def _optional_int(value, name):
    if value is None or str(value).strip() == "":
        return None
    try:
        return int(value)
    except ValueError as exc:
        raise HTTPException(400, f"{name} must be a whole number.") from exc


def _optional_float(value, name):
    if value is None or str(value).strip() == "":
        return None
    try:
        return float(value)
    except ValueError as exc:
        raise HTTPException(400, f"{name} must be a number.") from exc


def _bad_request(exc):
    return HTTPException(400, str(exc))


def _looks_like_text(data):
    if b"\x00" in data[:4096]:
        return False
    try:
        data.decode("utf-8")
        return True
    except UnicodeDecodeError:
        return False


def create_app(frontend_dist: Path | None = None, *, desktop_token: str | None = None) -> FastAPI:
    app = FastAPI(title="Stegloc API")
    store = FileStore()
    app.state.store = store

    origins = ([] if desktop_token else
               [o.strip() for o in os.getenv("STEGLOC_DEV_ORIGINS", DEFAULT_ORIGINS).split(",") if o.strip()])
    if any("*" in origin for origin in origins):
        raise ValueError("STEGLOC_DEV_ORIGINS must not contain wildcard origins")
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["*"])

    if desktop_token:
        cookie_name = f"stegloc_{desktop_token[:16]}"

        @app.middleware("http")
        async def desktop_session(request: Request, call_next):
            if request.method == "GET" and secrets.compare_digest(
                request.url.path.encode(), f"/_desktop/{desktop_token}".encode()
            ):
                response = RedirectResponse("/", status_code=303)
                response.set_cookie(cookie_name, desktop_token, httponly=True, samesite="strict")
                response.headers["Cache-Control"] = "no-store"
                response.headers["Referrer-Policy"] = "no-referrer"
                return response
            if not secrets.compare_digest(request.cookies.get(cookie_name, "").encode(), desktop_token.encode()):
                return Response("This service belongs to a Stegloc desktop window.", status_code=403)
            origin = request.headers.get("origin")
            if request.method not in {"GET", "HEAD"} and origin and origin != str(request.base_url).rstrip("/"):
                return Response("Origin not allowed.", status_code=403)
            response = await call_next(request)
            response.headers["Cache-Control"] = "no-store"
            return response

    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1"])

    @app.get("/api/health")
    def health():
        return {"status": "ok", "service": "stegloc-api"}

    # ---------------------------------------------------------------- keys --
    @app.post("/api/keys/generate")
    def keys_generate():
        private_pem, public_pem = generate_rsa_keys()
        key = load_public_key(public_pem)
        return {"private_key": private_pem.decode(), "public_key": public_pem.decode(),
                "fingerprint": fingerprint(key), "bits": key.key_size}

    @app.post("/api/keys/inspect")
    def keys_inspect(body: KeyInspectRequest):
        pem = body.pem.encode()
        try:
            if b"PRIVATE KEY" in pem:
                if b"ENCRYPTED" in pem and not body.password:
                    return {"type": "private", "encrypted": True, "bits": None, "fingerprint": None}
                key = load_private_key(pem, body.password.encode() if body.password else None)
                return {"type": "private", "encrypted": b"ENCRYPTED" in pem, "bits": key.key_size,
                        "fingerprint": fingerprint(key.public_key())}
            key = load_public_key(pem)
            return {"type": "public", "encrypted": False, "bits": key.key_size, "fingerprint": fingerprint(key)}
        except KeyFormatError as exc:
            raise _bad_request(exc)

    # -------------------------------------------------------------- covers --
    @app.post("/api/inspect")
    async def inspect(file: UploadFile = File(...)):
        data = await _read(file, "Cover")

        def work():
            cover = load_cover(data)
            info = cover.info()
            info["file_size"] = len(data)
            info["header"] = cover.location(max(engine.header_slot(cover.n_slots), 0))
            info["capacity"] = [{"n_lsb": n, "max_package_bytes": max(0, engine.max_package_bytes(cover.n_slots, n))}
                                for n in range(1, 9)]
            return info
        try:
            return await run_in_threadpool(work)
        except CoverError as exc:
            raise _bad_request(exc)

    @app.post("/api/estimate")
    def estimate(body: EstimateRequest):
        try:
            size = engine.estimate_package_bytes(body.cover_kind, body.descriptor, body.cover_filename,
                                                 body.payload_filename, body.payload_type, body.payload_size,
                                                 body.team, body.key_bits)
        except ValueError as exc:
            raise _bad_request(exc)
        return {"package_bytes": size}

    # ---------------------------------------------------------------- hide --
    @app.post("/api/hide")
    async def hide(cover: UploadFile = File(...), payload_file: UploadFile | None = File(None),
                   payload_text: str | None = Form(None), passphrase: str = Form(...),
                   private_key: str = Form(...), key_password: str | None = Form(None),
                   n_lsb: int = Form(1), start_mode: str = Form("auto"), start_x: str | None = Form(None),
                   start_y: str | None = Form(None), start_seconds: str | None = Form(None),
                   start_slot: str | None = Form(None), team: str = Form("")):
        cover_data = await _read(cover, "Cover")
        if payload_file is not None and payload_file.filename:
            content = await _read(payload_file, "Payload")
            payload_name = payload_file.filename
            payload_type = payload_file.content_type or "application/octet-stream"
        elif payload_text:
            content = payload_text.encode("utf-8")
            payload_name, payload_type = "message.txt", "text/plain; charset=utf-8"
        else:
            raise HTTPException(400, "Add a secret message or choose a payload file.")
        manual = dict(start_x=_optional_int(start_x, "Start X"), start_y=_optional_int(start_y, "Start Y"),
                      start_seconds=_optional_float(start_seconds, "Start time"),
                      start_slot=_optional_int(start_slot, "Start slot"))

        def work():
            return engine.hide(cover_data, cover.filename or "cover", content, payload_name, payload_type,
                               passphrase, private_key.encode(), (key_password or "").encode() or None, n_lsb,
                               start_mode, team=team, **manual)
        try:
            stego, cover_obj, report = await run_in_threadpool(work)
        except ValueError as exc:  # CoverError, CapacityError, StartLocationError, KeyFormatError
            raise _bad_request(exc)
        stem = Path(cover.filename or "cover").stem or "cover"
        saved = store.put(stego, f"stego_{stem}{cover_obj.extension}", cover_obj.mime)
        return {"stego": saved, "report": report}

    # -------------------------------------------------------------- verify --
    @app.post("/api/verify")
    async def verify(stego: UploadFile = File(...), passphrase: str = Form(""), public_key: str = Form(""),
                     start_x: str | None = Form(None), start_y: str | None = Form(None),
                     start_seconds: str | None = Form(None), start_slot: str | None = Form(None)):
        data = await _read(stego, "Stego file")
        manual = dict(start_x=_optional_int(start_x, "Start X"), start_y=_optional_int(start_y, "Start Y"),
                      start_seconds=_optional_float(start_seconds, "Start time"),
                      start_slot=_optional_int(start_slot, "Start slot"))
        result = await run_in_threadpool(engine.verify, data, passphrase, public_key.encode(), **manual)
        content = result.pop("content")
        result["content"] = None
        if content is not None and result["record"]:
            payload = result["record"]["payload"]
            saved = store.put(content, Path(str(payload.get("filename") or "payload.bin")).name,
                              str(payload.get("media_type") or "application/octet-stream"))
            if _looks_like_text(content):
                saved["text"] = content[:TEXT_PREVIEW_BYTES].decode("utf-8", errors="replace")
                saved["text_truncated"] = len(content) > TEXT_PREVIEW_BYTES
            result["content"] = saved
        return result

    # ------------------------------------------------------------ analysis --
    @app.post("/api/analyse")
    async def analyse(
        file: UploadFile = File(...),
        compare: UploadFile | None = File(None),
        channel: int = Form(0),
        bpcs_channel: str | None = Form(None),
        bpcs_block_size: str | None = Form(None),
        bpcs_bit_plane_start: str | None = Form(None),
        bpcs_bit_plane_end: str | None = Form(None),
        bpcs_complexity_threshold: str | None = Form(None),
    ):
        data = await _read(file, "File")
        other = await _read(compare, "Comparison file") if compare is not None and compare.filename else None
        try:
            config = BPCSConfig.from_values(
                bpcs_channel,
                bpcs_block_size,
                bpcs_bit_plane_start,
                bpcs_bit_plane_end,
                bpcs_complexity_threshold,
            )
            return await run_in_threadpool(analysis.analyse, data, other, channel, config)
        except ValueError as exc:
            raise _bad_request(exc)

    @app.post("/api/attacks")
    async def attack_suite(stego: UploadFile = File(...), cover: UploadFile | None = File(None),
                           passphrase: str = Form(...), public_key: str = Form(...)):
        data = await _read(stego, "Stego file")
        original = await _read(cover, "Cover") if cover is not None and cover.filename else None
        try:
            scenarios, files = await run_in_threadpool(attacks.run_suite, data, passphrase, public_key.encode(),
                                                       original)
        except ValueError as exc:
            raise _bad_request(exc)
        media = load_cover(data).mime
        saved = {key: store.put(content, name, "image/png" if name.endswith(".png") else media)
                 for key, (name, content) in files.items()}
        for scenario in scenarios:
            scenario["file"] = saved.get(scenario["file"]) if scenario["file"] else None
        return {"scenarios": scenarios}

    # --------------------------------------------------------------- files --
    @app.get("/api/files/{file_id}")
    def download(file_id: str, download: int = 0):
        item = store.get(file_id)
        if item is None:
            raise HTTPException(404, "File expired. Run the operation again.")
        data, filename, media_type = item
        disposition = "attachment" if download else "inline"
        safe = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in filename) or "file"
        return Response(data, media_type=media_type, headers={
            "Content-Disposition": f'{disposition}; filename="{safe}"', "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff"})

    dist = frontend_dist or FRONTEND_DIST
    if dist.is_dir():
        app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
    return app


app = create_app()
