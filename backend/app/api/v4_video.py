"""Optional location retry for the v2 video verifier."""
from __future__ import annotations

import hashlib
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from starlette.concurrency import run_in_threadpool

from ..stego.carriers.video import inspect_video
from ..stego.v2_security import (_decrypt_and_verify_locator, _parse_sidecar,
    decode_recovery_code, derive_keys, load_verification_key)
from ..workflows import verify_video
from ..v2_results import Verdict
from .session_jobs import _read, _session


def attach(app: FastAPI, store) -> None:
    @app.post("/api/v4/video/verify")
    async def verify_at(request: Request, stego: UploadFile = File(...), recovery: UploadFile = File(...),
                        recovery_code: str = Form(...), public_key: str = Form(...),
                        start_slot: int | None = Form(None), start_frame: int | None = Form(None),
                        start_x: int | None = Form(None), start_y: int | None = Form(None),
                        start_channel: int = Form(0)):
        _, session = _session(request)
        carrier = await _read(stego, "Protected AVI")
        sidecar = await _read(recovery, "Recovery", 8192)
        if len(recovery_code) > 100 or len(public_key) > 32768:
            raise HTTPException(400, "Verification input is too long")
        try:
            key = load_verification_key(public_key.encode())
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

        def work():
            baseline = verify_video(carrier, sidecar, recovery_code, key)
            def response(verdict, stages, record=None, content=None, location=None):
                saved = None
                if content is not None and record is not None:
                    info = record["content"]
                    name = Path(info["filename"]).name
                    ident = request.app.state.registry.artifact(session, content, name, info["media_type"], "content")
                    saved = {"id": ident, "filename": name, "media_type": info["media_type"], "size": len(content)}
                return {"verdict": verdict, "stages": stages, "record": record, "content": saved,
                    "download_url": f"/api/v2/artifacts/{saved['id']}?download=1" if saved else None,
                    "attempted_location": location,
                    "payload_hash": {"algorithm": "SHA-256", "scope": "decoded payload bytes",
                        "expected": record["content"]["sha256"] if record else None,
                        "computed": hashlib.sha256(content).hexdigest() if content is not None else None,
                        "status": "match" if content is not None else "not_reached",
                        "expected_trusted": baseline.overall is Verdict.AUTHENTIC}}
            if baseline.overall is not Verdict.AUTHENTIC:
                return response(baseline.overall.value, baseline.stages)
            adapter = inspect_video(carrier)
            secret = decode_recovery_code(recovery_code)
            salt, _, _, _ = _parse_sidecar(sidecar)
            loc = _decrypt_and_verify_locator(sidecar, derive_keys(secret, salt).locator, key)
            actual = int(loc["start_slot"])
            if start_slot is not None and any(v is not None for v in (start_frame, start_x, start_y)):
                raise ValueError("Choose an exact slot or frame coordinates, not both")
            if any(v is not None for v in (start_frame, start_x, start_y)):
                if None in (start_frame, start_x, start_y):
                    raise ValueError("Frame, X and Y are all required")
                attempted = adapter.slot_for(start_frame, start_x, start_y, start_channel)
            else:
                attempted = actual if start_slot is None else start_slot
            if attempted != actual:
                try:
                    extracted = adapter.extract(int(loc["encoded_byte_length"]), int(loc["depth"]), attempted)
                    matches = hashlib.sha256(extracted).hexdigest() == loc["encrypted_package_sha256"]
                except (ValueError, IndexError):
                    matches = False
                if not matches:
                    stages = dict(baseline.stages)
                    stages["manual_location"] = {"status": "failed", "evidence": "",
                        "reason": f"Slot {attempted} does not contain the authenticated package; stored start is {actual}"}
                    return response("Wrong Start Location", stages, location=attempted)
            return response(baseline.overall.value, baseline.stages, baseline.record, baseline.content, attempted)
        try:
            return await run_in_threadpool(work)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
