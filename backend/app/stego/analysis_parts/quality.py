"""Full-resolution luminance SSIM with the published 11x11 Gaussian window."""
import numpy as np


def _blur(image: np.ndarray, kernel: np.ndarray) -> np.ndarray:
    # Separable convolution; valid windows avoid artificial border values.
    rows = np.lib.stride_tricks.sliding_window_view(image, len(kernel), axis=0)
    vertical = np.tensordot(rows, kernel, axes=([-1], [0]))
    cols = np.lib.stride_tricks.sliding_window_view(vertical, len(kernel), axis=1)
    return np.tensordot(cols, kernel, axes=([-1], [0]))


def ssim(a: np.ndarray, b: np.ndarray) -> float | None:
    if a.shape != b.shape:
        raise ValueError("Images must have matching dimensions for SSIM.")
    if min(a.shape[:2]) < 11:
        return None
    if np.array_equal(a, b):
        return 1.0
    weights = np.exp(-0.5 * (np.arange(-5, 6) / 1.5) ** 2)
    weights /= weights.sum()
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    total, count = 0.0, 0
    # Tile full-resolution valid windows to keep memory bounded on large images.
    for top in range(0, a.shape[0] - 10, 256):
        for left in range(0, a.shape[1] - 10, 256):
            bottom = min(top + 266, a.shape[0])
            right = min(left + 266, a.shape[1])
            x = a[top:bottom, left:right].astype(np.float64) @ np.array([0.299, 0.587, 0.114])
            y = b[top:bottom, left:right].astype(np.float64) @ np.array([0.299, 0.587, 0.114])
            mx, my = _blur(x, weights), _blur(y, weights)
            vx = np.maximum(0, _blur(x * x, weights) - mx * mx)
            vy = np.maximum(0, _blur(y * y, weights) - my * my)
            covariance = _blur(x * y, weights) - mx * my
            values = ((2 * mx * my + c1) * (2 * covariance + c2) /
                      ((mx * mx + my * my + c1) * (vx + vy + c2)))
            total += float(np.sum(values))
            count += values.size
    return total / count
