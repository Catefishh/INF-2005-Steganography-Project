"""V3 text endpoints."""

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile

from ..stego import text_v3
from ..stego.v2_security import load_signing_key, load_verification_key
from .session_jobs import _check_origin, _launch, _read, _session

def attach(app: FastAPI) -> None:
    @app.post("/api/v3/text/estimate")
    def text_estimate(request: Request, message: str = Form(""), method: str = Form(...), visible: str = Form("")):
        _check_origin(request)
        try:
            return text_v3.estimate(message, method, visible)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

    @app.post("/api/v3/jobs/text/protect")
    def text_protect(request: Request, message: str = Form(""), method: str = Form(...),
                     visible: str = Form(""), private_key: str = Form(...), key_password: str = Form("")):
        _session(request)
        if len(private_key) > 32768 or len(key_password) > 1024:
            raise HTTPException(400, "Private key or password is too long")
        try:
            key = load_signing_key(private_key.encode(), key_password.encode() if key_password else None)
            text_v3.estimate(message, method, visible)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

        def work(session, check):
            result = text_v3.protect(message, method, visible, key)
            check()
            registry = request.app.state.registry
            carrier = result.pop("carrier").encode("utf-8")
            recovery = result.pop("recovery")
            carrier_id = registry.artifact(session, carrier, "stegloc-text.txt", "text/plain; charset=utf-8", "text-carrier")
            recovery_id = registry.artifact(session, recovery, "recovery.stegloc-text", "application/octet-stream", "sidecar")
            result["carrier"] = {"id": carrier_id, "filename": "stegloc-text.txt", "size": len(carrier)}
            result["recovery"] = {"id": recovery_id, "filename": "recovery.stegloc-text", "size": len(recovery)}
            return result

        return _launch(request, "text-protect", work)

    @app.post("/api/v3/jobs/text/verify")
    async def text_verify(request: Request, carrier: UploadFile = File(...), recovery: UploadFile = File(...),
                          recovery_code: str = Form(...), public_key: str = Form(...)):
        _session(request)
        try:
            text = (await _read(carrier, "text carrier", text_v3.MAX_CARRIER)).decode("utf-8")
        except UnicodeDecodeError as exc:
            raise HTTPException(400, "Text carrier must be UTF-8") from exc
        sidecar = await _read(recovery, "text recovery", 4096)
        if len(recovery_code) > 100 or len(public_key) > 32768:
            raise HTTPException(400, "Recovery code or public key is too long")
        try:
            key = load_verification_key(public_key.encode())
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

        def work(session, check):
            result = text_v3.verify(text, sidecar, recovery_code, key)
            check()
            payload = result["message"].encode("utf-8")
            ident = request.app.state.registry.artifact(session, payload, "message.txt", "text/plain; charset=utf-8", "content")
            result["content"] = {"id": ident, "filename": "message.txt", "size": len(payload)}
            return result

        return _launch(request, "text-verify", work)
