"""FastAPI server for the Stegloc GUI (local use only)."""

import os
import secrets
import threading
import uuid
from collections import OrderedDict
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .api.common import EstimateRequest, KeyInspectRequest, MAX_UPLOAD_BYTES, _read, _optional_int, _optional_float, _bad_request, _looks_like_text
from .api import analysis as analysis_routes, files as file_routes, keys as key_routes, protection as protection_routes, v4_media, v4_jobs, v4_video
from .stego.security import generate_rsa_keys
from .v2_api import attach_v2
from .v3_api import attach_v3

DEFAULT_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"
FRONTEND_DIST = Path(__file__).parents[2] / "frontend" / "dist"
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



def create_app(frontend_dist: Path | None = None, *, desktop_token: str | None = None) -> FastAPI:
    app = FastAPI(title="Stegloc API", version="0.4.0")
    store = FileStore()
    app.state.store = store
    app.state.generate_rsa_keys = generate_rsa_keys
    attach_v2(app)
    attach_v3(app)

    origins = ([] if desktop_token else
               [o.strip() for o in os.getenv("STEGLOC_DEV_ORIGINS", DEFAULT_ORIGINS).split(",") if o.strip()])
    app.state.allowed_v2_origins = origins
    if any("*" in origin for origin in origins):
        raise ValueError("STEGLOC_DEV_ORIGINS must not contain wildcard origins")
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["*"])

    if desktop_token:
        cookie_name = f"stegloc_{desktop_token[:16]}"

        def graph_destination(path):
            if not isinstance(path, str) or not path.startswith("/graph/"):
                return False
            try:
                return path == f"/graph/{uuid.UUID(path.removeprefix('/graph/'))}"
            except (ValueError, TypeError):
                return False

        @app.middleware("http")
        async def desktop_session(request: Request, call_next):
            if request.method == "GET" and secrets.compare_digest(
                request.url.path.encode(), f"/_desktop/{desktop_token}".encode()
            ):
                next_path = request.query_params.get("next")
                response = RedirectResponse(next_path if graph_destination(next_path) else "/", status_code=303)
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

    key_routes.attach(app)
    protection_routes.attach(app, store)
    v4_media.attach(app, store)
    v4_jobs.attach(app)
    v4_video.attach(app, store)
    analysis_routes.attach(app, store)
    file_routes.attach(app, store)

    dist = frontend_dist or FRONTEND_DIST
    if dist.is_dir():
        def graph_entry(graph_id: str):
            return FileResponse(dist / "index.html")

        app.add_api_route("/graph/{graph_id}", graph_entry, methods=["GET"], include_in_schema=False)
        # Client routes must return the SPA shell on refresh and direct navigation.
        for route in ("/keys", "/embed", "/embed/result", "/verify", "/verify/result",
                      "/inspect", "/tamper-tests", "/v2", "/text"):
            app.add_api_route(route, lambda: FileResponse(dist / "index.html"), methods=["GET"],
                              include_in_schema=False)
        app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
    return app


app = create_app()
