"""Explicit, bounded conversion of compressed covers to LSB-compatible media."""
from __future__ import annotations

import json
import math
import os
import shutil
import struct
import subprocess
import sys
import time
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from ..stego.carriers.video import MAX_AVI_BYTES, inspect_video
from ..stego.covers import load_cover
from ..cancellation import check as cancel_check
from ..stego.analysis_parts.common import png_data_url
import numpy as np
from .common import _read


def _binary(name: str) -> str:
    bundled = Path(getattr(sys, "_MEIPASS", "")) / "ffmpeg" / (name + (".exe" if os.name == "nt" else ""))
    source_build = Path(__file__).parents[3] / "build" / "ffmpeg" / (name + (".exe" if os.name == "nt" else ""))
    found = str(bundled) if bundled.is_file() else str(source_build) if source_build.is_file() else shutil.which(name)
    if not found:
        raise ValueError(f"{name} is unavailable. Install FFmpeg to prepare MP3, MP4 or MOV covers.")
    return found


def _run(command: list[str], timeout: int = 45) -> bytes:
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                               creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    deadline = time.monotonic() + timeout
    try:
        while True:
            cancel_check()
            try:
                output, _ = process.communicate(timeout=0.25)
                break
            except subprocess.TimeoutExpired:
                if time.monotonic() >= deadline:
                    raise ValueError("Media preparation timed out.")
        if process.returncode:
            raise ValueError("Media could not be decoded into a supported lossless cover.")
        return output
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=5)


def _chunk(name: bytes, body: bytes) -> bytes:
    return name + struct.pack("<I", len(body)) + body + (b"\0" if len(body) & 1 else b"")


