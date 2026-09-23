"""Legacy STG1 errors and verdict names."""
class CapacityError(ValueError):
    """The payload does not fit in the cover."""


class StartLocationError(ValueError):
    """A manually chosen start location is not usable."""


class Verdict:
    AUTHENTIC = "Authentic"
    TAMPERED = "Tampered"
    SIGNATURE_INVALID = "Signature Invalid"
    PAYLOAD_MISSING = "Payload Missing"
    WRONG_START = "Wrong Start Location"
    CANNOT_VERIFY = "Cannot Verify"
