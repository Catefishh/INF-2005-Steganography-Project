from __future__ import annotations

import secrets
import threading
import time
from pathlib import Path
from tempfile import TemporaryDirectory
from dataclasses import dataclass, field

from fastapi import HTTPException, Request


@dataclass
class Artifact:
    path: Path
    filename: str
    media_type: str
    kind: str

    @property
    def data(self):
        return self.path.read_bytes()


@dataclass
class Job:
    session_id: str
    status: str = "queued"
    progress: int = 0
    phase: str = "queued"
    result: dict | None = None
    error: dict | None = None
    cancel: threading.Event = field(default_factory=threading.Event)


@dataclass
class Session:
    root: str
    directory: TemporaryDirectory = field(default_factory=TemporaryDirectory)
    closed: bool = False
    touched: float = field(default_factory=time.monotonic)
    artifacts: dict[str, Artifact] = field(default_factory=dict)
    jobs: dict[str, Job] = field(default_factory=dict)
    active_job: str | None = None
    lock: threading.RLock = field(default_factory=threading.RLock)
    pending_uploads: int = 0
    pending_upload_bytes: int = 0
    active_operations: int = 0
    operations_done: threading.Condition = field(init=False)

    def __post_init__(self):
        self.operations_done = threading.Condition(self.lock)


class Registry:
    def __init__(self, ttl: int = 3600):
        self.ttl = ttl
        self.sessions: dict[str, Session] = {}
        self.lock = threading.RLock()

    def session(self, token: str | None) -> tuple[str, Session]:
        with self.lock:
            self.expire()
            if not token or token not in self.sessions:
                if len(self.sessions) >= 16:
                    raise HTTPException(503, "session limit reached")
                token = secrets.token_urlsafe(32)
                self.sessions[token] = Session(token)
            session = self.sessions[token]
            session.touched = time.monotonic()
            return token, session

    def artifact(self, session: Session, data: bytes, filename: str, media_type: str, kind: str) -> str:
        with session.lock:
            if session.closed:
                raise InterruptedError
            if len(session.artifacts) >= 64 or sum(a.path.stat().st_size for a in session.artifacts.values()) + len(data) > 512 * 1024 * 1024:
                raise HTTPException(413, "session storage limit reached")
            ident = secrets.token_urlsafe(24)
            path = Path(session.directory.name) / ident
            path.write_bytes(data)
            session.artifacts[ident] = Artifact(path, filename, media_type, kind)
            return ident

    def artifact_file(self, session: Session, path: Path, filename: str, media_type: str, kind: str) -> str:
        with session.lock:
            if session.closed:
                raise InterruptedError
            size = path.stat().st_size
            if len(session.artifacts) >= 64 or sum(a.path.stat().st_size for a in session.artifacts.values()) + size > 512 * 1024 * 1024:
                path.unlink(missing_ok=True)
                raise HTTPException(413, "session storage limit reached")
            ident = secrets.token_urlsafe(24)
            target = Path(session.directory.name) / ident
            path.replace(target)
            session.artifacts[ident] = Artifact(target, filename, media_type, kind)
            return ident

    def reserve_upload(self, session: Session) -> None:
        with session.lock:
            if session.closed: raise InterruptedError
            if session.pending_uploads >= 2: raise HTTPException(429, "too many concurrent uploads")
            session.pending_uploads += 1
            session.active_operations += 1

    def begin_operation(self, session: Session) -> None:
        with session.lock:
            if session.closed: raise InterruptedError
            session.active_operations += 1

    def end_operation(self, session: Session) -> None:
        with session.lock:
            session.active_operations = max(0, session.active_operations - 1)
            session.operations_done.notify_all()

    def reserve_upload_bytes(self, session: Session, amount: int) -> None:
        with session.lock:
            if session.closed: raise InterruptedError
            stored = sum(a.path.stat().st_size for a in session.artifacts.values())
            if stored + session.pending_upload_bytes + amount > 512 * 1024 * 1024:
                raise HTTPException(413, "session storage limit reached")
            session.pending_upload_bytes += amount

    def release_upload_bytes(self, session: Session, amount: int) -> None:
        with session.lock:
            session.pending_upload_bytes -= amount

    def release_upload(self, session: Session, amount: int) -> None:
        with session.lock:
            session.pending_uploads = max(0, session.pending_uploads - 1)
            session.pending_upload_bytes = max(0, session.pending_upload_bytes - amount)
            session.active_operations = max(0, session.active_operations - 1)
            session.operations_done.notify_all()

    def get_artifact(self, session: Session, ident: str) -> Artifact:
        artifact = session.artifacts.get(ident)
        if artifact is None:
            raise HTTPException(404, "artifact not found")
        return artifact

    def expire(self) -> None:
        now = time.monotonic()
        for token, session in list(self.sessions.items()):
            if now - session.touched > self.ttl:
                self.reset(token)

    def reset(self, token: str) -> None:
        with self.lock:
            session = self.sessions.pop(token, None)
        if session:
            with session.lock:
                session.closed = True
                for job in session.jobs.values():
                    job.cancel.set()
                    job.result = None
                session.jobs.clear()
                session.artifacts.clear()
            with session.operations_done:
                while session.active_operations:
                    session.operations_done.wait()
            session.directory.cleanup()


def current_session(request: Request) -> tuple[str, Session]:
    registry: Registry = request.app.state.registry
    return registry.session(request.cookies.get("stegloc_session") or request.headers.get("X-Session-Token"))


def require_artifact(session: Session, ident: str, kinds: set[str] | None = None) -> Artifact:
    artifact = session.artifacts.get(ident)
    if artifact is None or (kinds and artifact.kind not in kinds):
        raise HTTPException(404, "artifact not found")
    return artifact
