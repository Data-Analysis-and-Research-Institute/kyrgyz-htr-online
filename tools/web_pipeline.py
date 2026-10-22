"""NumPy mirror of webapp/js/preprocess.js and webapp/js/decoder.js.

Used to (1) check that the browser pipeline gives the same model accuracy as the training pipeline,
(2) tune the browser decoder's weights on the val split, (3) unit-test the JavaScript in V8 (mini-racer).
"""
import math

import numpy as np

H, MAX_W = 64, 512


def to_gray(rgba):
    a = rgba[..., 3].astype(np.float64)
    c = [np.round((rgba[..., k] * a + 255 * (255 - a)) / 255) for k in range(3)]
    return ((c[0] * 19595 + c[1] * 38470 + c[2] * 7471 + 0x8000).astype(np.int64) >> 16).astype(np.float64)


def max_filter(src, r):
    h, w = src.shape
    p = np.pad(src, ((0, 0), (r, r)), mode='edge')
    tmp = np.max(np.stack([p[:, k:k + w] for k in range(2 * r + 1)]), 0)
    p = np.pad(tmp, ((r, r), (0, 0)), mode='edge')
    return np.max(np.stack([p[k:k + h] for k in range(2 * r + 1)]), 0)


def box_blur(src, r, axis):
    n = src.shape[axis]
    idx = np.clip(np.arange(-r, n + r), 0, n - 1)
    p = np.take(src, idx, axis=axis)
    c = np.cumsum(p, axis=axis, dtype=np.float64)
    c = np.concatenate([np.zeros_like(np.take(c, [0], axis=axis)), c], axis=axis)
    hi = np.take(c, np.arange(2 * r + 1, n + 2 * r + 1), axis=axis)
    lo = np.take(c, np.arange(0, n), axis=axis)
    return (hi - lo) / (2 * r + 1)


def gauss_blur(src, sigma):
    r = max(0, round((math.sqrt(4 * sigma * sigma + 1) - 1) / 2))
    a = src
    for _ in range(3):
        a = box_blur(a, r, 1)
        a = box_blur(a, r, 0)
    return np.round(a)


def _weights(in_size, out_size):
    scale = in_size / out_size
    fs = max(scale, 1.0)
    W = np.zeros((out_size, in_size))
    for i in range(out_size):
        center = (i + 0.5) * scale
        xmin = max(0, math.floor(center - fs + 0.5))
        xmax = min(in_size, math.floor(center + fs + 0.5))
        ws = np.array([max(0.0, 1 - abs((x - center + 0.5) / fs)) for x in range(xmin, xmax)])
        if ws.sum():
            W[i, xmin:xmax] = ws / ws.sum()
    return W


def resize_bilinear(src, nw, nh):
    h, w = src.shape
    tmp = np.clip(np.round(src @ _weights(w, nw).T), 0, 255)
    return np.clip(np.round(_weights(h, nh) @ tmp), 0, 255)


def preprocess(rgba):
    """rgba uint8 (h, w, 4) -> (64, W) float32 in [0,1] with W a multiple of 4, or None."""
    h, w = rgba.shape[:2]
    g = to_gray(rgba)
    bg = gauss_blur(max_filter(g, 4), max(w, h) / 12)
    ink = (1 - np.clip(g / np.maximum(bg, 1), 0, 1)) * 255
    hist = np.bincount(np.minimum(255, np.round(ink).astype(int)).ravel(), minlength=256)
    p = int(np.searchsorted(np.cumsum(hist), 0.997 * w * h))
    ink = np.clip((ink - 12) * (255 / max(p - 12, 1)), 0, 255)
    ys, xs = np.nonzero(ink > 60)
    if not len(ys):
        return None
    y0, y1 = max(0, ys.min() - 2), min(h - 1, ys.max() + 2)
    x0, x1 = max(0, xs.min() - 2), min(w - 1, xs.max() + 2)
    crop = np.floor(ink[y0:y1 + 1, x0:x1 + 1])
    ch, cw = crop.shape
    nw = min(MAX_W, max(8, round(cw * H / ch)))
    small = resize_bilinear(crop, nw, H)
    W = math.ceil(nw / 4) * 4
    out = np.zeros((H, W), np.float32)
    out[:, :nw] = small / 255
    return out


def load_rgba(path):
    from PIL import Image
    return np.asarray(Image.open(path).convert('RGBA'))
