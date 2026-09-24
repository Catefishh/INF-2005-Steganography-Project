"""Desktop window and the lifetime of its private local API server."""

import ctypes
import logging
import os
import secrets
import socket
import sys
import threading
import time
import uuid
from contextlib import contextmanager
from logging.handlers import RotatingFileHandler
from pathlib import Path
from urllib.parse import urlencode

FRONTEND_DIST = Path(__file__).resolve().parents[1] / "frontend" / "dist"


class GraphWindowBridge:
    """Expose only graph window creation and closing to the local WebView UI."""

    def __init__(self, webview, bootstrap_url):
        self.webview = webview
        self.bootstrap_url = bootstrap_url
        self.windows = {}
        self.lock = threading.Lock()

    def open_graph(self, graph_id, title):
        try:
            if str(uuid.UUID(graph_id)) != graph_id or not isinstance(title, str):
                return False
            label = title[:80] if title.strip() else "Graph detail"
            url = f"{self.bootstrap_url}?{urlencode({'next': f'/graph/{graph_id}'})}"
            window = self.webview.create_window(f"Stegloc — {label}", url, width=1180, height=840,
                                                min_size=(760, 520), text_select=True, zoomable=True, js_api=self)
            with self.lock:
                self.windows[graph_id] = window
            if hasattr(window, "events") and hasattr(window.events, "closed"):
                window.events.closed += lambda *args: self._forget(graph_id)
            return True
        except (TypeError, ValueError):
            return False
        except Exception:
            logging.getLogger(__name__).exception("Unable to open graph window")
            return False

    def close_graph(self, graph_id):
        with self.lock:
            window = self.windows.pop(graph_id, None)
        if window is None:
            return False
        window.destroy()
        return True

    def _forget(self, graph_id):
        with self.lock:
            self.windows.pop(graph_id, None)


@contextmanager
def local_server(frontend_dist=FRONTEND_DIST, startup_timeout=15):
    """Keep one bound socket until the desktop window exits, even on failure."""
    if not (frontend_dist / "index.html").is_file():
        raise RuntimeError("The interface is missing. Run npm run build in the frontend folder, then try again.")

    import uvicorn
    from backend.app.main import create_app

    token = secrets.token_urlsafe(32)
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
        config = uvicorn.Config(
            create_app(frontend_dist, desktop_token=token),
            host="127.0.0.1", port=port, loop="asyncio", http="h11", ws="none",
            log_config=None, access_log=False, timeout_graceful_shutdown=2,
        )
        server = uvicorn.Server(config)
        worker = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True,
                                  name="stegloc-api")
        worker.start()
        try:
            deadline = time.monotonic() + startup_timeout
            while not server.started:
                if not worker.is_alive():
                    raise RuntimeError("The local service could not start. Check the desktop log for details.")
                if time.monotonic() >= deadline:
                    raise RuntimeError("The local service took too long to start. Try opening Stegloc again.")
                worker.join(0.02)
            yield f"http://127.0.0.1:{port}/_desktop/{token}"
        finally:
            server.should_exit = True
            worker.join(timeout=5)
            if worker.is_alive():
                server.force_exit = True
                logging.getLogger(__name__).warning("Local service exceeded its shutdown deadline.")


def main():
    log_path = None
    try:
        log_dir = Path(os.getenv("LOCALAPPDATA") or Path.home()) / "Stegloc" / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        log_path = log_dir / "desktop.log"
        logging.basicConfig(
            level=logging.INFO,
            format="%(asctime)s %(levelname)s %(name)s: %(message)s",
            handlers=[RotatingFileHandler(log_path, maxBytes=1_000_000, backupCount=1, encoding="utf-8")],
        )
        import webview

        webview.settings["ALLOW_DOWNLOADS"] = True
        with local_server() as url:
            graph_bridge = GraphWindowBridge(webview, url)
            window = webview.create_window("Stegloc", url, width=1440, height=940, min_size=(960, 640),
                                           text_select=True, zoomable=True, js_api=graph_bridge)
            if sys.platform == "win32":
                # pywebview can silently fall back to Internet Explorer without WebView2.
                window.events.initialized += lambda renderer: renderer == "edgechromium"
            webview.start(gui="edgechromium" if sys.platform == "win32" else None, private_mode=True)
            if sys.platform == "win32" and webview.renderer != "edgechromium":
                raise RuntimeError("Microsoft Edge WebView2 Runtime is required to display the interface.")
        return 0
    except Exception as exc:
        logging.getLogger(__name__).exception("Desktop startup failed")
        message = f"Stegloc could not open.\n\n{exc}"
        if sys.platform == "win32":
            message += "\n\nIf the web window could not load, install Microsoft Edge WebView2 Runtime."
        if log_path:
            message += f"\n\nLog: {log_path}"
        if sys.platform == "win32":
            ctypes.windll.user32.MessageBoxW(None, message, "Stegloc - startup error", 0x10)
        elif sys.stderr:
            print(message, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