def _avi(raw: bytes, width: int, height: int, fps: int) -> bytes:
    stride = (width * 3 + 3) & ~3
    frame_size = stride * height
    if frame_size == 0 or len(raw) % (width * height * 3):
        raise ValueError("Decoded video frames are incomplete.")
    frames = len(raw) // (width * height * 3)
    if not frames:
        raise ValueError("The selected video segment contains no frames.")
    avih = struct.pack("<14I", 1_000_000 // fps, 0, 0, 0, frames, 0, 1, frame_size, width, height, 0, 0, 0, 0)
    strh = bytearray(56)
    strh[:8] = b"vidsDIB "
    struct.pack_into("<III", strh, 20, 1, fps, 0)
    struct.pack_into("<I", strh, 32, frames)
    strf = struct.pack("<IiiHHIIiiII", 40, width, height, 1, 24, 0, frame_size, 0, 0, 0, 0)
    header = _chunk(b"avih", avih) + _chunk(b"LIST", b"strl" + _chunk(b"strh", bytes(strh)) + _chunk(b"strf", strf))
    movi = bytearray()
    index = bytearray()
    row_size = width * 3
    for frame in range(frames):
        pixels = raw[frame * width * height * 3:(frame + 1) * width * height * 3]
        rows = []
        for y in range(height - 1, -1, -1):
            row = pixels[y * row_size:(y + 1) * row_size]
            rows.append(row + b"\0" * (stride - row_size))
        body = b"".join(rows)
        movi.extend(_chunk(b"00db", body))
        index.extend(struct.pack("<4sIII", b"00db", 0x10, 0, len(body)))
    result = _chunk(b"RIFF", b"AVI " + _chunk(b"LIST", b"hdrl" + header) +
                    _chunk(b"LIST", b"movi" + bytes(movi)) + _chunk(b"idx1", bytes(index)))
    if len(result) > MAX_AVI_BYTES:
        raise ValueError("Prepared AVI exceeds the 64 MiB video limit. Select a shorter segment or smaller dimensions.")
    inspect_video(result)
    return result


def _probe(path: Path) -> dict:
    data = _run([_binary("ffprobe"), "-v", "error", "-show_format", "-show_streams", "-of", "json", str(path)], 20)
    try:
        return json.loads(data)
    except (ValueError, UnicodeError) as exc:
        raise ValueError("Cannot identify this media file.") from exc


def _source(data: bytes, name: str, work):
    with TemporaryDirectory() as folder:
        source = Path(folder) / ("source" + Path(name).suffix.lower())
        source.write_bytes(data)
        return work(source, _probe(source), Path(folder))


def _kind(info: dict) -> str:
    streams = info.get("streams", [])
    if any(s.get("codec_type") == "video" for s in streams):
        return "video"
    if any(s.get("codec_type") == "audio" for s in streams):
        return "audio"
    raise ValueError("No supported audio or video stream was found.")


def _dimensions(info: dict, max_width: int, max_height: int) -> tuple[int, int]:
    stream = next(s for s in info["streams"] if s.get("codec_type") == "video")
    width, height = int(stream["width"]), int(stream["height"])
    ratio = min(1.0, max_width / width, max_height / height)
    return max(2, math.floor(width * ratio / 2) * 2), max(2, math.floor(height * ratio / 2) * 2)


def attach(app: FastAPI, store) -> None:
    @app.post("/api/v4/video/compare")
    async def compare_video(file: UploadFile = File(...), reference: UploadFile | None = File(None), frame: int = Form(0)):
        data = await _read(file, "Video")
        original = await _read(reference, "Original video") if reference and reference.filename else None
        try:
            def work():
                video = inspect_video(data)
                if not 0 <= frame < video.frame_count:
                    raise ValueError("Frame is out of range")
                def pixels(adapter, index):
                    begin = index * adapter.width * adapter.height * 3
                    end = begin + adapter.width * adapter.height * 3
                    return np.frombuffer(adapter.slots()[begin:end], dtype=np.uint8).reshape(adapter.height, adapter.width, 3)[:, :, ::-1]
                stride = max(1, math.ceil(max(video.width, video.height) / 512))
                current = pixels(video, frame)
                result = {"width": video.width, "height": video.height, "frame_count": video.frame_count,
                    "fps": video.rate / video.scale, "frame": frame,
                    "stego_preview": png_data_url(current[::stride, ::stride].copy()),
                    "original_preview": None, "heatmap": None, "timeline": None,
                    "pixels_changed": None, "bits_changed": None}
                if original is None:
                    return result
                before = inspect_video(original)
                if (before.width, before.height, before.frame_count, before.rate, before.scale) != (
                    video.width, video.height, video.frame_count, video.rate, video.scale):
                    raise ValueError("Original and protected AVI need matching dimensions, timing and frame count")
                a = np.frombuffer(before.slots(), dtype=np.uint8).reshape(video.frame_count, video.height, video.width, 3)
                b = np.frombuffer(video.slots(), dtype=np.uint8).reshape(video.frame_count, video.height, video.width, 3)
                timeline = [int(np.count_nonzero(np.any(a[i] != b[i], axis=2)))
                            for i in range(video.frame_count)]
                delta = np.abs(a[frame].astype(np.int16) - b[frame].astype(np.int16))
                intensity = delta.max(axis=2)
                if stride > 1:
                    pad_y = (-video.height) % stride
                    pad_x = (-video.width) % stride
                    reduced = np.pad(intensity, ((0, pad_y), (0, pad_x)), mode="constant")
                    reduced = reduced.reshape(reduced.shape[0] // stride, stride,
                                              reduced.shape[1] // stride, stride).max(axis=(1, 3))
                else:
                    reduced = intensity
                heat = np.zeros((*reduced.shape, 3), dtype=np.uint8)
                heat[:, :, 0] = np.clip(reduced * 64, 0, 255).astype(np.uint8)
                heat[:, :, 1] = np.clip(reduced * 16, 0, 255).astype(np.uint8)
                result.update(original_preview=png_data_url(pixels(before, frame)[::stride, ::stride].copy()),
                    heatmap=png_data_url(heat), timeline=timeline,
                    pixels_changed=timeline[frame],
                    bits_changed=int(np.unpackbits(np.bitwise_xor(a[frame], b[frame])).sum()))
                return result
            return await run_in_threadpool(work)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

    @app.post("/api/v4/media/probe")
    async def probe(file: UploadFile = File(...)):
        data = await _read(file, "Cover")
        try:
            def work():
                return _source(data, file.filename or "source", lambda _path, info, _folder: {
                    "kind": _kind(info), "duration": float(info.get("format", {}).get("duration", 0)),
                    "streams": [{"type": s.get("codec_type"), "codec": s.get("codec_name"),
                                 "width": s.get("width"), "height": s.get("height"),
                                 "sample_rate": s.get("sample_rate"), "channels": s.get("channels")}
                                for s in info.get("streams", [])]})
            return await run_in_threadpool(work)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

    @app.post("/api/v4/media/prepare")
    async def prepare(file: UploadFile = File(...), start: float = Form(0), duration: float = Form(3),
                      fps: int = Form(24), max_width: int = Form(640), max_height: int = Form(360)):
        data = await _read(file, "Cover")
        if start < 0 or not 0 < duration <= 30 or not 1 <= fps <= 30 or not 16 <= max_width <= 640 or not 16 <= max_height <= 360:
            raise HTTPException(400, "Segment, frame rate or dimensions are out of range.")
        try:
            def convert():
                def work(source, info, folder):
                    kind = _kind(info)
                    if kind == "audio":
                        audio = next(s for s in info["streams"] if s.get("codec_type") == "audio")
                        expected = float(info.get("format", {}).get("duration", 0)) * int(audio.get("sample_rate", 0)) * int(audio.get("channels", 0)) * 2
                        if expected > 200 * 1024 * 1024:
                            raise ValueError("Prepared WAV would exceed 200 MiB. Select a shorter source.")
                        output = folder / "prepared.wav"
                        _run([_binary("ffmpeg"), "-nostdin", "-v", "error", "-i", str(source),
                              "-map", "0:a:0", "-vn", "-c:a", "pcm_s16le", "-fs", str(200 * 1024 * 1024), str(output)])
                        content = output.read_bytes()
                        if len(content) > 200 * 1024 * 1024:
                            raise ValueError("Prepared WAV exceeds 200 MiB")
                        load_cover(content)
                        extension, mime = ".wav", "audio/wav"
                    else:
                        source_duration = float(info.get("format", {}).get("duration", 0))
                        if source_duration and start >= source_duration:
                            raise ValueError("Segment start is after the video ends")
                        width, height = _dimensions(info, max_width, max_height)
                        estimated = width * height * 3 * math.ceil(duration * fps) + 4096
                        if estimated > MAX_AVI_BYTES:
                            raise ValueError("Prepared AVI would exceed 64 MiB. Reduce duration, frame rate or dimensions.")
                        output = folder / "frames.rgb"
                        _run([_binary("ffmpeg"), "-nostdin", "-v", "error", "-ss", str(start), "-i", str(source),
                              "-t", str(duration), "-an", "-vf", f"fps={fps},scale={width}:{height}",
                              "-pix_fmt", "bgr24", "-f", "rawvideo", "-fs", str(MAX_AVI_BYTES), str(output)])
                        content = _avi(output.read_bytes(), width, height, fps)
                        extension, mime = ".avi", "video/x-msvideo"
                    return content, kind, extension, mime
                return _source(data, file.filename or "source", work)
            content, kind, extension, mime = await run_in_threadpool(convert)
            stored = store.put(content, "prepared_" + Path(file.filename or "cover").stem + extension, mime)
            return {"file": stored, "kind": kind, "conversion": {"source_name": file.filename,
                "output_format": extension[1:].upper(), "audio_omitted": kind == "video",
                "start": start, "duration": duration, "fps": fps}}
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
