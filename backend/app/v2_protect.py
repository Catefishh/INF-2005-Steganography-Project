"""V2 sender workflows for image, PCM WAV, and AVI carriers."""
from __future__ import annotations

from .stego import lsb
from .stego.carriers.image import canonical_hash, inspect_image
from .stego.carriers.audio import canonical_hash as audio_canonical_hash, inspect_audio
from .stego.carriers.video import VideoError, canonical_hash as video_canonical_hash, inspect_video
from .stego.protocol import CARRIER_HASH_PLACEHOLDER, measure_encrypted_envelope_length
from .stego.v2_security import create_bundle, derive_keys, generate_recovery_secret, generate_salt
from .v2_record import _record
from .v2_results import ProtectionResult

def _protect(adapter, data, content, private_key, hash_fn, *, metadata, depth, start, secret, salt,
             keep_size=False) -> ProtectionResult:
    """Shared signed-envelope path; each adapter supplies its own canonical hash."""
    metadata = metadata or {}
    secret = generate_recovery_secret() if secret is None else secret
    salt = generate_salt() if salt is None else salt
    start_key = derive_keys(secret, salt).start_selection
    probe = _record(adapter, content, private_key, metadata, depth, 0, 0, CARRIER_HASH_PLACEHOLDER)
    encoded = measure_encrypted_envelope_length(probe, len(content))
    try:
        start = lsb.suggest_start(start_key, salt, adapter.descriptor, depth, adapter.eligible_slots, encoded) if start is None else start
    except lsb.NoFitError as exc:
        raise lsb.CapacityError("capacity is insufficient for encrypted package") from exc
    record = _record(adapter, content, private_key, metadata, depth, start, encoded, CARRIER_HASH_PLACEHOLDER)
    record["carrier_sha256"] = hash_fn(adapter, depth, encoded, start)
    bundle = create_bundle(record, content, private_key, secret=secret, salt=salt)
    if len(bundle.encrypted_package) != encoded:
        raise ValueError("encrypted package length changed")
    adapter.embed(bundle.encrypted_package, depth, start)
    carrier = adapter.export()
    if keep_size and len(carrier) != len(data):
        raise VideoError("AVI export changed byte length")
    return ProtectionResult(carrier, bundle.sidecar, bundle.recovery_code, _freeze_record(record))


def protect_image(data: bytes, content: bytes, private_key, *, metadata=None, depth=3, start=None, secret=None, salt=None) -> ProtectionResult:
    return _protect(inspect_image(data), data, content, private_key, canonical_hash,
                    metadata=metadata, depth=depth, start=start, secret=secret, salt=salt)


def protect_audio(data: bytes, content: bytes, private_key, *, metadata=None, depth=3, start=None, secret=None, salt=None) -> ProtectionResult:
    return _protect(inspect_audio(data), data, content, private_key, audio_canonical_hash,
                    metadata=metadata, depth=depth, start=start, secret=secret, salt=salt)


def protect_video(data: bytes, content: bytes, private_key, *, metadata=None, depth=3, start=None, secret=None, salt=None) -> ProtectionResult:
    return _protect(inspect_video(data), data, content, private_key, video_canonical_hash,
                    metadata=metadata, depth=depth, start=start, secret=secret, salt=salt, keep_size=True)


def _freeze_record(record):
    from .stego.v2_security import _freeze
    return _freeze(record)
