"""V2 result types and per-stage evidence."""
from dataclasses import dataclass
from enum import Enum
from typing import Any

class Verdict(str, Enum):
    AUTHENTIC = "Authentic"; TAMPERED = "Tampered"; SIGNATURE_INVALID = "Signature Invalid"; CANNOT_VERIFY = "Cannot Verify"

@dataclass(frozen=True)
class ProtectionResult:
    carrier: bytes; sidecar: bytes; recovery_code: str; record: dict[str, Any]

@dataclass(frozen=True)
class VerificationResult:
    overall: Verdict; stages: dict[str, dict[str, str]]; content: bytes | None = None; record: dict[str, Any] | None = None


def _stages() -> dict[str, dict[str, str]]:
    return {name: {"status": "skipped", "evidence": "", "reason": ""} for name in (
        "locator", "extraction", "ciphertext_digest", "decryption", "signature", "content_hash", "consistency", "carrier_hash", "size_policy"
    )}


def _passed(stages, name: str, evidence: str = "") -> None:
    stages[name] = {"status": "passed", "evidence": evidence, "reason": ""}


def _failed(stages, name: str, reason: str) -> None:
    stages[name] = {"status": "failed", "evidence": "", "reason": reason}
