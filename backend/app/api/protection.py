"""Protection HTTP endpoints."""
from pathlib import Path
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool
from ..stego import engine
from ..stego.covers import CoverError, load_cover
from .common import EstimateRequest, _read, _optional_int, _optional_float, _bad_request, _looks_like_text
TEXT_PREVIEW_BYTES = 200_000

def attach(app: FastAPI, store) -> None:
    @app.post("/api/inspect")
    async def inspect(file: UploadFile = File(...)):
        data = await _read(file, "Cover")

        def work():
            cover = load_cover(data)
            info = cover.info()
            info["file_size"] = len(data)
            info["header"] = cover.location(max(engine.header_slot(cover.n_slots), 0))
            info["capacity"] = [{"n_lsb": n, "max_package_bytes": max(0, engine.max_package_bytes(cover.n_slots, n))}
                                for n in range(1, 9)]
            return info
        try:
            return await run_in_threadpool(work)
        except CoverError as exc:
            raise _bad_request(exc)

    @app.post("/api/estimate")
    def estimate(body: EstimateRequest):
        try:
            size = engine.estimate_package_bytes(body.cover_kind, body.descriptor, body.cover_filename,
                                                 body.payload_filename, body.payload_type, body.payload_size,
                                                 body.team, body.key_bits)
        except ValueError as exc:
            raise _bad_request(exc)
        return {"package_bytes": size}

    # ---------------------------------------------------------------- hide --
    @app.post("/api/hide")
    async def hide(cover: UploadFile = File(...), payload_file: UploadFile | None = File(None),
                   payload_text: str | None = Form(None), passphrase: str = Form(...),
                   private_key: str = Form(...), key_password: str | None = Form(None),
                   n_lsb: int = Form(1), start_mode: str = Form("auto"), start_x: str | None = Form(None),
                   start_y: str | None = Form(None), start_seconds: str | None = Form(None),
                   start_slot: str | None = Form(None), team: str = Form("")):
        cover_data = await _read(cover, "Cover")
        if payload_file is not None and payload_file.filename:
            content = await _read(payload_file, "Payload")
            payload_name = payload_file.filename
            payload_type = payload_file.content_type or "application/octet-stream"
        elif payload_text:
            content = payload_text.encode("utf-8")
            payload_name, payload_type = "message.txt", "text/plain; charset=utf-8"
        else:
            raise HTTPException(400, "Add a secret message or choose a payload file.")
        manual = dict(start_x=_optional_int(start_x, "Start X"), start_y=_optional_int(start_y, "Start Y"),
                      start_seconds=_optional_float(start_seconds, "Start time"),
                      start_slot=_optional_int(start_slot, "Start slot"))

        def work():
            return engine.hide(cover_data, cover.filename or "cover", content, payload_name, payload_type,
                               passphrase, private_key.encode(), (key_password or "").encode() or None, n_lsb,
                               start_mode, team=team, **manual)
        try:
            stego, cover_obj, report = await run_in_threadpool(work)
        except ValueError as exc:  # CoverError, CapacityError, StartLocationError, KeyFormatError
            raise _bad_request(exc)
        stem = Path(cover.filename or "cover").stem or "cover"
        saved = store.put(stego, f"stego_{stem}{cover_obj.extension}", cover_obj.mime)
        return {"stego": saved, "report": report}

    # -------------------------------------------------------------- verify --
    @app.post("/api/verify")
    async def verify(stego: UploadFile = File(...), passphrase: str = Form(""), public_key: str = Form(""),
                     start_x: str | None = Form(None), start_y: str | None = Form(None),
                     start_seconds: str | None = Form(None), start_slot: str | None = Form(None)):
        data = await _read(stego, "Stego file")
        manual = dict(start_x=_optional_int(start_x, "Start X"), start_y=_optional_int(start_y, "Start Y"),
                      start_seconds=_optional_float(start_seconds, "Start time"),
                      start_slot=_optional_int(start_slot, "Start slot"))
        result = await run_in_threadpool(engine.verify, data, passphrase, public_key.encode(), **manual)
        content = result.pop("content")
        result["content"] = None
        if content is not None and result["record"]:
            payload = result["record"]["payload"]
            saved = store.put(content, Path(str(payload.get("filename") or "payload.bin")).name,
                              str(payload.get("media_type") or "application/octet-stream"))
            if _looks_like_text(content):
                saved["text"] = content[:TEXT_PREVIEW_BYTES].decode("utf-8", errors="replace")
                saved["text_truncated"] = len(content) > TEXT_PREVIEW_BYTES
            result["content"] = saved
        return result

    # ------------------------------------------------------------ analysis --
