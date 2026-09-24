"""Shared V2/V3 upload limits, session checks, and cancellable jobs."""
from __future__ import annotations
import secrets
import threading
from tempfile import SpooledTemporaryFile
from fastapi import HTTPException, Request, UploadFile
from ..cancellation import installed
from ..session import Job
from ..stego.carriers.audio import AudioError
from ..stego.carriers.image import ImageError
from ..stego.carriers.video import VideoError
from ..stego.lsb import CapacityError
from ..stego.v2_security import RecoveryError

MAX_V2_UPLOAD = 200 * 1024 * 1024


async def _read(upload: UploadFile, label: str, limit: int = MAX_V2_UPLOAD) -> bytes:
    total = 0
    with SpooledTemporaryFile(max_size=2 * 1024 * 1024) as staged:
        while part := await upload.read(1024 * 1024):
            total += len(part)
            if total > limit:
                raise HTTPException(413, f"{label} exceeds the {limit // (1024 * 1024)} MiB v2 input limit")
            staged.write(part)
        staged.seek(0)
        return staged.read()


def _session(request: Request):
    _check_origin(request)
    token = request.headers.get("X-Session-Token") or request.cookies.get("stegloc_session")
    if not token or token not in request.app.state.registry.sessions:
        raise HTTPException(401, "start a v2 session first")
    _, session = request.app.state.registry.session(token)
    return token, session


def _check_origin(request: Request) -> None:
    if request.method in {"GET", "HEAD"}:
        return
    origin = request.headers.get("origin")
    if origin and origin not in {str(request.base_url).rstrip("/"), *request.app.state.allowed_v2_origins}:
        raise HTTPException(403, "Origin not allowed")


def _job_info(ident: str, job: Job) -> dict:
    return {"id": ident, "status": job.status, "progress": job.progress, "phase": job.phase,
            "cases": list(job.cases), "completed": len(job.cases), "total": job.total_cases,
            "result": job.result if job.status == "succeeded" else None,
            "error": job.error if job.status == "failed" else None}


def _launch(request: Request, operation: str, work):
    token, session = _session(request)
    with session.lock:
        if session.active_job is not None:
            raise HTTPException(409, "another v2 job is active in this session")
        ident = secrets.token_urlsafe(18)
        job = Job(token)
        session.jobs[ident] = job
        session.active_job = ident
        request.app.state.registry.begin_operation(session)
        existing_artifacts = set(session.artifacts)

    def run():
        try:
            if job.cancel.is_set():
                raise InterruptedError
            job.status = "running"
            job.phase = operation
            def check():
                if job.cancel.is_set() or session.closed:
                    raise InterruptedError
            with installed(check):
                result = work(session, check)
            check()
            job.result = result
            job.progress = 100
            job.status = "succeeded"
            job.phase = "complete"
        except InterruptedError:
            job.status = "cancelled"
            job.phase = "cancelled"
        except (ValueError, RecoveryError, CapacityError, ImageError, AudioError, VideoError) as exc:
            job.error = {"message": str(exc)}
            job.status = "failed"
            job.phase = "failed"
        except HTTPException as exc:
            job.error = {"message": str(exc.detail)}
            job.status = "failed"
            job.phase = "failed"
        except Exception:
            job.error = {"message": f"{operation} failed unexpectedly"}
            job.status = "failed"
            job.phase = "failed"
        finally:
            with session.lock:
                if job.status != "succeeded":
                    for artifact_id in set(session.artifacts) - existing_artifacts:
                        session.artifacts.pop(artifact_id).path.unlink(missing_ok=True)
                session.active_job = None
            request.app.state.registry.end_operation(session)

    threading.Thread(target=run, daemon=True, name=f"stegloc-v2-{operation}").start()
    return _job_info(ident, job)
