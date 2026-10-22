/* Kyrgyz HTR — image preprocessing (browser port of kyrgyz_ctc.word_ink).
 * Pure functions, no DOM: input RGBA pixels, output a 64-px-high ink map for the CTC model.
 * Mirrored 1:1 in webapp/tools/web_pipeline.py (used to verify accuracy in Python). */
(function (root) {
  'use strict';
  const H = 64, MAX_W = 512;

  // RGBA -> grey (PIL "L" formula), alpha composited on white
  function toGray(rgba, w, h) {
    const g = new Float32Array(w * h);
    for (let i = 0, p = 0; i < w * h; i++, p += 4) {
      const a = rgba[p + 3];
      const r = (rgba[p] * a + 255 * (255 - a)) / 255;
      const gg = (rgba[p + 1] * a + 255 * (255 - a)) / 255;
      const b = (rgba[p + 2] * a + 255 * (255 - a)) / 255;
      g[i] = (Math.round(r) * 19595 + Math.round(gg) * 38470 + Math.round(b) * 7471 + 0x8000) >> 16;
    }
    return g;
  }

  // separable max filter, window (2r+1), edges clamped
  function maxFilter(src, w, h, r) {
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let m = 0;
        for (let k = -r; k <= r; k++) {
          const xx = Math.min(w - 1, Math.max(0, x + k));
          const v = src[y * w + xx];
          if (v > m) m = v;
        }
        tmp[y * w + x] = m;
      }
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        let m = 0;
        for (let k = -r; k <= r; k++) {
          const yy = Math.min(h - 1, Math.max(0, y + k));
          const v = tmp[yy * w + x];
          if (v > m) m = v;
        }
        out[y * w + x] = m;
      }
    }
    return out;
  }

  // 1-D box blur of radius r along rows (horiz=true) or columns, edges clamped
  function boxBlur(src, w, h, r, horiz) {
    const out = new Float32Array(w * h), n = 2 * r + 1;
    const len = horiz ? w : h, lines = horiz ? h : w;
    for (let l = 0; l < lines; l++) {
      const at = (i) => {
        const c = Math.min(len - 1, Math.max(0, i));
        return horiz ? src[l * w + c] : src[c * w + l];
      };
      let s = 0;
      for (let k = -r; k <= r; k++) s += at(k);
      for (let i = 0; i < len; i++) {
        if (horiz) out[l * w + i] = s / n; else out[i * w + l] = s / n;
        s += at(i + r + 1) - at(i - r);
      }
    }
    return out;
  }

  // Gaussian approximated by 3 box blurs (radius from sigma), result rounded like an 8-bit image
  function gaussBlur(src, w, h, sigma) {
    const r = Math.max(0, Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2));
    let a = src;
    for (let p = 0; p < 3; p++) {
      a = boxBlur(a, w, h, r, true);
      a = boxBlur(a, w, h, r, false);
    }
    const out = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) out[i] = Math.round(a[i]);
    return out;
  }

  // PIL-style antialiased bilinear resize of a single-channel uint8 image
  function resizeBilinear(src, w, h, nw, nh) {
    function weights(inSize, outSize) {
      const scale = inSize / outSize, fs = Math.max(scale, 1), support = fs, out = [];
      for (let i = 0; i < outSize; i++) {
        const center = (i + 0.5) * scale;
        const xmin = Math.max(0, Math.floor(center - support + 0.5));
        const xmax = Math.min(inSize, Math.floor(center + support + 0.5));
        const ws = []; let tot = 0;
        for (let x = xmin; x < xmax; x++) {
          const v = Math.max(0, 1 - Math.abs((x - center + 0.5) / fs));
          ws.push(v); tot += v;
        }
        out.push({ xmin, ws: ws.map((v) => (tot ? v / tot : 0)) });
      }
      return out;
    }
    const wx = weights(w, nw), wy = weights(h, nh);
    const tmp = new Float32Array(nw * h);
    for (let y = 0; y < h; y++) {
      for (let i = 0; i < nw; i++) {
        const { xmin, ws } = wx[i]; let s = 0;
        for (let k = 0; k < ws.length; k++) s += ws[k] * src[y * w + xmin + k];
        tmp[y * nw + i] = Math.min(255, Math.max(0, Math.round(s)));
      }
    }
    const out = new Float32Array(nw * nh);
    for (let j = 0; j < nh; j++) {
      const { xmin, ws } = wy[j];
      for (let i = 0; i < nw; i++) {
        let s = 0;
        for (let k = 0; k < ws.length; k++) s += ws[k] * tmp[(xmin + k) * nw + i];
        out[j * nw + i] = Math.min(255, Math.max(0, Math.round(s)));
      }
    }
    return out;
  }

  /* rgba: Uint8ClampedArray (w*h*4). Returns {data: Float32Array(64*W) in [0,1], width: W (multiple of 4),
     ink: Uint8 preview (64*W, 0..255)} or null if no ink was found. */
  function preprocess(rgba, w, h) {
    const g = toGray(rgba, w, h);
    const bg = gaussBlur(maxFilter(g, w, h, 4), w, h, Math.max(w, h) / 12);
    const ink = new Float32Array(w * h);
    const hist = new Uint32Array(256);
    for (let i = 0; i < w * h; i++) {
      const flat = Math.min(1, Math.max(0, g[i] / Math.max(bg[i], 1)));
      ink[i] = (1 - flat) * 255;
      hist[Math.min(255, Math.round(ink[i]))]++;
    }
    // 99.7th percentile via histogram
    let target = 0.997 * (w * h), acc = 0, p = 255;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= target) { p = v; break; } }
    const scale = 255 / Math.max(p - 12, 1);
    let y0 = h, y1 = -1, x0 = w, x1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const v = Math.min(255, Math.max(0, (ink[i] - 12) * scale));
        ink[i] = v;
        if (v > 60) { if (y < y0) y0 = y; if (y > y1) y1 = y; if (x < x0) x0 = x; if (x > x1) x1 = x; }
      }
    }
    if (y1 < 0) return null;
    const pad = 2;
    y0 = Math.max(0, y0 - pad); x0 = Math.max(0, x0 - pad);
    y1 = Math.min(h - 1, y1 + pad); x1 = Math.min(w - 1, x1 + pad);
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    const crop = new Float32Array(cw * ch);
    for (let y = 0; y < ch; y++)
      for (let x = 0; x < cw; x++) crop[y * cw + x] = Math.floor(ink[(y + y0) * w + x + x0]);  // uint8 cast
    const nw = Math.min(MAX_W, Math.max(8, Math.round(cw * H / ch)));
    const small = resizeBilinear(crop, cw, ch, nw, H);
    const W = Math.ceil(nw / 4) * 4;  // model downsamples width by 4
    const data = new Float32Array(H * W), prev = new Uint8ClampedArray(H * W);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < nw; x++) { data[y * W + x] = small[y * nw + x] / 255; prev[y * W + x] = small[y * nw + x]; }
    return { data, width: W, ink: prev };
  }

  root.KHTR = Object.assign(root.KHTR || {}, { preprocess, _pp: { toGray, maxFilter, gaussBlur, resizeBilinear } });
})(typeof window !== 'undefined' ? window : globalThis);
