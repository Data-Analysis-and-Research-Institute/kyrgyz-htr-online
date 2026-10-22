/* Kyrgyz HTR — in-browser recogniser: ONNX CTC model (onnxruntime-web) + lexicon re-scoring.
 * Requires preprocess.js, decoder.js and the onnxruntime-web script (global `ort`). */
(function (root) {
  'use strict';
  const ORT_VERSION = '1.18.0';

  class Recognizer {
    constructor(base = 'model/') { this.base = base; this.lex = null; }

    async load(onStatus = () => {}) {
      ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
      onStatus('Loading model…');
      const [charset, cfg] = await Promise.all([
        fetch(this.base + 'charset.json').then((r) => r.json()),
        fetch(this.base + 'decoder_config.json').then((r) => r.json()),
      ]);
      this.chars = charset.chars;
      this.cfg = cfg;
      this.session = await ort.InferenceSession.create(this.base + 'kyrgyz_ctc_lstm.onnx', { executionProviders: ['wasm'] });
      onStatus('Loading word list…');
      // the lexicon is optional: recognition works without it (greedy CTC), just less accurately
      this.lexPromise = fetch(this.base + 'lexicon.tsv').then((r) => r.text())
        .then((t) => { this.lex = KHTR.parseLexicon(t); onStatus('Ready'); })
        .catch(() => onStatus('Ready (no word list)'));
      return this;
    }

    /* imageData: ImageData (RGBA). useLexicon=false: the model's own reading only (greedy + beam
       candidates ranked by CTC probability, no corpus words / letter substitution).
       Returns {results:[{text, prob, ...}], preview, ms, usedLexicon} or null (no ink). */
    async recognize(imageData, useLexicon = true) {
      const t0 = performance.now();
      const pre = KHTR.preprocess(imageData.data, imageData.width, imageData.height);
      if (!pre) return null;
      const input = new ort.Tensor('float32', pre.data, [1, 1, 64, pre.width]);
      const out = await this.session.run({ image: input });
      const lp = out.logprobs;
      const [, T, C] = lp.dims;
      const lex = useLexicon ? this.lex : null;
      const results = KHTR.decode(lp.data, T, C, this.chars, lex, this.cfg);
      return { results, preview: pre, ms: Math.round(performance.now() - t0), usedLexicon: !!lex };
    }
  }

  /* Downscale an image/canvas so that it is at most maxW x maxH, return ImageData */
  function toImageData(source, sx = 0, sy = 0, sw = null, sh = null, maxW = 900, maxH = 300) {
    sw = sw || source.width; sh = sh || source.height;
    const s = Math.min(1, maxW / sw, maxH / sh);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sw * s)); c.height = Math.max(1, Math.round(sh * s));
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.imageSmoothingQuality = 'high';
    g.drawImage(source, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return g.getImageData(0, 0, c.width, c.height);
  }

  /* Draw the 64-px model input (ink map) into a canvas for display */
  function drawPreview(canvas, pre) {
    canvas.width = pre.width; canvas.height = 64;
    const g = canvas.getContext('2d'), img = g.createImageData(pre.width, 64);
    for (let i = 0; i < pre.width * 64; i++) {
      const v = 255 - pre.ink[i];
      img.data[4 * i] = img.data[4 * i + 1] = img.data[4 * i + 2] = v; img.data[4 * i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }

  root.KHTR = Object.assign(root.KHTR || {}, { Recognizer, toImageData, drawPreview });
})(typeof window !== 'undefined' ? window : globalThis);
