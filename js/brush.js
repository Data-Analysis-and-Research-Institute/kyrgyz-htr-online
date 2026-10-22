/* Kyrgyz HTR — handwriting canvas with brush simulation.
 *  pen   : ballpoint-like, almost constant width
 *  brush : flat calligraphic nib -> bold strokes with sharp edges (thick/thin by direction and speed)
 *  ink   : crisp core + soft halo that spreads more where the hand moves slowly (ink diffusion)
 * Strokes are kept as vectors (x, y, t, pressure, width, slowness) so the drawing can be re-rendered,
 * undone, exported as PNG and saved as raw stroke data. */
(function (root) {
  'use strict';

  const PRESETS = {
    pen: { label: 'Pen', minW: 1.5, maxW: 2.6, nib: 0, nibAngle: 0, diffusion: 0, color: '#1b1b22' },
    brush: { label: 'Brush', minW: 2.0, maxW: 10, nib: 0.22, nibAngle: -Math.PI / 4, diffusion: 0, color: '#121212' },
    ink: { label: 'Ink', minW: 2.4, maxW: 7.5, nib: 0, nibAngle: 0, diffusion: 1, color: '#16205c' },
  };
  const INK_COLORS = ['#121212', '#1b1b22', '#16205c', '#1d2f7a', '#2a2a2a'];

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  class InkCanvas {
    constructor(canvas, opts = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.core = document.createElement('canvas');
      this.halo = document.createElement('canvas');
      this.strokes = [];
      this.cur = null;
      this.onStrokeEnd = opts.onStrokeEnd || null;
      this.height = opts.height || 220;
      this.filterOk = 'filter' in this.ctx;
      this.setStyle(opts.preset || 'pen', opts.style);
      canvas.style.touchAction = 'none';
      canvas.addEventListener('pointerdown', (e) => this._down(e));
      canvas.addEventListener('pointermove', (e) => this._move(e));
      ['pointerup', 'pointercancel', 'pointerleave'].forEach((n) => canvas.addEventListener(n, (e) => this._up(e)));
      this._ro = new ResizeObserver(() => this.resize());
      this._ro.observe(canvas);
      this.resize();
    }

    /* preset: 'pen' | 'brush' | 'ink'; style: {widthScale, color} (randomised for data collection) */
    setStyle(preset, style = {}) {
      this.preset = PRESETS[preset] ? preset : 'pen';
      this.style = { widthScale: style.widthScale || 1, color: style.color || PRESETS[this.preset].color };
    }

    randomStyle() {
      const names = Object.keys(PRESETS);
      const preset = names[Math.floor(Math.random() * names.length)];
      this.setStyle(preset, { widthScale: 0.8 + Math.random() * 0.5,
                              color: INK_COLORS[Math.floor(Math.random() * INK_COLORS.length)] });
      return { preset: this.preset, ...this.style };
    }

    resize() {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(this.canvas.clientWidth));
      const h = this.height;
      this.canvas.style.height = h + 'px';
      if (this.cssW === w && this.dpr === dpr) return;
      this.cssW = w; this.cssH = h; this.dpr = dpr;
      for (const c of [this.canvas, this.core, this.halo]) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
      this.redraw();
    }

    clear() { this.strokes = []; this.cur = null; this.redraw(); }
    undo() { this.strokes.pop(); this.redraw(); }
    isEmpty() { return this.strokes.length === 0; }

    // ---- input ---------------------------------------------------------------------------
    _pos(e) {
      const r = this.canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top, t: e.timeStamp, p: e.pressure };
    }

    _down(e) {
      if (e.button > 0) return;
      e.preventDefault();
      try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* not capturable: draw anyway */ }
      const P = PRESETS[this.preset];
      this.cur = { preset: this.preset, color: this.style.color, widthScale: this.style.widthScale,
                   pointerType: e.pointerType, points: [], P };
      this._add(this._pos(e), e.pointerType);
      this._renderTail(false);
    }

    _move(e) {
      if (!this.cur) return;
      e.preventDefault();
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of evs.length ? evs : [e]) this._add(this._pos(ev), e.pointerType);
      this._renderTail(false);
    }

    _up() {
      if (!this.cur) return;
      this._renderTail(true);
      this.strokes.push(this.cur);
      this.cur = null;
      this._composite();
      if (this.onStrokeEnd) this.onStrokeEnd();
    }

    _add(q, pointerType) {
      const s = this.cur, pts = s.points, P = s.P, k = s.widthScale;
      const last = pts[pts.length - 1];
      if (last && Math.hypot(q.x - last.x, q.y - last.y) < 0.6) return;
      let target, slow = 0.5;
      if (last) {
        const dt = Math.max(1, q.t - last.t);
        const speed = Math.hypot(q.x - last.x, q.y - last.y) / dt;   // px per ms
        slow = clamp(1 - speed / 1.6, 0, 1);                         // 1 = slow
      }
      if (pointerType === 'pen' && q.p > 0) target = P.minW + (P.maxW - P.minW) * Math.pow(clamp(q.p, 0, 1), 0.8);
      else target = P.minW + (P.maxW - P.minW) * slow;                // slow strokes are bolder
      const w = last ? 0.65 * last.w + 0.35 * target * k : target * k;
      const s_ = last ? 0.7 * last.s + 0.3 * slow : slow;
      pts.push({ x: q.x, y: q.y, t: q.t, p: q.p, w, s: s_ });
    }

    // ---- rendering -----------------------------------------------------------------------
    _stamp(cc, hc, x, y, w, s, st, scale) {
      const P = PRESETS[st.preset];
      cc.fillStyle = st.color;
      cc.beginPath();
      if (P.nib > 0) cc.ellipse(x * scale, y * scale, (w / 2) * scale, Math.max(0.55, (w * P.nib) / 2) * scale, P.nibAngle, 0, Math.PI * 2);
      else cc.arc(x * scale, y * scale, Math.max(0.5, w / 2) * scale, 0, Math.PI * 2);
      cc.fill();
      if (P.diffusion > 0 && hc) {
        hc.fillStyle = st.color;
        hc.globalAlpha = 0.018 + 0.03 * s;               // more ink where the pen lingers
        hc.beginPath();
        hc.arc(x * scale, y * scale, (w / 2) * (1.12 + 0.55 * s) * scale + 0.6 * scale, 0, Math.PI * 2);
        hc.fill();
        hc.globalAlpha = 1;
      }
    }

    // segment i of a stroke, smoothed with quadratic curves between midpoints of consecutive points
    _segment(cc, hc, st, i, scale) {
      const p = st.points;
      if (i === 0) { this._stamp(cc, hc, p[0].x, p[0].y, p[0].w, p[0].s, st, scale); return; }
      const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, w: (a.w + b.w) / 2, s: (a.s + b.s) / 2 });
      if (i === 1) this._curve(cc, hc, st, p[0], p[0], mid(p[0], p[1]), scale);
      else this._curve(cc, hc, st, mid(p[i - 2], p[i - 1]), p[i - 1], mid(p[i - 1], p[i]), scale);
    }

    // closing piece from the last midpoint to the last point (drawn once, when the stroke ends)
    _tail(cc, hc, st, scale) {
      const p = st.points, n = p.length;
      if (n < 2) return;
      const a = p[n - 2], b = p[n - 1];
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, w: (a.w + b.w) / 2, s: (a.s + b.s) / 2 };
      this._curve(cc, hc, st, m, b, b, scale);
    }

    _curve(cc, hc, st, a, c, b, scale) {
      const len = Math.hypot(c.x - a.x, c.y - a.y) + Math.hypot(b.x - c.x, b.y - c.y);
      const n = Math.max(1, Math.ceil(len / 0.6));
      for (let k = 0; k <= n; k++) {
        const t = k / n, u = 1 - t;
        const x = u * u * a.x + 2 * u * t * c.x + t * t * b.x;
        const y = u * u * a.y + 2 * u * t * c.y + t * t * b.y;
        this._stamp(cc, hc, x, y, a.w + (b.w - a.w) * t, a.s + (b.s - a.s) * t, st, scale);
      }
    }

    // incremental drawing while the pen moves: newest segment only; on pen-up: the closing tail only
    _renderTail(final) {
      const st = this.cur, n = st.points.length;
      if (st.drawn === n && !final) return;
      const cc = this.core.getContext('2d'), hc = this.halo.getContext('2d');
      if (final) this._tail(cc, hc, st, this.dpr);
      else { for (let i = st.drawn || 0; i < n; i++) this._segment(cc, hc, st, i, this.dpr); st.drawn = n; }
      this._composite();
    }

    _renderStroke(cc, hc, st, scale) {
      for (let i = 0; i < st.points.length; i++) this._segment(cc, hc, st, i, scale);
      this._tail(cc, hc, st, scale);
    }

    _composite(target = this.ctx, core = this.core, halo = this.halo, scale = this.dpr) {
      const W = target.canvas.width, H = target.canvas.height;
      target.save();
      target.globalAlpha = 1;
      target.fillStyle = '#ffffff';
      target.fillRect(0, 0, W, H);
      if (this.filterOk) target.filter = `blur(${0.9 * scale}px)`;
      target.drawImage(halo, 0, 0);
      target.filter = 'none';
      target.drawImage(core, 0, 0);
      target.restore();
    }

    redraw() {
      const cc = this.core.getContext('2d'), hc = this.halo.getContext('2d');
      cc.clearRect(0, 0, this.core.width, this.core.height);
      hc.clearRect(0, 0, this.halo.width, this.halo.height);
      for (const st of this.strokes) this._renderStroke(cc, hc, { ...st, P: PRESETS[st.preset] }, this.dpr);
      this._composite();
    }

    // ---- export --------------------------------------------------------------------------
    inkBox(margin = 12) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const st of this.strokes) for (const p of st.points) {
        const r = p.w * 1.5;
        x0 = Math.min(x0, p.x - r); y0 = Math.min(y0, p.y - r); x1 = Math.max(x1, p.x + r); y1 = Math.max(y1, p.y + r);
      }
      if (x0 === Infinity) return null;
      return { x: Math.max(0, Math.floor(x0 - margin)), y: Math.max(0, Math.floor(y0 - margin)),
               w: Math.ceil(Math.min(this.cssW, x1 + margin) - Math.max(0, x0 - margin)),
               h: Math.ceil(Math.min(this.cssH, y1 + margin) - Math.max(0, y0 - margin)) };
    }

    /* Render the strokes at `scale` (1 = CSS pixels) on white, cropped to the ink. Returns a canvas or null. */
    renderCrop(scale = 1, margin = 12) {
      const box = this.inkBox(margin);
      if (!box) return null;
      const mk = () => { const c = document.createElement('canvas'); c.width = Math.ceil(box.w * scale); c.height = Math.ceil(box.h * scale); return c; };
      const out = mk(), core = mk(), halo = mk();
      const cc = core.getContext('2d'), hc = halo.getContext('2d');
      cc.translate(-box.x * scale, -box.y * scale); hc.translate(-box.x * scale, -box.y * scale);
      for (const st of this.strokes) this._renderStroke(cc, hc, { ...st, P: PRESETS[st.preset] }, scale);
      this._composite(out.getContext('2d'), core, halo, scale);
      return out;
    }

    strokeData() {
      const r1 = (v) => Math.round(v * 10) / 10;
      return { canvas: { width: this.cssW, height: this.cssH },
               strokes: this.strokes.map((st) => ({ preset: st.preset, color: st.color, widthScale: r1(st.widthScale),
                 pointerType: st.pointerType,
                 points: st.points.map((p) => [r1(p.x), r1(p.y), Math.round(p.t), Math.round(p.p * 100) / 100, r1(p.w)]) })) };
    }
  }

  root.KHTR = Object.assign(root.KHTR || {}, { InkCanvas, BRUSH_PRESETS: PRESETS });
})(typeof window !== 'undefined' ? window : globalThis);
