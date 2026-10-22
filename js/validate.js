/* Validation page: review collected handwriting samples.
 *  - Firebase mode: validators sign in with Google; an admin approves them (validators/{uid} document).
 *    Reviews are stored as reviews/{submissionId}_{validatorUid}.
 *  - Local mode: open a JSON array of samples (collect.html demo download, or tools/make_validation_set.py)
 *    and download the reviews as JSON. */
const FB_VERSION = '10.12.2';
const $ = (id) => document.getElementById(id);
const VERDICTS = ['correct', 'wrong_label', 'illegible', 'not_kyrgyz', 'personal_info'];
const APP_VERSION = 'validate-1.0';

let fb = null;          // {db, uid, fs}
let queue = [];         // samples to review: {id, png, text, prompt_text, model_reading, strokes, brush, pointer_type}
let pos = 0;
let lastDoc = null;     // Firestore pagination cursor
const localReviews = [];
let done = 0;

const norm = (t) => (t || '').toUpperCase().replace(/[^\p{L}\p{N}\- ]/gu, '').trim();
const disagree = (s) => s.model_reading != null && norm(s.model_reading) !== norm(s.text);

// ---- Firebase --------------------------------------------------------------------------------
async function signIn() {
  if (!window.FIREBASE_CONFIG) { $('auth-info').textContent = 'No Firebase project configured — use a local file.'; return; }
  const app = await import(`https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-app.js`);
  const auth = await import(`https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-auth.js`);
  const fs = await import(`https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-firestore.js`);
  const a = app.initializeApp(window.FIREBASE_CONFIG);
  const cred = await auth.signInWithPopup(auth.getAuth(a), new auth.GoogleAuthProvider());
  const db = fs.getFirestore(a);
  const uid = cred.user.uid;
  let approved = false;
  try { approved = (await fs.getDoc(fs.doc(db, 'validators', uid))).exists(); } catch (e) { approved = false; }
  if (!approved) {
    $('auth-info').innerHTML = `Signed in as ${cred.user.email}. You are not an approved validator yet: send this ID to `
      + `the project admin, who adds a document <code>validators/${uid}</code> in the Firebase console.`;
    return;
  }
  fb = { db, uid, fs };
  $('src').textContent = `Firebase · ${cred.user.email}`;
  await loadFirebase();
  begin();
}

async function loadFirebase() {
  const { db, fs, uid } = fb;
  const mine = new Set((await fs.getDocs(fs.query(fs.collection(db, 'reviews'), fs.where('validator_uid', '==', uid))))
    .docs.map((d) => d.data().submission_id));
  const parts = [fs.collection(db, 'submissions'), fs.orderBy('created_at', 'desc'), fs.limit(100)];
  if (lastDoc) parts.push(fs.startAfter(lastDoc));
  const snap = await fs.getDocs(fs.query(...parts));
  if (snap.docs.length) lastDoc = snap.docs[snap.docs.length - 1];
  const fresh = snap.docs.filter((d) => !mine.has(d.id)).map((d) => ({ id: d.id, ...d.data() }));
  queue = queue.slice(pos).concat(sortQueue(fresh));
  pos = 0;
  $('more').hidden = snap.docs.length < 100;
}

async function saveReview(sample, verdict, corrected) {
  const review = { submission_id: sample.id, verdict, corrected_text: corrected || '', app_version: APP_VERSION };
  if (fb) {
    await fb.fs.setDoc(fb.fs.doc(fb.db, 'reviews', `${sample.id}_${fb.uid}`),
      { ...review, validator_uid: fb.uid, created_at: fb.fs.serverTimestamp() });
  } else {
    localReviews.push({ ...review, created_at: new Date().toISOString() });
    $('download').hidden = false;
  }
}

// ---- local file --------------------------------------------------------------------------------
async function openFile(f) {
  const data = JSON.parse(await f.text());
  const items = (Array.isArray(data) ? data : data.items || []).map((s, i) => ({
    id: s.id || `${s.writer_id || 'local'}_${s.session_id || ''}_${s.prompt_id || ''}_${i}`, ...s }));
  queue = sortQueue(items.filter((s) => s.png));
  pos = 0;
  $('src').textContent = `Local file · ${f.name}`;
  begin();
}

// model/label disagreements first, otherwise keep the original order
function sortQueue(items) {
  return items.map((s, i) => [disagree(s) ? 0 : 1, i, s]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[2]);
}

// ---- review UI --------------------------------------------------------------------------------
function begin() {
  $('start').hidden = true;
  $('review').hidden = false;
  show();
}

