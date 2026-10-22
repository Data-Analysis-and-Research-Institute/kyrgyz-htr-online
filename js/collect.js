/* Collection page: consent -> random weighted prompts -> canvas -> Firestore (or local demo mode).
 * Each submission stores the rendered PNG (cropped to the ink), the raw strokes (JSON), the brush style,
 * the prompt and what was actually written, and the in-browser model's reading of it. */
import { signIn, loadFirebase } from './fb.js';

const S = window.COLLECTION_SETTINGS;
const $ = (id) => document.getElementById(id);
const PRIORITY_WEIGHT = { 1: 3, 2: 2, 3: 1 };
const APP_VERSION = 'collect-1.1';

let fb = null;            // {db, uid, fs, user} when Firebase is configured (Google sign-in)
let writerId = null;
let prompts = [];
let current = null;
let style = null;
const sessionId = Math.random().toString(36).slice(2, 10);
const local = [];         // demo mode storage
let submitted = 0;
const seen = new Set();

// ---- UI messages in the three languages ------------------------------------------------------
const MSG = {
  needInk: { ky: 'Адегенде сөздү жазыңыз.', ru: 'Сначала напишите слово.', en: 'Please write the word first.' },
  needText: { ky: 'Эмне жазганыңызды киргизиңиз.', ru: 'Введите, что вы написали.', en: 'Please enter what you wrote.' },
  tooLarge: { ky: 'Сүрөт өтө чоң — тазалап, бир аз кичирээк жазыңыз.', ru: 'Рисунок слишком большой — очистите и напишите чуть мельче.',
              en: 'This drawing is too large — please clear and write it a bit smaller.' },
  saved: { ky: 'Сакталды ✓', ru: 'Сохранено ✓', en: 'Saved ✓' },
  modelRead: { ky: 'модель окуду:', ru: 'модель прочитала:', en: 'the model read:' },
  count: { ky: (n) => `Бул сессияда ${n} сөз жазылды`, ru: (n) => `Написано в этой сессии: ${n}`, en: (n) => `${n} written in this session` },
  uploadFailed: { ky: 'Жөнөтүү ишке ашкан жок: ', ru: 'Не удалось отправить: ', en: 'Upload failed: ' },
  dbError: { ky: 'Маалымат базасына туташуу мүмкүн болгон жок: ', ru: 'Не удалось подключиться к базе данных: ',
             en: 'Could not connect to the database: ' },
  starting: { ky: 'Башталууда…', ru: 'Запуск…', en: 'Starting…' },
  retry: { ky: 'Кайра аракет кылуу', ru: 'Повторить', en: 'Retry' },
};
const lang = () => document.documentElement.dataset.ui || 'ky';
const T = (k, ...a) => { const m = MSG[k][lang()] || MSG[k].en; return typeof m === 'function' ? m(...a) : m; };

// ---- helpers ----------------------------------------------------------------------------------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

function pickPrompt() {
  const done = store.get('khtr_done', {});
  const pool = prompts.filter((p) => (done[p.prompt_id] || 0) < p.max_per_writer && !seen.has(p.prompt_id));
  if (!pool.length) return null;
  let tot = 0;
  for (const p of pool) tot += PRIORITY_WEIGHT[p.priority] || 1;
  let r = Math.random() * tot;
  for (const p of pool) { r -= PRIORITY_WEIGHT[p.priority] || 1; if (r <= 0) return p; }
  return pool[pool.length - 1];
}

// ---- canvas + optional model feedback ----------------------------------------------------------
const ink = new KHTR.InkCanvas($('draw'), { height: 200 });
const rec = new KHTR.Recognizer('model/');
let recReady = false;

function nextPrompt() {
  current = pickPrompt();
  ink.clear();
  if (!current) {
    $('prompt').textContent = 'Бүттү! · Готово! · All done — thank you.';
    $('submit').disabled = $('skip').disabled = true;
    return;
  }
  seen.add(current.prompt_id);
  $('prompt').textContent = current.text;
  $('written').value = current.text;
  style = ink.randomStyle();   // vary pen / brush / ink, width and colour across samples
  $('brush-info').textContent = `✒ ${KHTR.BRUSH_PRESETS[style.preset].label}`;
}

