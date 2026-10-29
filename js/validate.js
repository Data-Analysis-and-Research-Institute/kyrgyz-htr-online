/* Validation page: review collected handwriting samples (Google sign-in only).
 * Anyone signed in with Google can validate (no approval). Each validator casts one vote per sample, stored as
 * reviews/{submissionId}_{validatorUid}; a label is decided by >= 2 agreeing votes, so the queue keeps serving a
 * sample until it is decided. Nobody votes on their own samples. A returning user is signed in automatically. */
import { signIn as fbSignIn, signOut, currentUser, loadFirebase } from './fb.js';
import { norm, voteStatus } from './votes.js';

const $ = (id) => document.getElementById(id);
const VERDICTS = ['correct', 'wrong_label', 'illegible', 'not_kyrgyz', 'personal_info'];
const APP_VERSION = 'validate-1.1';
const PAGE = 200, MIN_QUEUE = 30;
const t = (...a) => window.KHTR.t(...a);

let fb = null;          // {db, uid, fs, user}
let queue = [];         // samples to review
let pos = 0;
let lastDoc = null;     // Firestore pagination cursor
let exhausted = false;  // all samples scanned
let done = 0;
const skipped = { own: 0, voted: 0, decided: 0, scanned: 0 };

const disagree = (s) => s.model_reading != null && norm(s.model_reading) !== norm(s.text);
const votes = new Map();   // submission id -> [review, ...] (all validators)
const OPEN = { pending: 0, disputed: 1, unreviewed: 2 };   // still needs votes; queue order

// ---- Firebase --------------------------------------------------------------------------------
async function signIn() {
  if (!window.FIREBASE_CONFIG) { $('auth-info').textContent = t('val.noConfig'); return; }
  fb = await fbSignIn();
  $('src').textContent = fb.user.email;
  $('start').hidden = true;
  $('review').hidden = false;
  $('status').textContent = t('val.loading');
  await loadVotes();
  await fillQueue();
  show();
}

async function loadVotes() {
  const { db, fs } = fb;
  votes.clear();
  for (const d of (await fs.getDocs(fs.collection(db, 'reviews'))).docs) {
    const r = d.data();
    if (!votes.has(r.submission_id)) votes.set(r.submission_id, []);
    votes.get(r.submission_id).push(r);
  }
}

/* Scan samples (newest first) page by page until the queue has MIN_QUEUE open samples or all are scanned. */
async function fillQueue() {
  const { db, fs, uid } = fb;
  const fresh = [];
  while (!exhausted && queue.length - pos + fresh.length < MIN_QUEUE) {
    const parts = [fs.collection(db, 'submissions'), fs.orderBy('created_at', 'desc'), fs.limit(PAGE)];
    if (lastDoc) parts.push(fs.startAfter(lastDoc));
    const snap = await fs.getDocs(fs.query(...parts));
    if (snap.docs.length) lastDoc = snap.docs[snap.docs.length - 1];
    exhausted = snap.docs.length < PAGE;
    for (const d of snap.docs) {
      const s = d.data(), revs = votes.get(d.id) || [];
      skipped.scanned++;
      if (s.writer_id === uid) skipped.own++;
      else if (revs.some((r) => r.validator_uid === uid)) skipped.voted++;
      else if (!(voteStatus(revs) in OPEN)) skipped.decided++;
      else fresh.push({ id: d.id, ...s });
    }
  }
  queue = queue.slice(pos).concat(sortQueue(fresh));
  pos = 0;
}

async function saveReview(sample, verdict, corrected) {
  await fb.fs.setDoc(fb.fs.doc(fb.db, 'reviews', `${sample.id}_${fb.uid}`), {
    submission_id: sample.id, verdict, corrected_text: corrected || '', app_version: APP_VERSION,
    validator_uid: fb.uid, created_at: fb.fs.serverTimestamp() });
}

// samples one vote short of a decision first, then disputed, then new ones; model/label disagreements first
function sortQueue(items) {
  const st = (s) => OPEN[voteStatus(votes.get(s.id) || [])] ?? 2;
  return items.map((s, i) => [st(s), disagree(s) ? 0 : 1, i, s])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]).map((x) => x[3]);
}

// ---- review UI --------------------------------------------------------------------------------
function show() {
  $('fix-row').hidden = true;
  const s = queue[pos];
  $('progress').textContent = t('val.progress', done, `${Math.max(0, queue.length - pos)}${exhausted ? '' : '+'}`);
  $('empty').hidden = !!s;
  $('sample').hidden = !s;
  if (!s) {
    $('status').textContent = '';
    $('empty-info').textContent = t('val.emptyInfo', skipped.scanned, skipped.own, skipped.voted, skipped.decided);
    return;
  }
  $('img').src = s.png;
  $('m-prompt').textContent = s.prompt_text || '';
  $('m-text').textContent = s.text || '';
  const m = s.model_reading;
  $('m-model').innerHTML = m == null ? '<span class="muted">—</span>'
    : `${m.toLowerCase()} <span class="${disagree(s) ? 'bad' : 'ok'}">${t(disagree(s) ? 'val.neq' : 'val.eq')}</span>`;
  const b = s.brush || {};
  $('m-brush').textContent = [b.preset, s.pointer_type].filter(Boolean).join(' / ');
  const n = (votes.get(s.id) || []).length;   // others' verdicts are not shown, so votes stay independent
  $('m-votes').textContent = n ? t('val.votesN', n) : t('val.votes0');
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
  if (v === 'wrong_label' && !corrected) { $('status').textContent = t('val.enterText'); return; }
  try {
    await saveReview(s, v, corrected);
    done++;
    pos++;
    if (!exhausted && queue.length - pos < 5) await fillQueue();
    show();
  } catch (e) { $('status').textContent = t('val.saveFail', e.message); }
}

// ---- wire up ----------------------------------------------------------------------------------
const fail = (e) => { console.error(e); $('start').hidden = false; $('review').hidden = true; $('auth-info').textContent = t('val.signinFail', e.message); };
window.addEventListener('khtr:lang', () => { if (!$('review').hidden) { const keep = $('fix').value; show(); $('fix').value = keep; } });
$('signin').onclick = () => signIn().catch(fail);
$('signout').onclick = async () => { await signOut(); location.reload(); };
document.querySelectorAll('[data-v]').forEach((b) => { b.onclick = () => verdict(b.dataset.v); });
$('skip').onclick = async () => { pos++; if (!exhausted && queue.length - pos < 5) await fillQueue(); show(); };
$('replay').onclick = replay;
$('fix-save').onclick = () => verdict('wrong_label');
$('recheck').onclick = async () => { await loadVotes(); await fillQueue(); show(); };
document.addEventListener('keydown', (e) => {
  if ($('review').hidden || !queue[pos]) return;
  if (e.target === $('fix')) { if (e.key === 'Enter') verdict('wrong_label'); if (e.key === 'Escape') $('fix-row').hidden = true; return; }
  const k = e.key.toLowerCase();
  if (k >= '1' && k <= '5') verdict(VERDICTS[+k - 1]);
  else if (k === 's') $('skip').click();
  else if (k === 'r') replay();
});
// returning user: sign in without a click
currentUser().then((u) => { if (u && !u.isAnonymous) signIn().catch(fail); }).catch(() => {});
loadFirebase().catch(() => {});
