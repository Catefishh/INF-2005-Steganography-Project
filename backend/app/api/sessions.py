"""Sessions endpoints."""
from __future__ import annotations


from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response

from ..session import Registry, require_artifact

from .session_jobs import _session, _check_origin, _job_info

def attach(app: FastAPI) -> None:
    app.state.registry = Registry()
    @app.post("/api/v2/session")
    def start_session(request: Request):
        _check_origin(request)
        token, _ = request.app.state.registry.session(request.cookies.get("stegloc_session"))
        response = Response(content='{"status":"ready"}', media_type="application/json")
        response.set_cookie("stegloc_session", token, httponly=True, samesite="strict")
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Session-Token"] = token
        return response

    @app.delete("/api/v2/session")
    def end_session(request: Request):
        token, _ = _session(request)
        request.app.state.registry.reset(token)
        response = Response(status_code=204)
        response.delete_cookie("stegloc_session")
        return response

    @app.get("/api/v2/jobs/{ident}")
    def get_job(request: Request, ident: str):
        _, session = _session(request)
        job = session.jobs.get(ident)
        if job is None:
            raise HTTPException(404, "job not found")
        return _job_info(ident, job)

    @app.delete("/api/v2/jobs/{ident}")
    def cancel_job(request: Request, ident: str):
        _, session = _session(request)
        job = session.jobs.get(ident)
        if job is None:
            raise HTTPException(404, "job not found")
        job.cancel.set()
        return _job_info(ident, job)

    @app.get("/api/v2/artifacts/{ident}")
    def artifact(request: Request, ident: str):
        _, session = _session(request)
        item = require_artifact(session, ident)
        filename = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in item.filename) or "file"
        return Response(item.data, media_type=item.media_type, headers={
            "Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff"})
