"""Stable V3 route registration."""
from fastapi import FastAPI
from .api import text, robustness

def attach_v3(app: FastAPI) -> None:
    text.attach(app)
    robustness.attach(app)
