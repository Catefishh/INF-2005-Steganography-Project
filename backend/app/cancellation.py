from contextvars import ContextVar
from contextlib import contextmanager

_check: ContextVar[object | None] = ContextVar("stegloc_cancel_check", default=None)

def check() -> None:
    callback = _check.get()
    if callback is not None:
        callback()

@contextmanager
def installed(callback):
    token = _check.set(callback)
    try:
        yield
    finally:
        _check.reset(token)
