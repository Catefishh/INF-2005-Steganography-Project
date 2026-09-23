"""Keys HTTP endpoints."""
from fastapi import FastAPI, Request
from ..stego.security import KeyFormatError, fingerprint, load_private_key, load_public_key
from .common import KeyInspectRequest, _bad_request

def attach(app: FastAPI) -> None:
    @app.post("/api/keys/generate")
    def keys_generate(request: Request):
        private_pem, public_pem = request.app.state.generate_rsa_keys()
        key = load_public_key(public_pem)
        return {"private_key": private_pem.decode(), "public_key": public_pem.decode(),
                "fingerprint": fingerprint(key), "bits": key.key_size}

    @app.post("/api/keys/inspect")
    def keys_inspect(body: KeyInspectRequest):
        pem = body.pem.encode()
        try:
            if b"PRIVATE KEY" in pem:
                if b"ENCRYPTED" in pem and not body.password:
                    return {"type": "private", "encrypted": True, "bits": None, "fingerprint": None}
                key = load_private_key(pem, body.password.encode() if body.password else None)
                return {"type": "private", "encrypted": b"ENCRYPTED" in pem, "bits": key.key_size,
                        "fingerprint": fingerprint(key.public_key())}
            key = load_public_key(pem)
            return {"type": "public", "encrypted": False, "bits": key.key_size, "fingerprint": fingerprint(key)}
        except KeyFormatError as exc:
            raise _bad_request(exc)

