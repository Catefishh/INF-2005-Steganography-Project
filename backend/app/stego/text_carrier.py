"""Text carrier encoding and extraction for the independent V3 format."""
import struct

MAGIC = b"STXT3"
DOMAIN = b"stegloc/text/v3\0"
METHODS = ("acrostic", "whitespace", "zero-width")
MAX_MESSAGE = 32768
MAX_CARRIER = 2 * 1024 * 1024
ZERO = ("\u200b", "\u200c")
STARTERS = ("A", "Bright", "Calm", "During", "Each", "From", "Gentle", "Here",
            "In", "Just", "Kind", "Light", "Many", "Near", "Often", "Perhaps")
def _bits(data: bytes) -> str:
    return "".join(f"{value:08b}" for value in data)


def _from_bits(bits: str) -> bytes:
    return bytes(int(bits[i:i + 8], 2) for i in range(0, len(bits), 8))


def _frame_length(data: bytes) -> int:
    if len(data) < 9 or data[:5] != MAGIC:
        raise ValueError("Text carrier has no v3 message frame")
    length = struct.unpack(">I", data[5:9])[0]
    if not 45 <= length <= MAX_CARRIER or len(data) != 9 + length:
        raise ValueError("Text carrier frame is truncated or has extra symbols")
    return length


def encode(frame: bytes, method: str, visible: str = "") -> str:
    if method not in METHODS:
        raise ValueError("Choose acrostic, whitespace, or zero-width")
    if any(char in visible for char in ZERO):
        raise ValueError("Visible text already contains zero-width carrier characters")
    if method == "acrostic":
        initials = "".join(chr(65 + (byte >> 4)) + chr(65 + (byte & 15)) for byte in frame)
        return "\n".join(f"{STARTERS[ord(letter) - 65]} thought {index + 1} keeps the story moving."
                         for index, letter in enumerate(initials))
    if method == "whitespace":
        lines = visible.rstrip("\r\n").splitlines() if visible.strip() else []
        bits = _bits(frame)
        while len(lines) < len(bits):
            lines.append(f"A quiet line in the story {len(lines) + 1}.")
        if any(line.endswith((" ", "\t")) for line in lines):
            raise ValueError("Visible text already has trailing whitespace")
        return "\n".join(line + ("\t" if bit == "1" else " ")
                         for line, bit in zip(lines, bits)) + "\n"
    return visible + "".join(ZERO[int(bit)] for bit in _bits(frame))


def decode(carrier: str, method: str) -> bytes:
    if len(carrier.encode("utf-8")) > MAX_CARRIER:
        raise ValueError("Text carrier is too large")
    if method == "acrostic":
        lines = carrier.splitlines()
        if not lines or any(not line or line[0] not in "ABCDEFGHIJKLMNOP" for line in lines):
            raise ValueError("Acrostic lines need initials A–P")
        if len(lines) % 2:
            raise ValueError("Acrostic must have an even number of lines")
        data = bytes((ord(lines[i][0]) - 65) * 16 + ord(lines[i + 1][0]) - 65
                     for i in range(0, len(lines), 2))
    elif method == "whitespace":
        lines = carrier.splitlines()
        if not lines or any(not line.endswith((" ", "\t")) or line.endswith(("  ", "\t\t", " \t", "\t "))
                            for line in lines) or len(lines) % 8:
            raise ValueError("Whitespace carrier was stripped or malformed")
        data = _from_bits("".join("1" if line.endswith("\t") else "0" for line in lines))
    elif method == "zero-width":
        bits = "".join("0" if char == ZERO[0] else "1" for char in carrier if char in ZERO)
        if not bits or len(bits) % 8:
            raise ValueError("Zero-width carrier was stripped or malformed")
        data = _from_bits(bits)
    else:
        raise ValueError("Unknown text method")
    _frame_length(data)
    return data
