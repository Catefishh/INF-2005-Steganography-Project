"""V2 Keys endpoints."""
from __future__ import annotations


from fastapi import FastAPI, Form, HTTPException, Request

from ..stego.v2_security import RecoveryError, generate_signing_keys, load_verification_key, public_key_fingerprint

from .session_jobs import _check_origin

def attach(app: FastAPI) -> None:
    @app.post("/api/v2/keys/generate")
    def keys_generate(request: Request, password: str = Form("")):
        _check_origin(request)
        if not password or len(password.encode()) > 1024:
            raise HTTPException(400, "enter a password to encrypt the exported private key")
        private, public = generate_signing_keys(password.encode() if password else None)
        return {"private_key": private.decode(), "public_key": public.decode(),
                "fingerprint": public_key_fingerprint(load_verification_key(public)), "algorithm": "ed25519"}

    @app.post("/api/v2/keys/inspect")
    def keys_inspect(request: Request, public_key: str = Form(...)):
        _check_origin(request)
        if len(public_key) > 32768:
            raise HTTPException(400, "public key is too long")
        try:
            return {"algorithm": "ed25519", "fingerprint": public_key_fingerprint(
                load_verification_key(public_key.encode()))}
        except RecoveryError as exc:
            raise HTTPException(400, str(exc)) from exc