async function submit() {
  if (!current) return;
  if (ink.isEmpty()) { $('feedback').textContent = T('needInk'); return; }
  const text = $('written').value.trim();
  if (!text) { $('feedback').textContent = T('needText'); return; }
  $('submit').disabled = true;
  const crop = ink.renderCrop(1, 16);
  const png = crop.toDataURL('image/png');
  const strokes = JSON.stringify(ink.strokeData());
  let reading = null, prob = null;
  if (recReady) {
    try {
      const r = await rec.recognize(KHTR.toImageData(crop));
      if (r && r.results.length) { reading = r.results[0].text; prob = Math.round(r.results[0].prob * 1000) / 1000; }
    } catch (e) { console.warn(e); }
  }
  const pointer = ink.strokes[0] ? ink.strokes[0].pointerType : '';
  const docData = {
    writer_id: writerId, session_id: sessionId, prompt_id: current.prompt_id, prompt_text: current.text,
    text, text_changed: text !== current.text, category: current.category, priority: current.priority,
    brush: style, pointer_type: pointer, png, strokes, model_reading: reading, model_prob: prob,
    image_w: crop.width, image_h: crop.height, consent_version: S.consentVersion, app_version: APP_VERSION,
  };
  if (png.length > 900000 || strokes.length > 400000) {
    $('feedback').textContent = T('tooLarge');
    $('submit').disabled = false;
    return;
  }
  try {
    if (fb) {
      await fb.fs.addDoc(fb.fs.collection(fb.db, 'submissions'), { ...docData, created_at: fb.fs.serverTimestamp() });
    } else {
      local.push({ ...docData, created_at: new Date().toISOString() });
      $('download').hidden = false;
    }
    const done = store.get('khtr_done', {});
    done[current.prompt_id] = (done[current.prompt_id] || 0) + 1;
    store.set('khtr_done', done);
    submitted++;
    $('feedback').innerHTML = reading
      ? `<span class="ok">${T('saved')}</span> · ${T('modelRead')} <b>${reading.toLowerCase()}</b>`
      : `<span class="ok">${T('saved')}</span>`;
    $('count').textContent = T('count', submitted);
    $('bar').style.width = Math.min(100, (100 * submitted) / S.sessionTarget) + '%';
    nextPrompt();
  } catch (e) {
    console.error(e);
    $('feedback').textContent = T('uploadFailed') + e.message;
  }
  $('submit').disabled = false;
}

// ---- consent ----------------------------------------------------------------------------------
async function start() {
  $('start').disabled = true;
  $('start').textContent = T('starting');
  try {
    fb = await signIn();      // Google sign-in; name + e-mail go to the admin-only profiles/{uid}
  } catch (e) {
    console.error(e);
    alert(T('dbError') + e.message);
    $('start').disabled = false;
    $('start').textContent = T('retry');
    return;
  }
  writerId = fb ? fb.uid : store.get('khtr_local_id', null) || ('local-' + Math.random().toString(36).slice(2, 12));
  if (!fb) store.set('khtr_local_id', writerId);
  const consent = {
    consent_version: S.consentVersion, age_16_plus: true, agreed: true,
    age_range: $('q-age').value, hand: $('q-hand').value, first_language: $('q-lang').value,
  };
  if (fb) await fb.fs.setDoc(fb.fs.doc(fb.db, 'consents', writerId), { ...consent, agreed_at: fb.fs.serverTimestamp() });
  store.set('khtr_consent', { ...consent, writer_id: writerId });
  $('writer').textContent = fb ? fb.user.email : writerId.slice(0, 16);
  $('consent').hidden = true;
  $('session').hidden = false;
  ink.resize();
  nextPrompt();
  rec.load(() => {}).then(() => { recReady = true; }).catch(() => {});   // model feedback is optional
}

function updateStart() { $('start').disabled = !($('c-age').checked && $('c-agree').checked); }

// ---- wire up ----------------------------------------------------------------------------------
document.querySelectorAll('.js-licence').forEach((e) => { e.textContent = S.licence; });
document.querySelectorAll('.js-contact').forEach((e) => {
  const a = document.createElement('a'); a.href = 'mailto:' + S.contactEmail; a.textContent = S.contactEmail; e.replaceChildren(a);
});
// language switch: Kyrgyz (default), Russian, English; remembered per browser
function setLang(l) {
  document.documentElement.dataset.ui = l;
  document.documentElement.lang = l;
  document.querySelectorAll('[data-set-lang]').forEach((b) => b.classList.toggle('selected', b.dataset.setLang === l));
  store.set('khtr_lang', l);
}
document.querySelectorAll('[data-set-lang]').forEach((b) => { b.onclick = () => setLang(b.dataset.setLang); });
const urlLang = new URLSearchParams(location.search).get('lang');   // e.g. collect.html?lang=ru
setLang(['ky', 'ru', 'en'].includes(urlLang) ? urlLang
  : store.get('khtr_lang', (navigator.language || '').toLowerCase().startsWith('ru') ? 'ru' : 'ky'));
$('demo-banner').hidden = !!window.FIREBASE_CONFIG;
loadFirebase().catch(() => {});   // preload the SDK so the sign-in popup opens directly from the click
$('c-age').onchange = updateStart;
$('c-agree').onchange = updateStart;
$('start').onclick = start;
$('submit').onclick = submit;
$('skip').onclick = nextPrompt;
$('clear').onclick = () => ink.clear();
$('undo').onclick = () => ink.undo();
$('download').onclick = () => {
  const blob = new Blob([JSON.stringify(local, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `kyrgyz_handwriting_${writerId}_${sessionId}.json`;
  a.click();
};

prompts = await fetch('prompts/collection_prompts.json').then((r) => r.json());
