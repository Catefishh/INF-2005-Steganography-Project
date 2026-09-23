"""Analysis HTTP endpoints."""
from fastapi import FastAPI, File, Form, UploadFile
from starlette.concurrency import run_in_threadpool
from ..stego import analysis, attacks
from ..stego.covers import load_cover
from .common import _read, _bad_request

def attach(app: FastAPI, store) -> None:
    @app.post("/api/analyse")
    async def analyse(file: UploadFile = File(...), compare: UploadFile | None = File(None), channel: int = Form(0),
                      bpcs_block_size: int = Form(16), bpcs_first_plane: int = Form(0),
                      bpcs_last_plane: int = Form(3), bpcs_threshold: float = Form(0.3)):
        data = await _read(file, "File")
        other = await _read(compare, "Comparison file") if compare is not None and compare.filename else None
        try:
            return await run_in_threadpool(analysis.analyse, data, other, channel,
                                           bpcs_block_size, bpcs_first_plane, bpcs_last_plane, bpcs_threshold)
        except ValueError as exc:
            raise _bad_request(exc)

    @app.post("/api/attacks")
    async def attack_suite(stego: UploadFile = File(...), cover: UploadFile | None = File(None),
                           passphrase: str = Form(...), public_key: str = Form(...)):
        data = await _read(stego, "Stego file")
        original = await _read(cover, "Cover") if cover is not None and cover.filename else None
        try:
            scenarios, files = await run_in_threadpool(attacks.run_suite, data, passphrase, public_key.encode(),
                                                       original)
        except ValueError as exc:
            raise _bad_request(exc)
        media = load_cover(data).mime
        saved = {key: store.put(content, name, "image/png" if name.endswith(".png") else media)
                 for key, (name, content) in files.items()}
        for scenario in scenarios:
            scenario["file"] = saved.get(scenario["file"]) if scenario["file"] else None
        return {"scenarios": scenarios}

