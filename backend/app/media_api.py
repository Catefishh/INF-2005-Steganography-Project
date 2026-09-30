"""Stable media registration and compatibility imports."""
from fastapi import FastAPI
from .workflows import protect_image
from .api import sessions, signing_keys, media_protection
from .api.session_jobs import _read, _session, _check_origin, _job_info, _launch

def attach_media(app: FastAPI) -> None:
    sessions.attach(app)
    signing_keys.attach(app)
    media_protection.attach(app)
