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
from ..stego import signed_text
from ..stego.covers import load_cover
from ..stego.carriers.video import inspect_video
from ..stego.carriers.video_mp4 import inspect_mp4, is_mp4, extension as mp4_extension
from ..stego.recovery_security import (load_verification_key, generate_signing_keys, decode_recovery_code,
    derive_keys, _parse_sidecar, _decrypt_and_verify_locator)
from ..workflows import verify_video
from .session_jobs import _launch, _read, _session


def attach(app: FastAPI) -> None:
    @app.post("/api/jobs/text-tamper-tests")
    async def text_showcase(request: Request, mode: str = Form("test"), carrier: UploadFile | None = File(None),
                            recovery: UploadFile | None = File(None), recovery_code: str = Form(""),
                            public_key: str = Form(...)):
        _session(request)
        if mode != "test":
            raise HTTPException(400, "Unknown showcase mode")
        text_bytes = await _read(carrier, "text carrier", signed_text.MAX_CARRIER) if carrier and carrier.filename else None
        sidecar = await _read(recovery, "text recovery", 4096) if recovery and recovery.filename else None
        if not public_key or text_bytes is None or sidecar is None or not recovery_code:
            raise HTTPException(400, "Required text verification material is missing")
        if len(public_key) > 32768:
            raise HTTPException(400, "Key input is too long")
        try:
            text = text_bytes.decode("utf-8")
            key = load_verification_key(public_key.encode())
        except (UnicodeError, ValueError) as exc:
            raise HTTPException(400, str(exc)) from exc

        def work(session, check):
            job = session.jobs[session.active_job]
            job.total_cases = 5
            job.phase = "baseline"
            started = time.monotonic()
            active, material, code = text, sidecar, recovery_code
            rows = []
            def case(ident, title, change, expected, candidate, use_code=code, use_key=key):
                check()
                try:
                    verdict = signed_text.verify(candidate, material, use_code, use_key)["verdict"]
                except ValueError:
                    verdict = "Cannot Verify"
                row = {"id": ident, "title": title, "change": change, "expected": expected,
                    "verdict": verdict, "summary": "text authentication and signature checks", "as_expected": verdict in expected,
                    "elapsed_ms": round((time.monotonic() - started) * 1000), "file": None}
                rows.append(row); job.cases.append(row); job.phase = title
                job.progress = min(99, round(len(rows) / job.total_cases * 100))
            case("baseline", "Unmodified text", "none", ["Authentic"], active)
            if rows[0]["verdict"] != "Authentic":
                return {"cases": rows, "baseline_authentic": False}
            case("wrong_code", "Wrong recovery code", "invalid code", ["Cannot Verify"], active, code + "-wrong")
            _, unrelated = generate_signing_keys()
            case("wrong_key", "Wrong public key", "unrelated Ed25519 key", ["Cannot Verify"], active,
                 use_key=load_verification_key(unrelated))
            damaged = _damage_text_symbol(active, json.loads(material)["method"])
            case("symbol_damage", "Hidden symbol damaged", "one encoded symbol changed", ["Cannot Verify"], damaged)
            visible_edit = _change_visible_text(active, json.loads(material)["method"])
            case("visible_wording", "Visible wording edited", "one visible character changed", ["Authentic"], visible_edit)
            return {"cases": rows, "baseline_authentic": True,
                "input_sha256": hashlib.sha256(active.encode("utf-8")).hexdigest()}

        return _launch(request, "text-showcase", work)

    @app.post("/api/jobs/tamper-tests")
    async def showcase(request: Request, stego: UploadFile | None = File(None), cover: UploadFile | None = File(None),
                       mode: str = Form("test"),
                       conversion_settings: str = Form(""),
                       passphrase: str = Form(""), public_key: str = Form(...),
                       recovery: UploadFile | None = File(None), recovery_code: str = Form("")):
        _session(request)
        if mode != "test":
            raise HTTPException(400, "Unknown showcase mode")
        carrier = await _read(stego, "stego") if stego and stego.filename else None
        original = await _read(cover, "original") if cover and cover.filename else None
        video = carrier is not None and ((carrier[:4] == b"RIFF" and carrier[8:12] == b"AVI ") or is_mp4(carrier))
        sidecar = await _read(recovery, "Recovery", 8192) if recovery and recovery.filename else None
        if (not video and not passphrase) or not public_key or carrier is None or video and (not sidecar or not recovery_code):
            raise HTTPException(400, "Required verification credentials are missing")
        if len(passphrase) > 1024 or len(public_key) > 32768:
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
            # ponytail: retain inputs for this session's export; use temp files if large media strains memory.
            job.evidence = {"files": [("protected", stego.filename, carrier)]
                + ([("original", cover.filename, original)] if original is not None else [])
                + ([("recovery", recovery.filename, sidecar)] if sidecar is not None else []),
                "public_key": public_key, "passphrase": passphrase if not video else None,
                "recovery_code": recovery_code if video else None}
            dct = not video and engine.detect_method(load_cover(carrier)) == "dct"
            if video:
                job.total_cases = 4
            elif dct:
                job.total_cases = 8 if original else 7
            else:
                job.total_cases = 9 if original else 8
            job.phase = "baseline"

            started = time.monotonic()

            def completed(case):
                case.pop("file", None)
                case["elapsed_ms"] = round((time.monotonic() - started) * 1000)
                job.cases.append(case)
                job.progress = min(99, round(len(job.cases) / job.total_cases * 100))
                job.phase = case["title"]

            heatmap = None
            active = carrier
            active_sidecar, active_code = sidecar, recovery_code
            if video:
                scenarios, files = _video_suite(active, active_sidecar, active_code, public_key.encode(), completed, check)
            else:
                scenarios, files = attacks.run_suite(active, passphrase, public_key.encode(), original,
                    on_case=completed, check=check, stop_on_failed_baseline=True, include_hash_mismatch=True)
            job.total_cases = len(job.cases)
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
                    {".avi": "video/x-msvideo", ".mov": "video/quicktime", ".mp4": "video/mp4",
                     ".m4v": "video/x-m4v", ".3gp": "video/3gpp", ".mkv": "video/x-matroska",
                     ".webm": "video/webm", ".flv": "video/x-flv", ".wmv": "video/x-ms-wmv",
                     ".png": "image/png", ".wav": "audio/wav"}.get(Path(filename).suffix.lower(), "application/octet-stream"), "showcase")
                stored[key] = {"id": ident, "filename": filename, "size": len(sample_bytes)}
            for row in job.cases:
                row["file"] = stored.get(row["id"])
            return {"cases": job.cases, "elapsed_ms": round((time.monotonic() - started) * 1000),
                    "input_sha256": hashlib.sha256(active).hexdigest(),
                    "heatmap": heatmap,
                    "conversion_settings": conversion,
                    "baseline_authentic": bool(scenarios and scenarios[0]["as_expected"])}

        return _launch(request, "showcase", work)

    @app.get("/api/jobs/{ident}/evidence")
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
            inputs = job.evidence or {}
            archived_inputs = {}
            for role, filename, data in inputs.get("files", []):
                suffix = Path(filename or "").suffix.lower()
                if not re.fullmatch(r"\.[a-z0-9-]{1,16}", suffix):
                    suffix = ".bin"
                name = f"inputs/{role}{suffix}"
                add(name, data)
                archived_inputs[role] = {"path": name, "filename": filename, "size": len(data),
                    "sha256": manifest[name]}
            public_key = inputs.get("public_key")
            if public_key is not None:
                add("keys/public_key.pem", public_key.encode("utf-8"))
            passphrase = inputs.get("passphrase")
            if passphrase is not None:
                add("credentials/passphrase.txt", passphrase.encode("utf-8"))
            recovery_code = inputs.get("recovery_code")
            if recovery_code is not None:
                add("credentials/recovery-code.txt", recovery_code.encode("utf-8"))
            tampered = {}
            for row in rows:
                file = row.get("file")
                if not file:
                    continue
                artifact = session.artifacts.get(file["id"])
                if artifact:
                    name = "tampered/" + row["id"] + Path(artifact.filename).suffix
                    add(name, artifact.data)
                    tampered[row["id"]] = name
            heatmap_included = False
            if job.result:
                descriptor = job.result.get("heatmap")
                if descriptor and descriptor["id"] in session.artifacts:
                    add("heatmaps/embedding.png", session.artifacts[descriptor["id"]].data)
                    heatmap_included = True
            result = {"status": job.status, "completed": len(rows), "cases": rows,
                "input_sha256": job.result.get("input_sha256") if job.result else None,
                "conversion_settings": job.result.get("conversion_settings") if job.result else None,
                "inputs": archived_inputs, "tampered_files": tampered}
            completed = len(rows)
            total = job.total_cases or completed
            matched = sum(row.get("as_expected") is True for row in rows)
            baseline = next((row for row in rows if row.get("id") == "baseline"), None)
            baseline_authentic = bool(baseline and baseline.get("verdict") == "Authentic")
            metrics = (
                ("Cases completed", f"{completed}/{total}", round(100 * completed / total) if total else 0,
                    "Tests with a recorded verdict"),
                ("Expected outcomes", f"{matched}/{completed}", round(100 * matched / completed) if completed else 0,
                    "Observed verdicts matching the test plan"),
                ("Unchanged baseline", baseline.get("verdict", "Not run") if baseline else "Not run",
                    100 if baseline_authentic else 0, "Authenticity of the protected file"),
            )
            report = ["""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Stegloc test evidence</title><style>
:root{font:16px/1.5 Arial,Helvetica,sans-serif;color:#26332b;background:#ecefec}
*{box-sizing:border-box}body{margin:0}.report{max-width:1060px;margin:auto;padding:28px}
.masthead{padding:10px 4px 18px}.kicker{margin:0 0 4px;color:#467b2d;font-size:.76rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase}
h1{margin:0;font-size:clamp(1.7rem,3vw,2.4rem);line-height:1.15}h2{margin:0;font-size:1.18rem}h3{margin:0;font-size:1rem}
.lede,.muted{color:#526258}.lede{margin:8px 0 0}.surface{margin-top:14px;padding:24px;background:#fff;border:1px solid #e0e5e0}
.section-head{display:flex;justify-content:space-between;align-items:baseline;gap:16px;margin-bottom:20px}.section-head p{margin:0;color:#526258;font-size:.88rem}
.metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.metric{text-align:center}.metric-label{display:block;min-height:2.5em;color:#526258;font-size:.85rem}
.ring{--tone:#4c922a;width:132px;height:132px;margin:10px auto;border-radius:50%;display:grid;place-items:center;background:conic-gradient(var(--tone) var(--pct),#e7eae7 0)}
.ring-inner{width:114px;height:114px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#fff}
.ring strong{font-size:1.5rem;line-height:1.1}.ring .word{font-size:1rem;overflow-wrap:anywhere}.metric small{display:block;color:#526258;font-size:.78rem}
.notice{margin:22px 0 0;padding:12px 14px;background:#f4f7ee;color:#344936}
.table-scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;text-align:left;font-size:.88rem}th{color:#526258;font-size:.75rem;text-transform:uppercase;letter-spacing:.05em}th,td{padding:12px 10px;border-bottom:1px solid #e5e9e5;vertical-align:top}tbody tr:last-child td{border-bottom:0}
.match{color:#28701e;font-weight:700}.review{color:#aa362b;font-weight:700}.verdict{font-weight:700}
.file-list{list-style:none;margin:0;padding:0}.file-list li{display:grid;grid-template-columns:110px minmax(0,1fr);gap:4px 16px;padding:14px 0;border-bottom:1px solid #e5e9e5}.file-list li:last-child{border-bottom:0}
.file-list strong{color:#526258}.file-list code,.case code{overflow-wrap:anywhere}audio{display:block;max-width:100%;margin-top:8px}
a{color:#176a32;text-underline-offset:3px}a:hover{color:#0e4b23}a:focus-visible{outline:2px solid #176a32;outline-offset:3px}
.steps{padding-left:1.4rem}.steps li{padding:4px 0 4px 5px}.credential{margin-top:18px}.credential pre{margin:8px 0 0;padding:14px;background:#f3f5f3;border:1px solid #e0e5e0}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.82rem}.case{padding:18px 0;border-top:1px solid #e5e9e5}.case:first-of-type{border-top:0;padding-top:0}
.case-head{display:flex;justify-content:space-between;gap:12px;align-items:baseline}.case p{margin:8px 0 0}.case ol{margin:8px 0 0;padding-left:1.3rem;color:#526258}.case li{padding:2px 0}
.heatmap{display:block;max-width:100%;height:auto;margin-top:14px;border:1px solid #e0e5e0}.foot{margin:20px 4px 0;color:#526258;font-size:.78rem}
@media(max-width:640px){.report{padding:12px}.surface{padding:18px}.metrics{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}.file-list li{grid-template-columns:1fr}.section-head{display:block}.section-head p{margin-top:4px}}
@media print{body{background:#fff}.report{max-width:none;padding:0}.surface{break-inside:auto;border-color:#cbd3cb}.case{break-inside:avoid}.ring{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><main class="report"><header class="masthead"><p class="kicker">Stegloc · verification evidence</p>
<h1>Tamper test report</h1><p class="lede">Actual checks, supplied inputs, and steps to reproduce each result.</p></header>
<section class="surface" aria-labelledby="summary-title"><div class="section-head"><h2 id="summary-title">Summary</h2></div><div class="metrics">"""]
            for label, value, percent, description in metrics:
                tone = "#89988a" if value == "Not run" else "#4c922a" if percent == 100 else "#c87b16" if percent else "#b33c31"
                report.append(f'<div class="metric" role="group" aria-label="{html.escape(f"{label}: {value}; {percent} percent", quote=True)}">'
                    f'<span class="metric-label">{html.escape(label)}</span>'
                    f'<div class="ring" style="--pct:{percent}%;--tone:{tone}" aria-hidden="true">'
                    f'<span class="ring-inner"><strong class="{"word" if len(value) > 6 else ""}">{html.escape(value)}</strong>'
                    f'<small>{percent}%</small></span></div><small>{html.escape(description)}</small></div>')
            report.append('</div><p class="notice"><strong>Archive contents:</strong> Supplied media, public key, and verification credentials are included with this report.</p></section>')
            report.append('<section class="surface" aria-labelledby="outcomes-title"><div class="section-head"><h2 id="outcomes-title">Test outcomes</h2>'
                '<p>Expected and observed verdicts</p></div><div class="table-scroll"><table><thead><tr><th scope="col">Test</th>'
                '<th scope="col">Expected</th><th scope="col">Observed</th><th scope="col">Result</th></tr></thead><tbody>')
            for row in rows:
                status = "As expected" if row.get("as_expected") else "Review"
                report.append(f'<tr><th scope="row">{html.escape(row["title"])}</th>'
                    f'<td>{html.escape(", ".join(row["expected"]))}</td>'
                    f'<td class="verdict">{html.escape(row["verdict"])}</td>'
                    f'<td class="{"match" if row.get("as_expected") else "review"}">{status}</td></tr>')
            report.append('</tbody></table></div></section>')
            if inputs:
                report.append('<section class="surface" aria-labelledby="files-title"><div class="section-head"><h2 id="files-title">Files used</h2>'
                    '<p>Original inputs for the test suite</p></div><ul class="file-list">')
                for role, item in archived_inputs.items():
                    path = html.escape(item["path"], quote=True)
                    report.append(f'<li><strong>{html.escape(role.title())}</strong><div><a href="{path}">{html.escape(item["filename"] or item["path"])}</a> '
                        f'({item["size"]:,} bytes)<br><small>SHA-256 <code>{item["sha256"]}</code></small>')
                    if path.endswith(".wav"):
                        report.append(f'<audio controls src="{path}"></audio>')
                    report.append('</div></li>')
                report.append("</ul>")
                if "original" not in archived_inputs:
                    report.append("<p>Original cover was not supplied; the clean-cover case could not run.</p>")
                report.append('</section><section class="surface" aria-labelledby="credentials-title">'
                    '<div class="section-head"><h2 id="credentials-title">Verification materials</h2></div>')
                if public_key is not None:
                    report.append('<div class="credential"><h3>Public key used</h3><p><a href="keys/public_key.pem">Download public_key.pem</a></p>'
                        f'<pre>{html.escape(public_key)}</pre>')
                    report.append('</div>')
                if passphrase is not None:
                    report.append('<div class="credential"><h3>Passphrase used</h3><p><a href="credentials/passphrase.txt">Download passphrase.txt</a></p>'
                        f'<pre>{html.escape(passphrase)}</pre>')
                    report.append('</div>')
                if recovery_code is not None:
                    report.append('<div class="credential"><h3>Recovery code used</h3><p><a href="credentials/recovery-code.txt">Download recovery-code.txt</a></p>'
                        f'<pre>{html.escape(recovery_code)}</pre>')
                    report.append('</div>')
                report.append('</section><section class="surface" aria-labelledby="reproduce-title"><div class="section-head">'
                    '<h2 id="reproduce-title">Reproduce verification</h2></div><ol class="steps"><li>Extract this ZIP so its file links work.</li>'
                    '<li>Open Stegloc, then Extract &amp; Verify. Load the protected file listed above.</li>')
                if "recovery" in archived_inputs:
                    report.append('<li>Load the recovery file and enter the recovery code shown above.</li>')
                if passphrase is not None:
                    report.append('<li>Enter the passphrase shown above.</li>')
                report.append('<li>Load the public key shown above and verify. The unchanged baseline should be Authentic.</li>'
                    '<li>Repeat with each file or credential change listed below. Compare the observed verdict and checks.</li></ol></section>')
            if heatmap_included:
                report.append('<section class="surface" aria-labelledby="heatmap-title"><div class="section-head">'
                    '<h2 id="heatmap-title">Embedding heatmap</h2></div><p class="muted">Pixel differences between the original and protected image.</p>'
                    '<img class="heatmap" src="heatmaps/embedding.png" alt="Difference heatmap for original and protected image"></section>')
            report.append('<section class="surface" aria-labelledby="cases-title"><div class="section-head">'
                '<h2 id="cases-title">Cases and exact changes</h2><p>Details behind each verdict</p></div>')
            for row in rows:
                status = "As expected" if row.get("as_expected") else "Review"
                report.append('<article class="case"><div class="case-head"><h3>' + html.escape(row["title"]) + '</h3>'
                    f'<strong class="{"match" if row.get("as_expected") else "review"}">{status}</strong></div><p><strong>Change applied:</strong> '
                    + html.escape(row.get("change") or "none") + "</p>")
                source = tampered.get(row["id"])
                if source:
                    report.append(f'<p>Verify <a href="{html.escape(source, quote=True)}">{html.escape(source)}</a> with the recorded credentials.</p>')
                elif row["id"] == "clean_cover" and "original" in archived_inputs:
                    report.append(f'<p>Verify {html.escape(archived_inputs["original"]["path"])} with the recorded credentials.</p>')
                elif row["id"] == "wrong_key" and "protected" in archived_inputs:
                    report.append('<p>Verify the protected file with a freshly generated, unrelated public key.</p>')
                elif row["id"] == "baseline" and "protected" in archived_inputs:
                    report.append('<p>Verify the protected file with the recorded credentials.</p>')
                report.append("<p>Expected: " + html.escape(", ".join(row["expected"])) + "; observed: "
                    + html.escape(row["verdict"]) + "</p><p>" + html.escape(row["summary"]) + "</p>")
                if row.get("stages"):
                    report.append("<p>Verification checks:</p><ol>" + "".join(
                        "<li>" + html.escape(stage["id"]) + ": " + html.escape(stage["status"]) + "</li>"
                        for stage in row["stages"]) + "</ol>")
                if row.get("payload_hash"):
                    digest = row["payload_hash"]
                    report.append("<p>Payload SHA-256: " + html.escape(str(digest.get("status")))
                        + "; expected " + html.escape(str(digest.get("expected")))
                        + "; computed " + html.escape(str(digest.get("computed"))) + "</p>")
                report.append("</article>")
            report.append('</section><p class="foot">Stegloc evidence archive · File hashes are also listed in sha256-manifest.json.</p></main></body></html>')
            add("report.html", "".join(report).encode("utf-8"))
            add("results.json", json.dumps(result, indent=2).encode("utf-8"))
            bundle.writestr("sha256-manifest.json", json.dumps(manifest, indent=2))
        return Response(content.getvalue(), media_type="application/zip", headers={
            "Content-Disposition": 'attachment; filename="stegloc-evidence.zip"',
            "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


def _comparison_heatmap(original: bytes, active: bytes, video: bool) -> bytes | None:
    """One representative full-resolution max-channel difference map for the export."""
    try:
        if video:
            before = inspect_mp4(original) if is_mp4(original) else inspect_video(original)
            after = inspect_mp4(active) if is_mp4(active) else inspect_video(active)
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
    case("baseline", "Unmodified video", "none", ["Authentic"], baseline.overall.value,
         "All media verification stages passed" if baseline.overall.value == "Authentic" else "Baseline verification failed")
    if baseline.overall.value != "Authentic":
        return rows, files
    _, unrelated_pem = generate_signing_keys()
    other = load_verification_key(unrelated_pem)
    wrong_key = verify_video(carrier, sidecar, code, other)
    case("wrong_key", "Wrong public key", "unrelated Ed25519 key", ["Signature Invalid"],
         wrong_key.overall.value, "Locator or record signature cannot verify")
    adapter = inspect_mp4(carrier) if is_mp4(carrier) else inspect_video(carrier)
    suffix = mp4_extension(carrier) if is_mp4(carrier) else ".avi"
    secret = decode_recovery_code(code)
    salt, _, _, _ = _parse_sidecar(sidecar)
    locator = _decrypt_and_verify_locator(sidecar, derive_keys(secret, salt).locator, key)
    start = int(locator["start_slot"])
    changed = bytearray(adapter.slots())
    changed[0] ^= 1
    cover_flip = adapter.export_slots(changed)
    files["cover_flip"] = ("video_cover_flip" + suffix, cover_flip)
    damaged = verify_video(cover_flip, sidecar, code, key)
    case("cover_flip", "Carrier bit changed", "first frame pixel changed outside payload", ["Tampered"],
         damaged.overall.value, "Canonical carrier SHA-256 must reject the change", "cover_flip")
    changed = bytearray(adapter.slots())
    changed[start] ^= 1
    payload_flip = adapter.export_slots(changed)
    files["payload_flip"] = ("video_payload_flip" + suffix, payload_flip)
    damaged = verify_video(payload_flip, sidecar, code, key)
    case("payload_flip", "Payload bit changed", "embedded package bit changed", ["Tampered"],
         damaged.overall.value, "Encrypted package digest must reject the change", "payload_flip")
    return rows, files
