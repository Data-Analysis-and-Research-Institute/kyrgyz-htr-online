/* Recognition page: draw or photograph a word, recognise it in the browser. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const rec = new KHTR.Recognizer('model/');
  let ready = false, busy = false, pending = false;

  const status = (t) => { $('status').textContent = t; };

  function show(r) {
    if (!r || !r.results.length) { $('result').textContent = '—'; $('alts').innerHTML = ''; return; }
    const [best, ...rest] = r.results;
    $('result').textContent = best.text.toLowerCase();
    $('alts').innerHTML = '';
    for (const a of rest.slice(0, 5)) {
      const li = document.createElement('li');
      li.textContent = `${a.text.toLowerCase()} · ${(a.prob * 100).toFixed(0)}%`;
      $('alts').appendChild(li);
    }
    status(`Best guess ${(best.prob * 100).toFixed(0)}% ${r.usedLexicon ? '' : '(word list still loading)'}`);
    KHTR.drawPreview($('preview'), r.preview);
    $('timing').textContent = `${r.ms} ms`;
  }

  async function run(imageData) {
    if (!ready) return;
    if (busy) { pending = imageData; return; }
    busy = true;
    try {
      const r = await rec.recognize(imageData);
      if (!r) status('No ink found — write or crop a word.'); else show(r);
    } catch (e) { status('Error: ' + e.message); console.error(e); }
    busy = false;
    if (pending) { const p = pending; pending = null; run(p); }
  }

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
  $('clear').onclick = () => { ink.clear(); show(null); };
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
  let img = null, sel = null, drag = null;
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
  $('file').onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const im = new Image();
    im.onload = () => {
      img = im; sel = null;
      const s = Math.min(1, 1600 / Math.max(im.width, im.height));  // display copy, max 1600 px
      pc.width = Math.round(im.width * s); pc.height = Math.round(im.height * s);
      pc.hidden = false; $('recognize-photo').disabled = false;
      drawPhoto();
    };
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
  $('recognize-photo').onclick = () => {
    if (!img) return;
    const k = img.width / pc.width;
    const s = sel && sel.w > 4 && sel.h > 4 ? sel : { x: 0, y: 0, w: pc.width, h: pc.height };
    run(KHTR.toImageData(img, s.x * k, s.y * k, s.w * k, s.h * k));
  };

  // ---- load model -----------------------------------------------------------------------------
  rec.load(status).then(() => {
    ready = true;
    fetch('model/decoder_config.json').then((r) => r.json()).then((c) => {
      if (c.test) $('acc').textContent = `≈ ${c.test.word_acc.toFixed(0)} % of words, ${c.test.cer.toFixed(1)} % character error`;
    });
  }).catch((e) => status('Could not load the model: ' + e.message));
})();
