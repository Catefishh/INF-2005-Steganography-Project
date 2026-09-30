"""Stable text route registration."""
from fastapi import FastAPI
from .api import text

def attach_text(app: FastAPI) -> None:
    text.attach(app)