function show() {
  $('fix-row').hidden = true;
  const s = queue[pos];
  $('progress').textContent = `${done} reviewed · ${Math.max(0, queue.length - pos)} in queue`;
  if (!s) { $('img').removeAttribute('src'); $('m-text').textContent = '—'; $('status').textContent = 'Queue empty — thank you!'; return; }
  $('img').src = s.png;
  $('m-prompt').textContent = s.prompt_text || '';
  $('m-text').textContent = s.text || '';
  const m = s.model_reading;
  $('m-model').innerHTML = m == null ? '<span class="muted">—</span>'
    : `${m.toLowerCase()} <span class="${disagree(s) ? 'bad' : 'ok'}">${disagree(s) ? '≠ label' : '= label'}</span>`;
  const b = s.brush || {};
  $('m-brush').textContent = [b.preset, s.pointer_type].filter(Boolean).join(' / ');
  $('fix').value = s.text || '';
  $('status').textContent = '';
  replay();
}

let anim = null;
function replay() {
  cancelAnimationFrame(anim);
  const s = queue[pos], cv = $('strokes'), g = cv.getContext('2d');
  let data = null;
  try { data = s && s.strokes ? (typeof s.strokes === 'string' ? JSON.parse(s.strokes) : s.strokes) : null; } catch { data = null; }
  const has = !!(data && data.strokes && data.strokes.length);
  cv.hidden = !has;
  $('replay-row').hidden = !has;
  if (!has) return;
  const pts = data.strokes.flatMap((st) => st.points.map((p) => p[0])), ys = data.strokes.flatMap((st) => st.points.map((p) => p[1]));
  const x0 = Math.min(...pts) - 10, y0 = Math.min(...ys) - 10, w = Math.max(...pts) - x0 + 10, h = Math.max(...ys) - y0 + 10;
  const k = Math.min(1, 360 / w, 160 / h);
  cv.width = Math.ceil(w * k); cv.height = Math.ceil(h * k);
  const all = [];
  data.strokes.forEach((st, si) => st.points.forEach((p, pi) => all.push({ si, pi, x: (p[0] - x0) * k, y: (p[1] - y0) * k, w: Math.max(1, (p[4] || 2) * k) })));
  let i = 0;
  const step = () => {
    g.fillStyle = '#fff'; if (i === 0) g.fillRect(0, 0, cv.width, cv.height);
    for (let n = 0; n < 4 && i < all.length; n++, i++) {
      const p = all[i], q = all[i - 1];
      g.strokeStyle = '#1b1b22'; g.lineCap = 'round'; g.lineWidth = p.w;
      g.beginPath();
      if (q && q.si === p.si) g.moveTo(q.x, q.y); else g.moveTo(p.x, p.y);
      g.lineTo(p.x + 0.01, p.y); g.stroke();
    }
    if (i < all.length) anim = requestAnimationFrame(step);
  };
  step();
}

async function verdict(v) {
  const s = queue[pos];
  if (!s) return;
  if (v === 'wrong_label' && $('fix-row').hidden) { $('fix-row').hidden = false; $('fix').focus(); $('fix').select(); return; }
  const corrected = v === 'wrong_label' ? $('fix').value.trim() : '';
  if (v === 'wrong_label' && !corrected) { $('status').textContent = 'Enter the correct text.'; return; }
  try {
    await saveReview(s, v, corrected);
    done++;
    pos++;
    show();
  } catch (e) { $('status').textContent = 'Could not save: ' + e.message; }
}

// ---- wire up ----------------------------------------------------------------------------------
$('signin').onclick = () => signIn().catch((e) => { $('auth-info').textContent = 'Sign-in failed: ' + e.message; });
$('file').onchange = (e) => { if (e.target.files[0]) openFile(e.target.files[0]); };
document.querySelectorAll('[data-v]').forEach((b) => { b.onclick = () => verdict(b.dataset.v); });
$('skip').onclick = () => { pos++; show(); };
$('replay').onclick = replay;
$('fix-save').onclick = () => verdict('wrong_label');
$('more').onclick = async () => { await loadFirebase(); show(); };
$('download').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(localReviews, null, 1)], { type: 'application/json' }));
  a.download = `reviews_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
};
document.addEventListener('keydown', (e) => {
  if ($('review').hidden) return;
  if (e.target === $('fix')) { if (e.key === 'Enter') verdict('wrong_label'); if (e.key === 'Escape') $('fix-row').hidden = true; return; }
  const k = e.key.toLowerCase();
  if (k >= '1' && k <= '5') verdict(VERDICTS[+k - 1]);
  else if (k === 's') { pos++; show(); }
  else if (k === 'r') replay();
});
