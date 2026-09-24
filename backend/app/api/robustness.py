"""V3 robustness endpoints."""
import base64

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile

from ..stego import robustness, engine
from ..stego.covers import load_cover
from ..workflows import verify_image
from ..stego.v2_security import load_verification_key
from .session_jobs import _launch, _read, _session

def attach(app: FastAPI) -> None:
    @app.post("/api/v3/jobs/robustness")
    async def robustness_job(request: Request, stego: UploadFile = File(...), protocol: str = Form("legacy"),
                             passphrase: str = Form(""), public_key: str = Form(...),
                             recovery: UploadFile | None = File(None), recovery_code: str = Form(""),
                             resize: float = Form(0.75), crop: float = Form(0.90), jpeg: float = Form(75),
                             noise: float = Form(2), brightness: float = Form(1.1)):
        _session(request)
        carrier = await _read(stego, "stego image", 32 * 1024 * 1024)
        if protocol not in {"legacy", "v2"}:
            raise HTTPException(400, "Choose legacy or v2 verification")
        sidecar = await _read(recovery, "recovery", 8192) if recovery else None
        if protocol == "v2" and (sidecar is None or not recovery_code):
            raise HTTPException(400, "V2 needs recovery material and a code")
        if len(public_key) > 32768 or len(passphrase) > 1024 or len(recovery_code) > 100:
            raise HTTPException(400, "Verification input is too long")
        try:
            original = load_cover(carrier)
            if original.kind != "image":
                raise ValueError("Robustness transformations require an image")
            key = load_verification_key(public_key.encode()) if protocol == "v2" else public_key.encode()
            for name, value in (("resize", resize), ("crop", crop), ("jpeg", jpeg), ("noise", noise), ("brightness", brightness)):
                robustness.transform(carrier, name, value)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

        def verdict(data):
            try:
                if protocol == "v2":
                    return verify_image(data, sidecar, recovery_code, key).overall.value
                return engine.verify(data, passphrase, key)["verdict"]
            except ValueError:
                return "Cannot Verify"

        def work(session, check):
            baseline = verdict(carrier)
            rows = []
            for name, value in (("resize", resize), ("crop", crop), ("jpeg", jpeg), ("noise", noise), ("brightness", brightness)):
                check()
                output, extension = robustness.transform(carrier, name, value)
                observed = verdict(output)
                changed = load_cover(output)
                metrics = robustness.quality_metrics(original, changed, name)
                ident = request.app.state.registry.artifact(session, output, f"{name}{extension}", "image/png", "attacked-image")
                rows.append({"operation": name, "value": value, "verdict": observed,
                             "file": {"id": ident, "filename": f"{name}{extension}", "size": len(output)},
                             "preview": "data:image/png;base64," + base64.b64encode(output).decode("ascii") if len(output) < 2 * 1024 * 1024 else None,
                             "original_dimensions": [original.width, original.height],
                             "result_dimensions": [changed.width, changed.height],
                             "metrics": metrics})
            return {"baseline_verdict": baseline, "scenarios": rows,
                    "note": "A failed verifier rejects this copy; it does not prove the hidden bits were destroyed."}

        return _launch(request, "robustness", work)
