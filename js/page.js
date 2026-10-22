/* Kyrgyz HTR — full-page segmentation (port of page_htr.py + page_seg2.py).
 * page image -> deskew -> curved line paths -> words (core-band gaps) -> word images for the recogniser.
 * Pure computation on typed arrays; needs preprocess.js (KHTR._pp filters). */
(function (root) {
  'use strict';
  const MAX_SIDE = 2000;

  function grayOf(imgData) {
    const { data, width: w, height: h } = imgData, g = new Float32Array(w * h);
    for (let i = 0, p = 0; i < w * h; i++, p += 4) g[i] = (data[p] * 19595 + data[p + 1] * 38470 + data[p + 2] * 7471 + 0x8000) >> 16;
    return g;
  }

  function inkMap(g, w, h) {
    const bg = KHTR._pp.gaussBlur(KHTR._pp.maxFilter(g, w, h, 7), w, h, 25);
    const ink = new Float32Array(w * h), hist = new Uint32Array(1001);
    for (let i = 0; i < w * h; i++) {
      ink[i] = 1 - Math.min(1, Math.max(0, g[i] / Math.max(bg[i], 1)));
      hist[Math.round(ink[i] * 1000)]++;
    }
    let acc = 0, hi = 1;
    for (let v = 0; v <= 1000; v++) { acc += hist[v]; if (acc >= 0.995 * w * h) { hi = Math.max(v / 1000, 1e-3); break; } }
    for (let i = 0; i < w * h; i++) ink[i] = Math.min(1, ink[i] / hi);
    return ink;
  }

  function otsu(ink) {
    const hist = new Float64Array(256);
    for (let i = 0; i < ink.length; i++) hist[Math.min(255, Math.floor(ink[i] * 256))]++;
    const n = ink.length;
    let w = 0, mu = 0, muT = 0, best = 0, t = 0;
    for (let v = 0; v < 256; v++) muT += (v / 256) * hist[v] / n;
    for (let v = 0; v < 256; v++) {
      w += hist[v] / n; mu += (v / 256) * hist[v] / n;
      const sb = (muT * w - mu) ** 2 / Math.max(w * (1 - w), 1e-12);
      if (sb > best) { best = sb; t = v / 256; }
    }
    return t;
  }

  function binarise(ink) {
    const t = Math.max(otsu(ink), 0.25), m = new Uint8Array(ink.length);
    for (let i = 0; i < ink.length; i++) m[i] = ink[i] > t ? 1 : 0;
    return m;
  }

  // best deskew angle (degrees): sharpest row profile of the rotated (downscaled) mask
  function bestAngle(m, w, h) {
    const k = Math.min(1, 800 / Math.max(w, h)), sw = Math.round(w * k), sh = Math.round(h * k);
    const pts = [];
    for (let y = 0; y < h; y += 1 / k) for (let x = 0; x < w; x += 1 / k) if (m[Math.floor(y) * w + Math.floor(x)]) pts.push(x * k, y * k);
    let bestV = -1, bestA = 0;
    const cx = sw / 2, cy = sh / 2, prof = new Float64Array(sh * 2);
    for (let a = -6; a <= 6.0001; a += 0.25) {
      const r = (a * Math.PI) / 180, s = Math.sin(r), c = Math.cos(r);
      prof.fill(0);
      for (let i = 0; i < pts.length; i += 2) {
        const y = Math.round(-s * (pts[i] - cx) + c * (pts[i + 1] - cy) + cy + sh / 2);   // rotate by a (counter-clockwise image)
        if (y >= 0 && y < prof.length) prof[y]++;
      }
      let mean = 0; for (const v of prof) mean += v; mean /= prof.length;
      let v = 0; for (const p of prof) v += (p - mean) ** 2;
      if (v > bestV) { bestV = v; bestA = a; }
    }
    return bestA;
  }

  // remove straight ink runs (paper edges, folds, ruled lines), dilated by 2 px
  function removeLines(m, w, h) {
    const lines = new Uint8Array(w * h), minV = Math.floor(0.12 * h), minH = Math.floor(0.25 * w);
    for (let x = 0; x < w; x++) {
      let start = -1;
      for (let y = 0; y <= h; y++) {
        const v = y < h && m[y * w + x];
        if (v && start < 0) start = y;
        if (!v && start >= 0) { if (y - start >= minV) for (let k = start; k < y; k++) lines[k * w + x] = 1; start = -1; }
      }
    }
    for (let y = 0; y < h; y++) {
      let start = -1;
      for (let x = 0; x <= w; x++) {
        const v = x < w && m[y * w + x];
        if (v && start < 0) start = x;
        if (!v && start >= 0) { if (x - start >= minH) for (let k = start; k < x; k++) lines[y * w + k] = 1; start = -1; }
      }
    }
    const out = new Uint8Array(m);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!lines[y * w + x]) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy >= 0 && yy < h && xx >= 0 && xx < w) out[yy * w + xx] = 0;
      }
    }
    return out;
  }

  // two-pass 8-connected labelling with union-find
  function label(m, w, h) {
    const lab = new Int32Array(w * h), parent = [0];
    const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    const union = (a, b) => { a = find(a); b = find(b); if (a !== b) { if (a < b) parent[b] = a; else parent[a] = b; } };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!m[i]) continue;
      const ns = [];
      if (x > 0 && lab[i - 1]) ns.push(lab[i - 1]);
      if (y > 0) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx >= 0 && xx < w && lab[i - w + dx]) ns.push(lab[i - w + dx]); }
      if (!ns.length) { parent.push(parent.length); lab[i] = parent.length - 1; }
      else { let mn = ns[0]; for (const a of ns) if (a < mn) mn = a; lab[i] = mn; for (const a of ns) union(a, mn); }
    }
    const remap = new Int32Array(parent.length);
    let n = 0;
    for (let a = 1; a < parent.length; a++) { const r = find(a); if (r === a) remap[a] = ++n; }
    for (let a = 1; a < parent.length; a++) remap[a] = remap[find(a)];
    for (let i = 0; i < lab.length; i++) if (lab[i]) lab[i] = remap[lab[i]];
    // boxes: x0,y0,x1,y1,area,sumx,sumy
    const B = new Float64Array((n + 1) * 7);
    for (let c = 1; c <= n; c++) { B[c * 7] = 1e9; B[c * 7 + 1] = 1e9; B[c * 7 + 2] = -1; B[c * 7 + 3] = -1; }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = lab[y * w + x]; if (!c) continue;
      const o = c * 7;
      if (x < B[o]) B[o] = x; if (y < B[o + 1]) B[o + 1] = y; if (x > B[o + 2]) B[o + 2] = x; if (y > B[o + 3]) B[o + 3] = y;
      B[o + 4]++; B[o + 5] += x; B[o + 6] += y;
    }
    return { lab, n, B };
  }

  function smooth(v, sigma) {
    const r = Math.floor(3 * sigma) + 1, k = [];
    let tot = 0;
    for (let i = -r; i <= r; i++) { const e = Math.exp(-0.5 * (i / sigma) ** 2); k.push(e); tot += e; }
    const out = new Float64Array(v.length);
    for (let i = 0; i < v.length; i++) {
      let s = 0;
      for (let j = -r; j <= r; j++) { const ii = i + j; if (ii >= 0 && ii < v.length) s += v[ii] * k[j + r]; }
      out[i] = s / tot;
    }
    return out;
  }

  function median(a) { const s = Array.from(a).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; }

  function lineSpacing(clean, w, h, hMed) {
    const prof = new Float64Array(h);
    for (let y = 0; y < h; y++) { let s = 0; for (let x = 0; x < w; x++) s += clean[y * w + x]; prof[y] = s; }
    const p = smooth(prof, Math.max(1, 0.25 * hMed));
    let mean = 0; for (const v of p) mean += v; mean /= h;
    for (let i = 0; i < h; i++) p[i] -= mean;
    const lo = Math.floor(1.3 * hMed), hi = Math.min(Math.floor(5 * hMed), h - 1);
    if (hi <= lo) return 2 * hMed;
    let ac0 = 0; for (let i = 0; i < h; i++) ac0 += p[i] * p[i];
    let best = lo, bv = -Infinity;
    for (let lag = lo; lag < hi; lag++) {
      let s = 0; for (let i = 0; i + lag < h; i++) s += p[i] * p[i + lag];
      if (s > bv) { bv = s; best = lag; }
    }
    return best;
  }

  function stripPeaks(clean, w, h, S, nStrips) {
    const peaks = [], centres = [];
    for (let k = 0; k < nStrips; k++) {
      const x0 = Math.floor((k * w) / nStrips), x1 = Math.floor(((k + 1) * w) / nStrips);
      centres.push((x0 + x1) / 2);
      const prof = new Float64Array(h);
      for (let y = 0; y < h; y++) { let s = 0; for (let x = x0; x < x1; x++) s += clean[y * w + x]; prof[y] = s; }
      const p = smooth(prof, Math.max(2, S / 6));
      let mx = 0; for (const v of p) if (v > mx) mx = v;
      const cand = [];
      for (let y = 1; y < h - 1; y++) if (p[y] >= p[y - 1] && p[y] > p[y + 1] && p[y] > 0.15 * mx) cand.push(y);
      cand.sort((a, b) => p[b] - p[a]);
      const keep = [];
      for (const y of cand) if (keep.every((q) => Math.abs(y - q) >= 0.55 * S)) keep.push(y);
      peaks.push(keep.sort((a, b) => a - b));
    }
    return { centres, peaks };
  }

  function linkLines(peaks, S) {
    const n = peaks.length, used = peaks.map(() => new Set()), lines = [];
    const order = Array.from(peaks.keys()).sort((a, b) => peaks[b].length - peaks[a].length);
    for (const k0 of order) {
      peaks[k0].forEach((y0, j0) => {
        if (used[k0].has(j0)) return;
        const ys = new Array(n).fill(NaN);
        ys[k0] = y0; used[k0].add(j0);
        for (const dir of [1, -1]) {
          let y = y0, prev = null, k = k0 + dir;
          while (k >= 0 && k < n) {
            const pred = prev === null ? y : y + (y - prev);
            let best = null, bj = -1;
            peaks[k].forEach((yy, j) => {
              if (!used[k].has(j) && Math.abs(yy - pred) < 0.4 * S && (best === null || Math.abs(yy - pred) < Math.abs(best - pred))) { best = yy; bj = j; }
            });
            if (best === null) break;
            ys[k] = best; used[k].add(bj); prev = y; y = best; k += dir;
          }
        }
        lines.push(ys);
      });
    }
    return lines;
  }

  function paths(lines, centres, w) {
    const out = [];
    for (const ys of lines) {
      const xs = [], vs = [];
      ys.forEach((y, k) => { if (!Number.isNaN(y)) { xs.push(centres[k]); vs.push(y); } });
      if (!xs.length) continue;
      const p = new Float32Array(w);
      for (let x = 0; x < w; x++) {
        if (x <= xs[0]) p[x] = vs[0];
        else if (x >= xs[xs.length - 1]) p[x] = vs[vs.length - 1];
        else { let j = 0; while (xs[j + 1] < x) j++; const t = (x - xs[j]) / (xs[j + 1] - xs[j]); p[x] = vs[j] + t * (vs[j + 1] - vs[j]); }
      }
      out.push(p);
    }
    out.sort((a, b) => median(a) - median(b));
    return out;
  }

  function wordsInLine(pix, path, S) {
    const core = pix.filter(([y, x]) => Math.abs(y - path[x]) < 0.3 * S);
    if (core.length < 0.05 * S * S) return [];
    let x0 = Infinity, x1 = -Infinity;
    for (const [, x] of core) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
    const col = new Uint8Array(x1 - x0 + 1);
    for (const [, x] of core) col[x - x0] = 1;
    const segs = [];
    let start = -1;
    for (let i = 0; i <= col.length; i++) {
      const v = i < col.length && col[i];
      if (v && start < 0) start = i;
      if (!v && start >= 0) { segs.push([start + x0, i - 1 + x0]); start = -1; }
    }
    if (segs.length < 2) return segs;
    const gaps = segs.slice(1).map((s, k) => s[0] - segs[k][1]);
    let thr = 0.35 * S;
    if (gaps.length >= 3) {
      let a = Math.min(...gaps), b = Math.max(...gaps);
      for (let it = 0; it < 20; it++) {
        const t = (a + b) / 2, lo = gaps.filter((g) => g <= t), hi = gaps.filter((g) => g > t);
        if (!lo.length || !hi.length) break;
        a = lo.reduce((s, v) => s + v, 0) / lo.length; b = hi.reduce((s, v) => s + v, 0) / hi.length;
      }
      thr = Math.min(0.9 * S, Math.max(0.15 * S, (a + b) / 2));
    }
    const words = [segs[0].slice()];
    gaps.forEach((g, k) => { if (g > thr) words.push(segs[k + 1].slice()); else words[words.length - 1][1] = segs[k + 1][1]; });
    return words;
  }

  /* imgData: ImageData of the (already EXIF-oriented, downscaled) page.
     Returns {lines: [{words: [{box:[x0,y0,x1,y1], pix: [[y, x], ...]}]}], gray, w, h, angle, S}. */
  function segmentPage(imgData) {
    let { width: w, height: h } = imgData;
    let g = grayOf(imgData);
    let m = binarise(inkMap(g, w, h));
    const angle = bestAngle(m, w, h);
    if (Math.abs(angle) > 0.1) {     // rotate the grey page around its centre (bilinear), white fill
      const r = (angle * Math.PI) / 180, s = Math.sin(r), c = Math.cos(r), cx = w / 2, cy = h / 2, g2 = new Float32Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const sx = c * (x - cx) - s * (y - cy) + cx, sy = s * (x - cx) + c * (y - cy) + cy;
        const x0 = Math.floor(sx), y0 = Math.floor(sy);
        if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) { g2[y * w + x] = 255; continue; }
        const fx = sx - x0, fy = sy - y0, i = y0 * w + x0;
        g2[y * w + x] = (g[i] * (1 - fx) + g[i + 1] * fx) * (1 - fy) + (g[i + w] * (1 - fx) + g[i + w + 1] * fx) * fy;
      }
      g = g2;
      m = binarise(inkMap(g, w, h));
    }
    m = removeLines(m, w, h);
    const { lab, n, B } = label(m, w, h);
    const keep = new Uint8Array(n + 1), hts = [];
    for (let c = 1; c <= n; c++) {
      const o = c * 7, x0 = B[o], y0 = B[o + 1], x1 = B[o + 2], y1 = B[o + 3], a = B[o + 4];
      keep[c] = a >= 12 && x0 > 0 && y0 > 0 && x1 < w - 1 && y1 < h - 1 && (y1 - y0) < 0.2 * h && (x1 - x0) < 0.6 * w ? 1 : 0;
      if (keep[c] && a >= 50) hts.push(y1 - y0 + 1);
    }
    const clean = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) if (lab[i] && keep[lab[i]]) clean[i] = 1;
    const hMed = hts.length ? median(hts) : 20;
    const S = lineSpacing(clean, w, h, hMed);
    let inkPx = 0; for (let i = 0; i < w * h; i++) inkPx += m[i];
    const stats = { hMed, inkPx, components: n };
    const nStrips = Math.min(12, Math.max(3, Math.floor(w / Math.max(150, 3 * S))));
    const { centres, peaks } = stripPeaks(clean, w, h, S, nStrips);
    const P = paths(linkLines(peaks, S), centres, w);
    const lines = [];
    if (!P.length) return { lines, gray: g, w, h, angle, S, stats };
    // component -> nearest line at its centre of mass; tall components (touching lines) split per pixel
    const compLine = new Int32Array(n + 1);
    for (let c = 1; c <= n; c++) {
      if (!keep[c]) continue;
      const o = c * 7, cx = Math.min(w - 1, Math.max(0, Math.round(B[o + 5] / B[o + 4]))), cy = B[o + 6] / B[o + 4];
      let best = 0, bd = Infinity;
      P.forEach((p, li) => { const d = Math.abs(p[cx] - cy); if (d < bd) { bd = d; best = li; } });
      compLine[c] = best;
    }
    const perLine = P.map(() => []);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!clean[y * w + x]) continue;
      const c = lab[y * w + x], o = c * 7;
      let li = compLine[c];
      if (B[o + 3] - B[o + 1] + 1 > 1.6 * S) {
        let bd = Infinity;
        P.forEach((p, k) => { const d = Math.abs(p[x] - y); if (d < bd) { bd = d; li = k; } });
      }
      perLine[li].push([y, x]);
    }
    P.forEach((path, li) => {
      const pix = perLine[li];
      if (pix.length < 0.05 * S * S) return;
      const words = [];
      for (const [x0, x1] of wordsInLine(pix, path, S)) {
        const wp = pix.filter(([, x]) => x >= x0 - 0.05 * S && x <= x1 + 0.05 * S);
        if (wp.length < 0.04 * S * S) continue;
        let bx0 = Infinity, by0 = Infinity, bx1 = -1, by1 = -1;
        for (const [y, x] of wp) { if (x < bx0) bx0 = x; if (y < by0) by0 = y; if (x > bx1) bx1 = x; if (y > by1) by1 = y; }
        if (by1 - by0 < 0.18 * S && bx1 - bx0 < 0.6 * S) continue;
        words.push({ box: [bx0, by0, bx1, by1], pix: wp });
      }
      if (words.length) lines.push({ y: median(path), words });
    });
    lines.sort((a, b) => a.y - b.y);
    return { lines, gray: g, w, h, angle, S, stats };
  }

  /* White ImageData containing only the ink of one word (masked, dilated by 2 px) */
  function wordImageData(seg, word, pad = 4) {
    const [x0, y0, x1, y1] = word.box, W = x1 - x0 + 1 + 2 * pad, Hh = y1 - y0 + 1 + 2 * pad;
    const m = new Uint8Array(W * Hh);
    for (const [y, x] of word.pix) {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const yy = y - y0 + pad + dy, xx = x - x0 + pad + dx;
        if (yy >= 0 && yy < Hh && xx >= 0 && xx < W) m[yy * W + xx] = 1;
      }
    }
    const out = new ImageData(W, Hh);
    for (let yy = 0; yy < Hh; yy++) for (let xx = 0; xx < W; xx++) {
      const gy = yy + y0 - pad, gx = xx + x0 - pad, i = yy * W + xx;
      let v = 255;
      if (m[i] && gy >= 0 && gy < seg.h && gx >= 0 && gx < seg.w) v = seg.gray[gy * seg.w + gx];
      out.data[4 * i] = out.data[4 * i + 1] = out.data[4 * i + 2] = v; out.data[4 * i + 3] = 255;
    }
    return out;
  }

  /* Grey ImageData of an image element/canvas with the longest side <= MAX_SIDE. Downscaled with the
     PIL-style antialiased resize (the canvas' own downscaling is noisier and merges words). */
  function pageImageData(source) {
    const sw = source.naturalWidth || source.width, sh = source.naturalHeight || source.height;
    const c = document.createElement('canvas');
    c.width = sw; c.height = sh;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, sw, sh);
    g.drawImage(source, 0, 0);
    let gray = Uint8Array.from(grayOf(g.getImageData(0, 0, sw, sh)));
    const k = Math.min(1, MAX_SIDE / Math.max(sw, sh)), w = Math.round(sw * k), h = Math.round(sh * k);
    if (k < 1) gray = KHTR._pp.resizeBilinear(gray, sw, sh, w, h);
    const out = new ImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      out.data[4 * i] = out.data[4 * i + 1] = out.data[4 * i + 2] = gray[i]; out.data[4 * i + 3] = 255;
    }
    return out;
  }

  root.KHTR = Object.assign(root.KHTR || {}, { segmentPage, wordImageData, pageImageData });
})(typeof window !== 'undefined' ? window : globalThis);
