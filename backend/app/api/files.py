"""Files HTTP endpoints."""
import re

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response

def attach(app: FastAPI, store) -> None:
    @app.get("/api/files/{file_id}")
    def download(file_id: str, request: Request, download: int = 0):
        item = store.get(file_id)
        if item is None:
            raise HTTPException(404, "File expired. Run the operation again.")
        data, filename, media_type = item
        disposition = "attachment" if download else "inline"
        safe = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in filename) or "file"
        headers = {
            "Content-Disposition": f'{disposition}; filename="{safe}"', "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes"}
        byte_range = re.fullmatch(r"bytes=(\d*)-(\d*)", request.headers.get("range", ""))
        if byte_range and any(byte_range.groups()):
            first, last = byte_range.groups()
            try:
                start = int(first) if first else max(0, len(data) - int(last))
                end = min(len(data) - 1, int(last)) if first and last else len(data) - 1
            except ValueError:
                start, end = len(data), -1
            if start >= len(data) or end < start or (not first and int(last) == 0):
                return Response(status_code=416, headers={**headers, "Content-Range": f"bytes */{len(data)}"})
            headers["Content-Range"] = f"bytes {start}-{end}/{len(data)}"
            return Response(data[start:end + 1], status_code=206, media_type=media_type, headers=headers)
        return Response(data, media_type=media_type, headers=headers)
