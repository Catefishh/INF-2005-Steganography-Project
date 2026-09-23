import socket
import subprocess
import sys
import textwrap
import threading
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, build_opener, urlopen

import pytest

from backend import desktop


def test_desktop_serves_ui_and_api_and_closes_socket(tmp_path):
    (tmp_path / "index.html").write_text("desktop interface", encoding="utf-8")
    with desktop.local_server(tmp_path) as start_url:
        origin = start_url.split("/_desktop/")[0]
        with pytest.raises(HTTPError, match="403"):
            urlopen(origin + "/api/health", timeout=2)
        client = build_opener(HTTPCookieProcessor())
        assert client.open(start_url, timeout=2).read() == b"desktop interface"
        assert b"stegloc-api" in client.open(origin + "/api/health", timeout=2).read()
        assert client.open(origin + "/v2", timeout=2).read() == b"desktop interface"
        assert client.open(origin + "/text", timeout=2).read() == b"desktop interface"
        session = client.open(origin + "/api/v2/session", data=b"", timeout=2)
        assert b'"ready"' in session.read()
        port = int(origin.rsplit(":", 1)[1])
    with pytest.raises(OSError):
        socket.create_connection(("127.0.0.1", port), timeout=1)


def test_desktop_closes_server_after_window_failure(tmp_path):
    (tmp_path / "index.html").write_text("desktop interface", encoding="utf-8")
    with pytest.raises(RuntimeError, match="window failed"):
        with desktop.local_server(tmp_path) as start_url:
            port = int(start_url.split("/_desktop/")[0].rsplit(":", 1)[1])
            raise RuntimeError("window failed")
    with pytest.raises(OSError):
        socket.create_connection(("127.0.0.1", port), timeout=1)


def test_missing_frontend_has_actionable_error(tmp_path):
    with pytest.raises(RuntimeError, match="npm run build"):
        with desktop.local_server(tmp_path):
            pytest.fail("must not start without the frontend")


def test_asset_path_is_independent_of_working_directory(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    assert desktop.FRONTEND_DIST == Path(desktop.__file__).resolve().parents[1] / "frontend" / "dist"


def test_startup_failure_cleans_up(monkeypatch, tmp_path):
    import uvicorn

    (tmp_path / "index.html").write_text("desktop interface", encoding="utf-8")
    bound = []

    def fail_start(self, sockets):
        bound.append(sockets[0])

    monkeypatch.setattr(uvicorn.Server, "run", fail_start)
    with pytest.raises(RuntimeError, match="could not start"):
        with desktop.local_server(tmp_path):
            pytest.fail("server failed to start")
    assert bound[0].fileno() == -1


def test_startup_timeout_cleans_up(monkeypatch, tmp_path):
    import uvicorn

    (tmp_path / "index.html").write_text("desktop interface", encoding="utf-8")
    bound = []

    def wait_for_exit(self, sockets):
        bound.append(sockets[0])
        while not self.should_exit:
            threading.Event().wait(0.01)

    monkeypatch.setattr(uvicorn.Server, "run", wait_for_exit)
    with pytest.raises(RuntimeError, match="too long"):
        with desktop.local_server(tmp_path, startup_timeout=0.05):
            pytest.fail("server never became ready")
    assert bound[0].fileno() == -1


def test_closing_during_work_does_not_keep_process_alive(tmp_path):
    (tmp_path / "index.html").write_text("desktop interface", encoding="utf-8")
    code = textwrap.dedent(f"""
        import socket, threading, time
        from pathlib import Path
        from urllib.request import build_opener, HTTPCookieProcessor, Request
        from backend.desktop import local_server
        from backend.app import main

        entered = threading.Event()
        def slow_keys():
            entered.set()
            time.sleep(30)
        main.generate_rsa_keys = slow_keys

        with local_server(Path({str(tmp_path)!r})) as url:
            client = build_opener(HTTPCookieProcessor())
            client.open(url, timeout=2).close()
            origin = url.split('/_desktop/')[0]
            def request():
                try:
                    client.open(Request(origin + '/api/keys/generate', data=b''), timeout=8).close()
                except Exception:
                    pass
            threading.Thread(target=request, daemon=True).start()
            assert entered.wait(3), 'request never started'
        try:
            socket.create_connection(('127.0.0.1', int(origin.rsplit(':', 1)[1])), timeout=1)
        except OSError:
            print('closed while work was active')
        else:
            raise AssertionError('server still listening')
    """)
    result = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True,
                            timeout=12, cwd=Path(desktop.__file__).resolve().parents[1])
    assert result.returncode == 0, result.stderr
    assert "closed while work was active" in result.stdout


@pytest.mark.parametrize("renderer,expected", [("mshtml", 1), ("edgechromium", 0)])
def test_main_rejects_legacy_renderer_and_stops_server(monkeypatch, tmp_path, renderer, expected):
    initialized = SimpleNamespace(callback=None)

    class InitializationEvent:
        def __iadd__(self, callback):
            initialized.callback = callback
            return self

    window = SimpleNamespace(events=SimpleNamespace(initialized=InitializationEvent()))
    closed = []
    errors = []

    @contextmanager
    def server():
        try:
            yield "http://127.0.0.1:12345/"
        finally:
            closed.append(True)

    def start(**kwargs):
        assert kwargs == {"gui": "edgechromium", "private_mode": True}
        assert initialized.callback(renderer) is (renderer == "edgechromium")

    fake_webview = SimpleNamespace(settings={}, renderer=renderer, create_window=lambda *a, **k: window, start=start)
    monkeypatch.setitem(sys.modules, "webview", fake_webview)
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    monkeypatch.setattr(desktop.sys, "platform", "win32")
    monkeypatch.setattr(desktop, "local_server", server)
    monkeypatch.setattr(desktop.ctypes, "windll", SimpleNamespace(user32=SimpleNamespace(
        MessageBoxW=lambda owner, message, title, flags: errors.append(message))), raising=False)

    assert desktop.main() == expected
    assert closed == [True]
    assert bool(errors) is (expected == 1)
    if errors:
        assert "WebView2 Runtime is required" in errors[0]
