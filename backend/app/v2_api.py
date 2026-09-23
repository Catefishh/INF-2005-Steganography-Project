"""Stable V2 registration and compatibility imports."""
from fastapi import FastAPI
from .workflows import protect_image
from .api import sessions, v2_keys, v2_protection
from .api.session_jobs import _read, _session, _check_origin, _job_info, _launch

def attach_v2(app: FastAPI) -> None:
    sessions.attach(app)
    v2_keys.attach(app)
    v2_protection.attach(app)
