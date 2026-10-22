/* Kyrgyz HTR — CTC decoding with lexicon re-scoring (browser port of ctc_ensemble.py, single model).
 * Pure functions, no DOM. Mirrored in webapp/tools/web_pipeline.py. */
(function (root) {
  'use strict';
  const NEG = -1e30;

  function logAdd(a, b) {
    if (a === NEG) return b;
    if (b === NEG) return a;
    return a > b ? a + Math.log1p(Math.exp(b - a)) : b + Math.log1p(Math.exp(a - b));
  }

  // lp: Float32Array T*C log-probs (blank = 0). Returns best path collapsed to a string.
  function greedy(lp, T, C, chars) {
    let out = '', prev = 0;
    for (let t = 0; t < T; t++) {
      let best = 0, bv = lp[t * C];
      for (let c = 1; c < C; c++) if (lp[t * C + c] > bv) { bv = lp[t * C + c]; best = c; }
      if (best !== prev && best !== 0) out += chars[best - 1];
      prev = best;
    }
    return out;
  }

  // CTC prefix beam search without LM -> candidate strings
  function prefixBeam(lp, T, C, chars, beam = 8, topk = 4) {
    let beams = new Map([['', [1, 0]]]);  // prefix (ids joined by ',') -> [p_blank, p_nonblank]
    for (let t = 0; t < T; t++) {
      const p = new Float64Array(C);
      for (let c = 0; c < C; c++) p[c] = Math.exp(lp[t * C + c]);
      const order = Array.from(p.keys()).sort((a, b) => p[b] - p[a]).slice(0, topk).filter((c) => c !== 0);
      const nb = new Map();
      const get = (k) => { if (!nb.has(k)) nb.set(k, [0, 0]); return nb.get(k); };
      for (const [pre, [pb, pnb]] of beams) {
        const tot = pb + pnb;
        get(pre)[0] += tot * p[0];
        const ids = pre ? pre.split(',').map(Number) : [];
        for (const c of order) {
          const key = pre ? pre + ',' + c : String(c);
          if (ids.length && ids[ids.length - 1] === c) {
            get(key)[1] += pb * p[c];
            get(pre)[1] += pnb * p[c];
          } else {
            get(key)[1] += tot * p[c];
          }
        }
      }
      const top = Array.from(nb.entries()).sort((a, b) => (b[1][0] + b[1][1]) - (a[1][0] + a[1][1])).slice(0, beam);
      const z = Math.max(top[0][1][0] + top[0][1][1], 1e-300);
      beams = new Map(top.map(([k, v]) => [k, [v[0] / z, v[1] / z]]));
    }
    return Array.from(beams.keys()).map((k) => (k ? k.split(',').map((i) => chars[+i - 1]).join('') : ''));
  }

  // log P(text | image) under CTC (forward algorithm); unknown symbols -> -Infinity
  function ctcLogLik(lp, T, C, ids) {
    const L = 2 * ids.length + 1;
    const lab = new Int32Array(L);
    for (let i = 0; i < ids.length; i++) lab[2 * i + 1] = ids[i];
    let a = new Float64Array(L).fill(NEG);
    a[0] = lp[0];
    if (L > 1) a[1] = lp[lab[1]];
    for (let t = 1; t < T; t++) {
      const b = new Float64Array(L).fill(NEG);
      for (let s = 0; s < L; s++) {
        let v = a[s];
        if (s > 0) v = logAdd(v, a[s - 1]);
        if (s > 1 && lab[s] !== 0 && lab[s] !== lab[s - 2]) v = logAdd(v, a[s - 2]);
        b[s] = v === NEG ? NEG : v + lp[t * C + lab[s]];
      }
      a = b;
    }
    const r = L > 1 ? logAdd(a[L - 1], a[L - 2]) : a[L - 1];
    return r <= NEG / 2 ? -Infinity : r;
  }

  // Levenshtein distance with early exit when it must exceed maxD
  function editDist(a, b, maxD) {
    if (Math.abs(a.length - b.length) > maxD) return maxD + 1;
    let prev = new Int32Array(b.length + 1), cur = new Int32Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
      cur[0] = i; let rowMin = i;
      for (let j = 1; j <= b.length; j++) {
        const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        cur[j] = v; if (v < rowMin) rowMin = v;
      }
      if (rowMin > maxD) return maxD + 1;
      [prev, cur] = [cur, prev];
    }
    return prev[b.length];
  }

  /* Lexicon: text "WORD\tlogp\n..." (upper case) -> {byLen: Map(len -> [words]), logp: Map(word -> logp)} */
  function parseLexicon(text) {
    const byLen = new Map(), logp = new Map();
    for (const line of text.split('\n')) {
      const tab = line.indexOf('\t');
      if (tab < 1) continue;
      const w = line.slice(0, tab), v = parseFloat(line.slice(tab + 1));
      logp.set(w, v);
      if (!byLen.has(w.length)) byLen.set(w.length, []);
      byLen.get(w.length).push(w);
    }
    return { byLen, logp };
  }

  const TOKEN_RE = /[^\s\d.\-]+(?:-[^\s\d.\-]+)*/gu;  // words (letters, internal hyphens)

  function lexiconVariants(text, lex, maxD = 2) {
    const out = new Set();
    for (const m of text.matchAll(TOKEN_RE)) {
      const w = m[0];
      for (let L = w.length - maxD; L <= w.length + maxD; L++) {
        for (const cand of lex.byLen.get(L) || []) {
          if (editDist(w, cand, maxD) <= maxD) out.add(text.slice(0, m.index) + cand + text.slice(m.index + w.length));
        }
      }
    }
    return out;
  }

  function prior(text, lex, gamma) {
    let s = 0;
    for (const m of text.matchAll(TOKEN_RE)) s += lex.logp.has(m[0]) ? lex.logp.get(m[0]) : gamma;
    return s;
  }

  /* Full decode. cfg = {nu, beta, gamma}. Returns [{text, score, ctc, prior, prob}] best first. */
  function decode(lp, T, C, chars, lex, cfg) {
    const index = new Map(chars.map((c, i) => [c, i + 1]));
    const cands = new Set([greedy(lp, T, C, chars), ...prefixBeam(lp, T, C, chars)]);
    const scoreCtc = (t) => {
      const ids = [];
      for (const ch of t) { if (!index.has(ch)) return -Infinity; ids.push(index.get(ch)); }
      return ctcLogLik(lp, T, C, ids);
    };
    const base = Array.from(cands).filter((t) => t.length).map((t) => ({ text: t, ctc: scoreCtc(t) }));
    base.sort((a, b) => b.ctc - a.ctc);
    if (lex) {
      for (const b of base.slice(0, 3)) for (const v of lexiconVariants(b.text, lex)) cands.add(v);
    }
    const res = [];
    for (const t of cands) {
      if (!t.length) continue;
      const ctc = scoreCtc(t);
      if (ctc === -Infinity) continue;
      const pr = lex ? prior(t, lex, cfg.gamma) : 0;
      res.push({ text: t, ctc, prior: pr, score: ctc + (lex ? cfg.nu * pr : 0) + cfg.beta * t.length });
    }
    res.sort((a, b) => b.score - a.score);
    const m = res.length ? res[0].score : 0;
    let z = 0;
    for (const r of res) z += Math.exp(r.score - m);
    for (const r of res) r.prob = Math.exp(r.score - m) / z;
    return res;
  }

  root.KHTR = Object.assign(root.KHTR || {}, { decode, parseLexicon, _dec: { greedy, prefixBeam, ctcLogLik, editDist, lexiconVariants } });
})(typeof window !== 'undefined' ? window : globalThis);
