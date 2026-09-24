"""Session-scoped live evidence suite for existing RSA image and WAV carriers."""
from __future__ import annotations

import hashlib
import html
import io
import json
import re
import time
import zipfile
from pathlib import Path
import numpy as np
from PIL import Image

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response

from ..stego import attacks
from ..stego import engine
from ..stego import text_v3
from ..stego.covers import load_cover
from ..stego.carriers.video import inspect_video
from ..stego.protocol import MAX_CONTENT_BYTES
from ..stego.v2_security import (load_verification_key, generate_signing_keys, decode_recovery_code,
    derive_keys, _parse_sidecar, _decrypt_and_verify_locator, load_signing_key)
from ..workflows import verify_video, protect_video
from .session_jobs import _launch, _read, _session


def attach(app: FastAPI) -> None:
    @app.post("/api/v4/jobs/text-showcase")
    async def text_showcase(request: Request, mode: str = Form("test"), carrier: UploadFile | None = File(None),
                            recovery: UploadFile | None = File(None), recovery_code: str = Form(""),
                            public_key: str = Form(...), message: str = Form(""), method: str = Form("acrostic"),
                            visible: str = Form(""), private_key: str = Form(""), key_password: str = Form("")):
        _session(request)
        if mode not in {"test", "encode"}:
            raise HTTPException(400, "Unknown showcase mode")
        text_bytes = await _read(carrier, "text carrier", text_v3.MAX_CARRIER) if carrier and carrier.filename else None
        sidecar = await _read(recovery, "text recovery", 4096) if recovery and recovery.filename else None
        if not public_key or mode == "test" and (text_bytes is None or sidecar is None or not recovery_code) or mode == "encode" and not private_key:
            raise HTTPException(400, "Required text verification material is missing")
        if len(public_key) > 32768 or len(private_key) > 32768 or len(key_password) > 1024:
            raise HTTPException(400, "Key input is too long")
        try:
            text = text_bytes.decode("utf-8") if text_bytes is not None else None
            key = load_verification_key(public_key.encode())
            signer = load_signing_key(private_key.encode(), key_password.encode() or None) if mode == "encode" else None
        except (UnicodeError, ValueError) as exc:
            raise HTTPException(400, str(exc)) from exc

        def work(session, check):
            job = session.jobs[session.active_job]
            job.total_cases = 5
            job.phase = "baseline"
            started = time.monotonic()
            active, material, code = text, sidecar, recovery_code
            generated = None
            if mode == "encode":
                product = text_v3.protect(message, method, visible, signer)
                active, material, code = product["carrier"], product["recovery"], product["recovery_code"]
                ident = request.app.state.registry.artifact(session, active.encode("utf-8"),
                    "showcase_text.txt", "text/plain; charset=utf-8", "showcase")
                generated = {"id": ident, "filename": "showcase_text.txt", "size": len(active.encode("utf-8"))}
            rows = []
            def case(ident, title, change, expected, candidate, use_code=code, use_key=key):
                check()
                try:
                    verdict = text_v3.verify(candidate, material, use_code, use_key)["verdict"]
                except ValueError:
                    verdict = "Cannot Verify"
                row = {"id": ident, "title": title, "change": change, "expected": expected,
                    "verdict": verdict, "summary": "V3 authentication and signature checks", "as_expected": verdict in expected,
                    "elapsed_ms": round((time.monotonic() - started) * 1000), "file": None}
                rows.append(row); job.cases.append(row); job.phase = title
                job.progress = min(99, round(len(rows) / job.total_cases * 100))
            case("baseline", "Unmodified text", "none", ["Authentic"], active)
            if rows[0]["verdict"] != "Authentic":
                return {"cases": rows, "generated": generated, "baseline_authentic": False}
            case("wrong_code", "Wrong recovery code", "invalid code", ["Cannot Verify"], active, code + "-wrong")
            _, unrelated = generate_signing_keys()
            case("wrong_key", "Wrong public key", "unrelated Ed25519 key", ["Cannot Verify"], active,
                 use_key=load_verification_key(unrelated))
            damaged = _damage_text_symbol(active, method if mode == "encode" else json.loads(material)["method"])
            case("symbol_damage", "Hidden symbol damaged", "one encoded symbol changed", ["Cannot Verify"], damaged)
            visible_edit = _change_visible_text(active, method if mode == "encode" else json.loads(material)["method"])
            case("visible_wording", "Visible wording edited", "one visible character changed", ["Authentic"], visible_edit)
            return {"cases": rows, "generated": generated, "baseline_authentic": True,
                "input_sha256": hashlib.sha256(active.encode("utf-8")).hexdigest()}

        return _launch(request, "text-showcase", work)

    @app.post("/api/v4/jobs/showcase")
    async def showcase(request: Request, stego: UploadFile | None = File(None), cover: UploadFile | None = File(None),
                       mode: str = Form("test"), payload: UploadFile | None = File(None),
                       private_key: str = Form(""), key_password: str = Form(""), depth: int = Form(3),
                       conversion_settings: str = Form(""),
                       passphrase: str = Form(""), public_key: str = Form(...),
                       recovery: UploadFile | None = File(None), recovery_code: str = Form("")):
        _session(request)
        if mode not in {"test", "encode"}:
            raise HTTPException(400, "Unknown showcase mode")
        carrier = await _read(stego, "stego") if mode == "test" and stego and stego.filename else None
        original = await _read(cover, "original") if cover and cover.filename else None
        content = await _read(payload, "payload", MAX_CONTENT_BYTES) if payload and payload.filename else None
        video_source = carrier if carrier is not None else original or b""
        video = video_source[:4] == b"RIFF" and video_source[8:12] == b"AVI "
        sidecar = await _read(recovery, "Recovery", 8192) if recovery and recovery.filename else None
        if (not video and not passphrase) or not public_key or (
            mode == "test" and (carrier is None or video and (not sidecar or not recovery_code))
        ) or (mode == "encode" and (original is None or content is None or not private_key or not 1 <= depth <= 8)):
            raise HTTPException(400, "Required verification credentials are missing")
        if len(passphrase) > 1024 or len(public_key) > 32768 or len(private_key) > 32768 or len(key_password) > 1024:
            raise HTTPException(400, "Verification input is too long")
        if len(conversion_settings) > 4096:
            raise HTTPException(400, "Conversion settings are too long")
        try:
            conversion = json.loads(conversion_settings) if conversion_settings else None
            if conversion is not None and not isinstance(conversion, dict):
                raise ValueError
        except ValueError as exc:
            raise HTTPException(400, "Conversion settings must be an object") from exc

        def work(session, check):
            job = session.jobs[session.active_job]
            job.total_cases = 7 if video else 12 if original else 11
            job.phase = "baseline"

            started = time.monotonic()

            def completed(case):
                case.pop("file", None)
                case["elapsed_ms"] = round((time.monotonic() - started) * 1000)
                job.cases.append(case)
                job.progress = min(99, round(len(job.cases) / job.total_cases * 100))
                job.phase = case["title"]

            generated = None
            generated_recovery = None
            heatmap = None
            active = carrier
            active_sidecar, active_code = sidecar, recovery_code
            if mode == "encode":
                job.phase = "encoding"
                if video:
                    signer = load_signing_key(private_key.encode(), key_password.encode() if key_password else None)
                    product = protect_video(original, content, signer, metadata={
                        "filename": payload.filename, "media_type": payload.content_type or "application/octet-stream"}, depth=depth)
                    active, active_sidecar, active_code = product.carrier, product.sidecar, product.recovery_code
                else:
                    active, _, _ = engine.hide(original, cover.filename or "cover", content,
                        payload.filename, payload.content_type or "application/octet-stream", passphrase,
                        private_key.encode(), key_password.encode() or None, depth, "auto")
                check()
                ext = ".avi" if video else load_cover(active).extension
                ident = request.app.state.registry.artifact(session, active, "showcase_stego" + ext,
                    "video/x-msvideo" if video else "audio/wav" if ext == ".wav" else "image/png", "showcase")
                generated = {"id": ident, "filename": "showcase_stego" + ext, "size": len(active)}
                if video:
                    recovery_ident = request.app.state.registry.artifact(session, active_sidecar,
                        "recovery.stegloc", "application/octet-stream", "sidecar")
                    generated_recovery = {"id": recovery_ident, "filename": "recovery.stegloc", "size": len(active_sidecar)}
            if video:
                scenarios, files = _video_suite(active, active_sidecar, active_code, public_key.encode(), completed, check)
            else:
                scenarios, files = attacks.run_suite(active, passphrase, public_key.encode(), original,
                    on_case=completed, check=check, stop_on_failed_baseline=True, include_hash_mismatch=True)
            if original is not None and active is not None:
                heatmap_bytes = _comparison_heatmap(original, active, video)
                if heatmap_bytes:
                    heatmap_ident = request.app.state.registry.artifact(session, heatmap_bytes,
                        "embedding_heatmap.png", "image/png", "evidence")
                    heatmap = {"id": heatmap_ident, "filename": "embedding_heatmap.png", "size": len(heatmap_bytes)}
            stored = {}
            for key, (filename, sample_bytes) in files.items():
                check()
                ident = request.app.state.registry.artifact(session, sample_bytes, filename,
                    "video/x-msvideo" if filename.endswith(".avi") else "image/png" if filename.endswith(".png") else "audio/wav", "showcase")
                stored[key] = {"id": ident, "filename": filename, "size": len(sample_bytes)}
            for row in job.cases:
                row["file"] = stored.get(row["id"])
            return {"cases": job.cases, "elapsed_ms": round((time.monotonic() - started) * 1000),
                    "input_sha256": hashlib.sha256(active).hexdigest(), "generated": generated,
                    "generated_recovery": generated_recovery,
                    "recovery_code": active_code if mode == "encode" and video else None,
                    "heatmap": heatmap,
                    "conversion_settings": conversion,
                    "baseline_authentic": bool(scenarios and scenarios[0]["as_expected"])}

        return _launch(request, "showcase", work)

    @app.get("/api/v4/jobs/{ident}/evidence")
    def evidence(request: Request, ident: str):
        _, session = _session(request)
        job = session.jobs.get(ident)
        if not job:
            raise HTTPException(404, "Job not found")
        rows = list(job.cases)
        manifest = {}
        content = io.BytesIO()
        with zipfile.ZipFile(content, "w", zipfile.ZIP_DEFLATED) as bundle:
            def add(name, data):
                bundle.writestr(name, data)
                manifest[name] = hashlib.sha256(data).hexdigest()
            result = {"status": job.status, "completed": len(rows), "cases": rows,
                "input_sha256": job.result.get("input_sha256") if job.result else None,
                "conversion_settings": job.result.get("conversion_settings") if job.result else None}
            report = "<html><meta charset='utf-8'><title>Stegloc evidence</title><style>body{font:16px system-ui;max-width:900px;margin:auto;padding:2rem;background:#101a28;color:#eef5ff}article{border:1px solid #60738a;padding:1rem;margin:1rem 0;border-radius:12px}</style><h1>Stegloc test evidence</h1>"
            for row in rows:
                report += "<article><h2>" + html.escape(row["title"]) + "</h2><p>Expected: " + html.escape(", ".join(row["expected"])) + "; observed: " + html.escape(row["verdict"]) + "</p><p>" + html.escape(row["summary"]) + "</p></article>"
            add("report.html", (report + "</html>").encode("utf-8"))
            add("results.json", json.dumps(result, indent=2).encode("utf-8"))
            for row in rows:
                file = row.get("file")
                if not file:
                    continue
                artifact = session.artifacts.get(file["id"])
                if artifact:
                    name = "samples/" + row["id"] + (".avi" if artifact.filename.endswith(".avi") else ".png" if artifact.filename.endswith(".png") else ".wav")
                    data = artifact.data
                    add(name, data)
            if job.result:
                for field, name in (("generated", "samples/showcase_stego"), ("heatmap", "heatmaps/embedding.png")):
                    descriptor = job.result.get(field)
                    if descriptor and descriptor["id"] in session.artifacts:
                        artifact = session.artifacts[descriptor["id"]]
                        suffix = Path(artifact.filename).suffix if field == "generated" else ""
                        add(name + suffix, artifact.data)
            bundle.writestr("sha256-manifest.json", json.dumps(manifest, indent=2))
        return Response(content.getvalue(), media_type="application/zip", headers={
            "Content-Disposition": 'attachment; filename="stegloc-v4-evidence.zip"',
            "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


def _comparison_heatmap(original: bytes, active: bytes, video: bool) -> bytes | None:
    """One representative full-resolution max-channel difference map for the export."""
    try:
        if video:
            before, after = inspect_video(original), inspect_video(active)
            if (before.width, before.height) != (after.width, after.height):
                return None
            shape = (before.height, before.width, 3)
            length = before.width * before.height * 3
            a = np.frombuffer(before.slots()[:length], dtype=np.uint8).reshape(shape)
            b = np.frombuffer(after.slots()[:length], dtype=np.uint8).reshape(shape)
        else:
            a = np.asarray(Image.open(io.BytesIO(original)).convert("RGB"))
            b = np.asarray(Image.open(io.BytesIO(active)).convert("RGB"))
            if a.shape != b.shape:
                return None
        intensity = np.max(np.abs(a.astype(np.int16) - b.astype(np.int16)), axis=2)
        heat = np.zeros((*intensity.shape, 3), dtype=np.uint8)
        heat[:, :, 0] = np.clip(intensity * 64, 0, 255).astype(np.uint8)
        heat[:, :, 1] = np.clip(intensity * 16, 0, 255).astype(np.uint8)
        image = io.BytesIO()
        Image.fromarray(heat).save(image, format="PNG")
        return image.getvalue()
    except (ValueError, OSError):
        return None


def _damage_text_symbol(carrier: str, method: str) -> str:
    if method == "acrostic":
        return ("Z" if carrier[:1] != "Z" else "Y") + carrier[1:]
    if method == "zero-width":
        return carrier.replace("\u200b", "\u200c", 1) if "\u200b" in carrier else carrier.replace("\u200c", "\u200b", 1)
    match = re.search(r"[ \t](?=\r?$)", carrier, re.MULTILINE)
    if not match:
        raise ValueError("Whitespace carrier has no encoded symbol")
    return carrier[:match.start()] + ("\t" if match.group() == " " else " ") + carrier[match.end():]


def _change_visible_text(carrier: str, method: str) -> str:
    for index, char in enumerate(carrier):
        if char.isalpha() and (method != "acrostic" or index > 0 and carrier[index - 1] not in "\r\n"):
            return carrier[:index] + ("Q" if char != "Q" else "R") + carrier[index + 1:]
    raise ValueError("Carrier has no editable visible character")


def _video_suite(carrier: bytes, sidecar: bytes, code: str, public_pem: bytes, completed, check):
    key = load_verification_key(public_pem)
    rows, files = [], {}
    def case(ident, title, change, expected, verdict, summary, file=None):
        check()
        row = {"id": ident, "title": title, "change": change, "expected": expected,
               "verdict": verdict, "summary": summary, "as_expected": verdict in expected, "file": file}
        rows.append(row)
        completed(row)
    baseline = verify_video(carrier, sidecar, code, key)
    case("baseline", "Unmodified AVI", "none", ["Authentic"], baseline.overall.value,
         "All v2 verification stages passed" if baseline.overall.value == "Authentic" else "Baseline verification failed")
    if baseline.overall.value != "Authentic":
        return rows, files
    wrong_code = verify_video(carrier, sidecar, code + "-wrong", key)
    case("wrong_code", "Wrong recovery code", "changed recovery code", ["Cannot Verify"],
         wrong_code.overall.value, "Authenticated locator cannot be recovered")
    _, unrelated_pem = generate_signing_keys()
    other = load_verification_key(unrelated_pem)
    wrong_key = verify_video(carrier, sidecar, code, other)
    case("wrong_key", "Wrong public key", "unrelated Ed25519 key", ["Signature Invalid"],
         wrong_key.overall.value, "Locator or record signature cannot verify")
    adapter = inspect_video(carrier)
    secret = decode_recovery_code(code)
    salt, _, _, _ = _parse_sidecar(sidecar)
    locator = _decrypt_and_verify_locator(sidecar, derive_keys(secret, salt).locator, key)
    start = int(locator["start_slot"])
    wrong_slot = start + 1 if start + 1 < inspect_video(carrier).eligible_slots else start - 1
    try:
        at_wrong_slot = adapter.extract(int(locator["encoded_byte_length"]), int(locator["depth"]), wrong_slot)
        wrong_verdict = "Authentic" if hashlib.sha256(at_wrong_slot).hexdigest() == locator["encrypted_package_sha256"] else "Wrong Start Location"
    except (ValueError, IndexError):
        wrong_verdict = "Wrong Start Location"
    case("wrong_start", "Wrong start location", f"manual slot {wrong_slot}", ["Wrong Start Location"],
         wrong_verdict, "Baseline verification passed; manual slot differs from authenticated locator")
    corrected = verify_video(carrier, sidecar, code, key)
    case("corrected_start", "Corrected start location", f"retry at authenticated slot {start}", ["Authentic"],
         corrected.overall.value, "Same AVI verifies when the authenticated locator is used")
    changed = bytearray(adapter.slots())
    changed[0] ^= 1
    cover_flip = adapter.export_slots(changed)
    files["cover_flip"] = ("video_cover_flip.avi", cover_flip)
    damaged = verify_video(cover_flip, sidecar, code, key)
    case("cover_flip", "Carrier bit changed", "first frame pixel changed outside payload", ["Tampered"],
         damaged.overall.value, "Canonical carrier SHA-256 must reject the change", "cover_flip")
    changed = bytearray(adapter.slots())
    changed[start] ^= 1
    payload_flip = adapter.export_slots(changed)
    files["payload_flip"] = ("video_payload_flip.avi", payload_flip)
    damaged = verify_video(payload_flip, sidecar, code, key)
    case("payload_flip", "Payload bit changed", "embedded package bit changed", ["Tampered"],
         damaged.overall.value, "Encrypted package digest must reject the change", "payload_flip")
    return rows, files
