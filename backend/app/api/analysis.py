"""Analysis HTTP endpoints."""
from fastapi import FastAPI, File, Form, UploadFile
from starlette.concurrency import run_in_threadpool
from ..stego import analysis, attacks
from ..stego.analysis.bpcs import BPCSConfig
from ..stego.covers import load_cover
from .common import _read, _bad_request

def attach(app: FastAPI, store) -> None:
    @app.post("/api/analyse")
    async def analyse(file: UploadFile = File(...), compare: UploadFile | None = File(None), channel: int = Form(0),
                      bpcs_channel: str | None = Form(None), bpcs_block_size: str | None = Form(None),
                      bpcs_bit_plane_start: str | None = Form(None),
                      bpcs_bit_plane_end: str | None = Form(None),
                      bpcs_complexity_threshold: str | None = Form(None),
                      bpcs_first_plane: str | None = Form(None), bpcs_last_plane: str | None = Form(None),
                      bpcs_threshold: str | None = Form(None)):
        data = await _read(file, "File")
        other = await _read(compare, "Comparison file") if compare is not None and compare.filename else None
        try:
            config = BPCSConfig.from_values(bpcs_channel, bpcs_block_size,
                                            bpcs_bit_plane_start if bpcs_bit_plane_start is not None else bpcs_first_plane,
                                            bpcs_bit_plane_end if bpcs_bit_plane_end is not None else bpcs_last_plane,
                                            bpcs_complexity_threshold if bpcs_complexity_threshold is not None else bpcs_threshold)
            return await run_in_threadpool(analysis.analyse, data, other, channel, config)
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
