"""Shared request parsing and response models for legacy routes."""
from fastapi import HTTPException
from pydantic import BaseModel, Field

MAX_UPLOAD_BYTES = 200 * 1024 * 1024

class EstimateRequest(BaseModel):
    method: str = Field("lsb", max_length=10)
    cover_kind: str = Field(max_length=10)
    descriptor: str = Field(max_length=200)
    cover_filename: str = Field("", max_length=200)
    payload_filename: str = Field(max_length=200)
    payload_type: str = Field(max_length=200)
    payload_size: int = Field(ge=0)
    team: str = Field("", max_length=200)
    key_bits: int = Field(2048, ge=1024, le=16384)


class KeyInspectRequest(BaseModel):
    pem: str = Field(max_length=32768)
    password: str | None = Field(None, max_length=1024)


async def _read(upload, name):
    data = await upload.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"{name} is larger than 200 MB.")
    return data


def _optional_int(value, name):
    if value is None or str(value).strip() == "":
        return None
    try:
        return int(value)
    except ValueError as exc:
        raise HTTPException(400, f"{name} must be a whole number.") from exc


def _optional_float(value, name):
    if value is None or str(value).strip() == "":
        return None
    try:
        return float(value)
    except ValueError as exc:
        raise HTTPException(400, f"{name} must be a number.") from exc


def _bad_request(exc):
    return HTTPException(400, str(exc))


def _looks_like_text(data):
    if b"\x00" in data[:4096]:
        return False
    try:
        data.decode("utf-8")
        return True
    except UnicodeDecodeError:
        return False
