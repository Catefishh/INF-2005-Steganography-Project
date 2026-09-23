"""Files HTTP endpoints."""
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response

def attach(app: FastAPI, store) -> None:
    @app.get("/api/files/{file_id}")
    def download(file_id: str, download: int = 0):
        item = store.get(file_id)
        if item is None:
            raise HTTPException(404, "File expired. Run the operation again.")
        data, filename, media_type = item
        disposition = "attachment" if download else "inline"
        safe = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in filename) or "file"
        return Response(data, media_type=media_type, headers={
            "Content-Disposition": f'{disposition}; filename="{safe}"', "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff"})
