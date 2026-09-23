"""Independent, deterministic image transformations for recovery demonstrations."""
import io

import numpy as np
from PIL import Image, ImageEnhance


def transform(data: bytes, operation: str, value: float) -> tuple[bytes, str]:
    image = Image.open(io.BytesIO(data)).convert("RGB")
    if operation == "resize":
        if not 0.25 <= value <= 0.99:
            raise ValueError("Resize factor must be between 0.25 and 0.99")
        image = image.resize((max(1, round(image.width * value)), max(1, round(image.height * value))), Image.Resampling.LANCZOS)
    elif operation == "crop":
        if not 0.25 <= value <= 0.99:
            raise ValueError("Crop fraction must be between 0.25 and 0.99")
        width, height = max(1, round(image.width * value)), max(1, round(image.height * value))
        left, top = (image.width - width) // 2, (image.height - height) // 2
        image = image.crop((left, top, left + width, top + height))
    elif operation == "jpeg":
        if value != int(value) or not 1 <= value <= 100:
            raise ValueError("JPEG quality must be a whole number from 1 to 100")
        compressed = io.BytesIO()
        image.save(compressed, format="JPEG", quality=int(value))
        image = Image.open(io.BytesIO(compressed.getvalue())).convert("RGB")
    elif operation == "noise":
        if not 0 <= value <= 25:
            raise ValueError("Noise sigma must be from 0 to 25")
        rng = np.random.default_rng(2005)
        pixels = np.asarray(image, dtype=np.float32)
        image = Image.fromarray(np.clip(np.rint(pixels + rng.normal(0, value, pixels.shape)), 0, 255).astype(np.uint8))
    elif operation == "brightness":
        if not 0.1 <= value <= 3:
            raise ValueError("Brightness factor must be from 0.1 to 3")
        image = ImageEnhance.Brightness(image).enhance(value)
    else:
        raise ValueError("Unknown image transformation")
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue(), ".png"
