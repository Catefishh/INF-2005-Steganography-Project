"""Decoded RGB LSB carrier exported in its source container with audio."""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path
from tempfile import TemporaryDirectory

from .. import lsb
from .video import VideoError

MAX_RAW_BYTES = 512 * 1024 * 1024
MAX_AUDIO_BYTES = 128 * 1024 * 1024
MAX_FILE_BYTES = 200 * 1024 * 1024


def is_mp4(data: bytes) -> bool:
    return extension(data) != ""


def extension(data: bytes) -> str:
    if len(data) >= 16 and data[4:8] == b"ftyp":
        brand = data[8:12]
        if brand in (b"avif", b"avis", b"mif1", b"heic", b"heix"):
            return ""
        return ".mov" if brand == b"qt  " else ".3gp" if brand.startswith(b"3g") else ".m4v" if brand == b"M4V " else ".mp4"
    if data.startswith(b"\x1a\x45\xdf\xa3"):
        header = data[:128].lower()
        return ".webm" if b"webm" in header else ".mkv" if b"matroska" in header else ""
    if data.startswith(b"FLV"):
        return ".flv"
    if data.startswith(bytes.fromhex("3026b2758e66cf11a6d900aa0062ce6c")):
        return ".wmv"
    return ""


@dataclass
class Mp4Adapter:
    original: bytes
    width: int
    height: int
    frame_count: int
    fps: Fraction
    audio_hash: bytes
    has_audio: bool
    suffix: str
    _slots: bytearray

    @property
    def descriptor(self) -> str:
        return (f"{self.suffix[1:]}:rgb24:{self.width}x{self.height}:{self.frame_count}f:"
                f"{self.fps.numerator}/{self.fps.denominator}:audio={int(self.has_audio)}")

    @property
    def eligible_slots(self) -> int:
        return len(self._slots)

    def slots(self) -> bytearray:
        return self._slots

    def embed(self, payload: bytes, depth: int, start: int = 0) -> None:
        lsb.embed(self._slots, payload, depth, start)

    def extract(self, length: int, depth: int, start: int = 0) -> bytes:
        return lsb.extract(self._slots, length, depth, start)

    def slot_for(self, frame: int, x: int, y: int, channel: int = 0) -> int:
        if not (0 <= frame < self.frame_count and 0 <= x < self.width and
                0 <= y < self.height and 0 <= channel < 3):
            raise VideoError("Video start frame, pixel or R/G/B channel is out of range")
        return ((frame * self.height + y) * self.width + x) * 3 + channel

    def export(self) -> bytes:
        return self.export_slots(self._slots)

    def export_slots(self, slots: bytearray) -> bytes:
        from ...api.v4_media import _binary, _run
        with TemporaryDirectory() as folder:
            directory = Path(folder)
            source = directory / ("source" + self.suffix)
            pixels = directory / "pixels.rgb"
            output = directory / ("stego" + self.suffix)
            source.write_bytes(self.original)
            pixels.write_bytes(slots)
            codec = (["-c:v", "libvpx-vp9", "-lossless", "1", "-pix_fmt", "gbrp"] if self.suffix == ".webm"
                     else ["-c:v", "libx264rgb", "-qp", "0", "-preset", "fast", "-pix_fmt", "rgb24"])
            _run([_binary("ffmpeg"), "-nostdin", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
                  "-video_size", f"{self.width}x{self.height}", "-framerate", str(self.fps), "-i", str(pixels),
                  "-i", str(source), "-map", "0:v:0", "-map", "1:a:0?", *codec, "-c:a", "copy",
                  *(["-f", "mp4", "-brand", "M4V "] if self.suffix == ".m4v" else []), str(output)], 180)
            if output.stat().st_size > MAX_FILE_BYTES:
                raise VideoError("Protected video exceeds 200 MiB; use a shorter AVI segment.")
            result = output.read_bytes()
        decoded = inspect_mp4(result)
        if decoded.slots() != slots or decoded.audio_hash != self.audio_hash:
            raise VideoError("Lossless video or audio did not survive encoding exactly.")
        return result


def inspect_mp4(data: bytes) -> Mp4Adapter:
    if not isinstance(data, bytes) or not is_mp4(data) or len(data) > MAX_FILE_BYTES:
        raise VideoError("Video format is unsupported or exceeds 200 MiB; prepare an AVI cover")
    from ...api.v4_media import _binary, _run, _source

    suffix = extension(data)

    def work(source, info, folder):
        videos = [stream for stream in info.get("streams", []) if stream.get("codec_type") == "video"]
        if len(videos) != 1:
            raise VideoError("Video requires exactly one video stream")
        video = videos[0]
        width, height = int(video.get("width") or 0), int(video.get("height") or 0)
        if not 1 <= width <= 1920 or not 1 <= height <= 1080:
            raise VideoError("Video dimensions exceed the supported 1920×1080 limit")
        try:
            fps = Fraction(video["avg_frame_rate"])
            nominal_fps = Fraction(video["r_frame_rate"])
        except (KeyError, ValueError, ZeroDivisionError) as exc:
            raise VideoError("Video frame rate is unavailable") from exc
        if fps <= 0 or fps > 60 or fps != nominal_fps:
            raise VideoError("Variable-frame-rate video needs the AVI preparation option")
        pixels = folder / "pixels.rgb"
        _run([_binary("ffmpeg"), "-nostdin", "-v", "error", "-i", str(source), "-map", "0:v:0",
              "-vsync", "0", "-pix_fmt", "rgb24", "-f", "rawvideo", "-fs", str(MAX_RAW_BYTES + 1), str(pixels)], 180)
        size = pixels.stat().st_size
        frame_bytes = width * height * 3
        if not size or size > MAX_RAW_BYTES or size % frame_bytes:
            raise VideoError("Decoded video exceeds 512 MiB; use a shorter AVI segment")
        audio_streams = [stream for stream in info.get("streams", []) if stream.get("codec_type") == "audio"]
        if len(audio_streams) > 1:
            raise VideoError("Video supports one audio track; prepare an AVI cover for this file")
        audio_hash = b""
        if audio_streams:
            audio = folder / "audio.pcm"
            _run([_binary("ffmpeg"), "-nostdin", "-v", "error", "-i", str(source), "-map", "0:a:0",
                  "-ac", "2", "-ar", "48000", "-f", "s16le", "-fs", str(MAX_AUDIO_BYTES + 1), str(audio)], 180)
            if audio.stat().st_size > MAX_AUDIO_BYTES:
                raise VideoError("Decoded audio exceeds 128 MiB; use a shorter AVI segment")
            audio_hash = hashlib.sha256(audio.read_bytes()).digest()
        return Mp4Adapter(data, width, height, size // frame_bytes, fps, audio_hash,
                          bool(audio_streams), suffix, bytearray(pixels.read_bytes()))

    return _source(data, "source" + suffix, work)


def canonical_hash(adapter: Mp4Adapter, depth: int, length: int, start: int) -> str:
    masked = bytearray(adapter.slots())
    lsb.mask_slots(masked, length, depth, start)
    digest = hashlib.sha256(b"stegloc/v1/carrier/rgb-video\0")
    digest.update(adapter.descriptor.encode())
    digest.update(adapter.audio_hash)
    digest.update(masked)
    return digest.hexdigest()
