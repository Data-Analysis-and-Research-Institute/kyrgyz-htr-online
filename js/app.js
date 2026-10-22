/* Recognition page: draw, photograph or pick an example word and recognise it in the browser. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const rec = new KHTR.Recognizer('model/');
  let ready = false, busy = false, pending = null;
  let last = null;            // {imageData, expected} of the last recognition (re-run when the switch changes)

  const status = (t) => { $('status').textContent = t; };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };

  function show(r, expected) {
    $('expected').textContent = '';
    if (!r || !r.results.length) { $('result').textContent = '—'; $('alts').innerHTML = ''; return; }
    const [best, ...rest] = r.results;
    const text = best.text.toLowerCase();
    $('result').textContent = text;
    if (expected) {
      const ok = text === expected.toLowerCase();
      $('expected').innerHTML = `Expected: <b>${expected}</b> <span class="${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'}</span>`;
    }
    $('alts').innerHTML = '';
    for (const a of rest.slice(0, 5)) {
      const li = document.createElement('li');
      li.textContent = `${a.text.toLowerCase()} · ${(a.prob * 100).toFixed(0)}%`;
      $('alts').appendChild(li);
    }
    status(`Best guess ${(best.prob * 100).toFixed(0)}% · ` + (r.usedLexicon ? 'with word-list correction'
      : $('use-lexicon').checked ? 'model only (word list still loading)' : 'model only, no word list'));
    KHTR.drawPreview($('preview'), r.preview);
    $('timing').textContent = `${r.ms} ms`;
  }

  async function run(imageData, expected = null) {
    last = { imageData, expected };
    if (!ready) { pending = last; status('Loading model…'); return; }
    if (busy) { pending = last; return; }
    busy = true;
    try {
      const r = await rec.recognize(imageData, $('use-lexicon').checked);
      if (!r) { status('No ink found — write or crop a word.'); show(null); } else show(r, expected);
    } catch (e) { status('Error: ' + e.message); console.error(e); }
    busy = false;
    if (pending) { const p = pending; pending = null; run(p.imageData, p.expected); }
  }

  // ---- word-list switch -----------------------------------------------------------------------
  function updateMode() {
    const on = $('use-lexicon').checked;
    $('mode-note').textContent = on
      ? 'candidates are re-scored with a 100k-word Kyrgyz corpus'
      : "the model's own reading: no letter substitution, no corpus words";
    store.set('khtr_use_lexicon', on);
  }
  $('use-lexicon').checked = store.get('khtr_use_lexicon', true);
  updateMode();
  $('use-lexicon').onchange = () => { updateMode(); if (last) run(last.imageData, last.expected); };

  // ---- drawing ------------------------------------------------------------------------------
  let timer = null;
  const ink = new KHTR.InkCanvas($('draw'), {
    height: 220,
    onStrokeEnd: () => { clearTimeout(timer); timer = setTimeout(recognizeDrawing, 600); },
  });
  function recognizeDrawing() {
    const c = ink.renderCrop(1, 12);
    if (!c) { show(null); return; }
    run(KHTR.toImageData(c));
  }
  document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('[data-preset]').forEach((x) => x.classList.remove('selected'));
    b.classList.add('selected');
    ink.setStyle(b.dataset.preset);
  }));
  $('clear').onclick = () => { ink.clear(); last = null; show(null); };
  $('undo').onclick = () => { ink.undo(); recognizeDrawing(); };

  // ---- tabs -----------------------------------------------------------------------------------
  function tab(name) {
    $('pane-draw').hidden = name !== 'draw'; $('pane-photo').hidden = name !== 'photo';
    $('tab-draw').classList.toggle('selected', name === 'draw'); $('tab-photo').classList.toggle('selected', name === 'photo');
    if (name === 'draw') ink.resize();
  }
  $('tab-draw').onclick = () => tab('draw');
  $('tab-photo').onclick = () => tab('photo');

  // ---- photo + crop ---------------------------------------------------------------------------
  let img = null, sel = null, drag = null, imgExpected = null;
  const pc = $('photo');
  function drawPhoto() {
    if (!img) return;
    const g = pc.getContext('2d');
    g.drawImage(img, 0, 0, pc.width, pc.height);
    if (sel && sel.w > 4 && sel.h > 4) {
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(0, 0, pc.width, sel.y); g.fillRect(0, sel.y + sel.h, pc.width, pc.height - sel.y - sel.h);
      g.fillRect(0, sel.y, sel.x, sel.h); g.fillRect(sel.x + sel.w, sel.y, pc.width - sel.x - sel.w, sel.h);
      g.strokeStyle = '#1d5fd6'; g.lineWidth = 2; g.strokeRect(sel.x, sel.y, sel.w, sel.h);
    }
  }
  function showPhoto(im, expected = null) {
    img = im; sel = null; imgExpected = expected;
    const s = Math.min(1, 1600 / Math.max(im.width, im.height));  // display copy, max 1600 px
    pc.width = Math.round(im.width * s); pc.height = Math.round(im.height * s);
    pc.hidden = false; $('recognize-photo').disabled = false;
    drawPhoto();
  }
  function recognizePhoto() {
    if (!img) return;
    const k = img.width / pc.width;
    const s = sel && sel.w > 4 && sel.h > 4 ? sel : { x: 0, y: 0, w: pc.width, h: pc.height };
    run(KHTR.toImageData(img, s.x * k, s.y * k, s.w * k, s.h * k), sel ? null : imgExpected);
  }
  $('file').onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const im = new Image();
    im.onload = () => { document.querySelectorAll('#examples button').forEach((x) => x.classList.remove('selected')); showPhoto(im); };
    im.src = URL.createObjectURL(f);
  };
  const pos = (e) => { const r = pc.getBoundingClientRect(); return { x: (e.clientX - r.left) * pc.width / r.width, y: (e.clientY - r.top) * pc.height / r.height }; };
  pc.addEventListener('pointerdown', (e) => { if (!img) return; pc.setPointerCapture(e.pointerId); drag = pos(e); sel = null; });
  pc.addEventListener('pointermove', (e) => {
    if (!drag) return; const p = pos(e);
    sel = { x: Math.min(drag.x, p.x), y: Math.min(drag.y, p.y), w: Math.abs(p.x - drag.x), h: Math.abs(p.y - drag.y) };
    drawPhoto();
  });
  pc.addEventListener('pointerup', () => { drag = null; });
  $('recognize-photo').onclick = recognizePhoto;

  // ---- example gallery ------------------------------------------------------------------------
  fetch('examples/examples.json').then((r) => r.json()).then((list) => {
    for (const ex of list) {
      const b = document.createElement('button');
      b.title = ex.text;
      b.innerHTML = `<img src="${ex.file}" alt="${ex.text}" loading="lazy"><small>${ex.style}</small>`;
      b.onclick = () => {
        document.querySelectorAll('#examples button').forEach((x) => x.classList.remove('selected'));
        b.classList.add('selected');
        const im = new Image();
        im.onload = () => { tab('photo'); showPhoto(im, ex.text); recognizePhoto(); };
        im.src = ex.file;
      };
      $('examples').appendChild(b);
    }
  }).catch(() => { $('examples').textContent = 'Examples could not be loaded.'; });

  // ---- load model -----------------------------------------------------------------------------
  rec.load(status).then(() => {
    ready = true;
    if (pending) { const p = pending; pending = null; run(p.imageData, p.expected); }
    fetch('model/decoder_config.json').then((r) => r.json()).then((c) => {
      if (c.test) $('acc').textContent = `≈ ${c.test.word_acc.toFixed(0)} % of words, ${c.test.cer.toFixed(1)} % character error`;
    });
  }).catch((e) => status('Could not load the model: ' + e.message));
})();
