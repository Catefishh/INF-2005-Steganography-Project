"""Stable V3 route registration."""
from fastapi import FastAPI
from .api import text

def attach_v3(app: FastAPI) -> None:
    text.attach(app)
