/* Full-page recognition: segment a page photo (or a multi-line drawing) into words and read each word. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const rec = new KHTR.Recognizer('model/');
  // model-loading messages only replace other loading messages, never a result or an error
  const loaded = rec.load((t) => { if (/^(Loading|Ready)/.test($('status').textContent)) $('status').textContent = t; });
  let running = false, current = null;   // current = {seg, words: [{box, line, results}]}
  const COLORS = ['#d33', '#1a7f37', '#1f6feb', '#b35900', '#8250df', '#0a7f8f'];

  const status = (t) => { $('status').textContent = t; };
  const tick = () => new Promise((r) => setTimeout(r, 0));

  // ---- tabs --------------------------------------------------------------------------------
  function tab(name) {
    $('tab-photo').classList.toggle('selected', name === 'photo');
    $('tab-draw').classList.toggle('selected', name === 'draw');
    $('pane-photo').hidden = name !== 'photo';
    $('pane-draw').hidden = name !== 'draw';
    if (name === 'draw') ink.resize && ink.resize();
  }
  $('tab-photo').onclick = () => tab('photo');
  $('tab-draw').onclick = () => tab('draw');

  // ---- inputs ------------------------------------------------------------------------------
  $('file').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const img = new Image();               // <img> applies the EXIF orientation when drawn
    img.src = URL.createObjectURL(f);
    await img.decode();
    runPage(KHTR.pageImageData(img));
  };

  const ink = new KHTR.InkCanvas($('draw'), { height: 420 });
  $('clear').onclick = () => ink.clear();
  $('undo').onclick = () => ink.undo();
  $('recognize-draw').onclick = () => {
    const c = ink.renderCrop(1, 24);
    if (!c) { $('out').hidden = false; status('Nothing written yet.'); return; }
    runPage(KHTR.pageImageData(c));
  };
  $('use-lexicon').onchange = () => { if (current && !running) readWords(current); };

  // ---- pipeline ----------------------------------------------------------------------------
  async function runPage(imgData) {
    if (running) return;
    running = true;
    $('out').hidden = false;
    $('text').value = ''; $('word-info').textContent = '';
    setBar(0);
    try {
      status('Finding lines and words…');
      await tick();
      const t0 = performance.now();
      const seg = KHTR.segmentPage(imgData);
      const words = [];
      seg.lines.forEach((l, li) => l.words.forEach((w) => words.push({ box: w.box, pix: w.pix, line: li, results: null })));
      current = { seg, words, imgData, tSeg: Math.round(performance.now() - t0) };
      drawOverlay();
      if (!words.length) { status('No text lines found. Try a closer, sharper photo with dark ink.'); return; }
      await readWords(current, true);
    } catch (e) { status('Error: ' + e.message); console.error(e); }
    finally { running = false; }
  }

  async function readWords(cur, fresh = false) {
    running = true;
    try {
      status('Loading model…');
      await loaded;
      const useLex = $('use-lexicon').checked;
      const t0 = performance.now();
      for (let i = 0; i < cur.words.length; i++) {
        const w = cur.words[i];
        if (!w.image) w.image = KHTR.wordImageData(cur.seg, w);
        const r = await rec.recognize(w.image, useLex);
        w.results = r ? r.results : [];
        setBar((i + 1) / cur.words.length);
        if (i % 4 === 3 || i === cur.words.length - 1) {
          status(`Reading words ${i + 1} / ${cur.words.length}…`);
          $('text').value = transcript(cur);
          drawOverlay();
          await tick();
        }
      }
      const s = cur.seg;
      status(`${s.lines.length} lines, ${cur.words.length} words · straightened ${s.angle.toFixed(2)}° · `
        + `segmentation ${cur.tSeg} ms, reading ${Math.round(performance.now() - t0)} ms`
        + (useLex ? '' : ' · model only, no word list') + (fresh ? '' : ' (re-read)'));
    } finally { running = false; }
  }

  function best(w) { return w.results && w.results.length ? w.results[0].text.toLowerCase() : (w.results ? '?' : '…'); }

  function transcript(cur) {
    const lines = [];
    for (const w of cur.words) (lines[w.line] = lines[w.line] || []).push(best(w));
    return lines.filter(Boolean).map((l) => l.join(' ')).join('\n');
  }

  function setBar(f) { $('bar').style.width = `${Math.round(f * 100)}%`; }

  // ---- overlay -----------------------------------------------------------------------------
  let selected = -1;
  function drawOverlay() {
    const { seg, words } = current, cv = $('overlay'), g = cv.getContext('2d');
    cv.width = seg.w; cv.height = seg.h;
    const img = g.createImageData(seg.w, seg.h);
    for (let i = 0; i < seg.w * seg.h; i++) {
      const v = seg.gray[i];
      img.data[4 * i] = img.data[4 * i + 1] = img.data[4 * i + 2] = v; img.data[4 * i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const lw = Math.max(2, seg.w / 600), fs = Math.max(12, Math.round(seg.S * 0.45));
    g.font = `${fs}px system-ui, sans-serif`;
    words.forEach((w, i) => {
      const [x0, y0, x1, y1] = w.box, col = COLORS[w.line % COLORS.length];
      g.strokeStyle = col; g.lineWidth = i === selected ? lw * 2.5 : lw;
      g.strokeRect(x0 - 2, y0 - 2, x1 - x0 + 4, y1 - y0 + 4);
      if (w.results) {
        const t = best(w), tw = g.measureText(t).width;
        g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(x0 - 2, y0 - fs - 4, tw + 6, fs + 2);
        g.fillStyle = col; g.fillText(t, x0 + 1, y0 - 5);
      }
    });
  }

  $('overlay').onclick = (e) => {
    if (!current) return;
    const cv = $('overlay'), r = cv.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * cv.width, y = ((e.clientY - r.top) / r.height) * cv.height;
    selected = current.words.findIndex((w) => x >= w.box[0] - 4 && x <= w.box[2] + 4 && y >= w.box[1] - 4 && y <= w.box[3] + 4);
    drawOverlay();
    const w = current.words[selected];
    if (!w || !w.results) { $('word-info').textContent = ''; return; }
    $('word-info').innerHTML = '';
    const c = document.createElement('canvas');
    c.width = w.image.width; c.height = w.image.height;
    c.getContext('2d').putImageData(w.image, 0, 0);
    c.className = 'preview';
    $('word-info').appendChild(c);
    const ul = document.createElement('ul');
    ul.className = 'alts';
    for (const a of w.results.slice(0, 6)) {
      const li = document.createElement('li');
      li.textContent = `${a.text.toLowerCase()} · ${(a.prob * 100).toFixed(0)}%`;
      ul.appendChild(li);
    }
    $('word-info').appendChild(ul);
  };

  $('copy').onclick = () => { navigator.clipboard && navigator.clipboard.writeText($('text').value); };

  // test hook
  window.KHTR_PAGE = { runPage, get current() { return current; }, get running() { return running; } };
})();
