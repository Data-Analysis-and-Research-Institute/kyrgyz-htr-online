/* Admin dashboard: contributor and validator rankings.
 * Access: Google accounts whose e-mail has a document in admins/{email} (see firebase/firestore.rules).
 * Samples are read through the Firestore REST API with a field projection, so the PNGs and strokes are not
 * downloaded; votes and profiles are small documents read with the SDK. */
import { signIn, loadFirebase } from './fb.js';
import { decide, agreed } from './votes.js';

const $ = (id) => document.getElementById(id);
const DAY = 86400e3;
const t = (...a) => window.KHTR.t(...a);
const FIELDS = ['writer_id', 'created_at', 'text', 'prompt_id'];
let data = null;               // {submissions, reviews, profiles}
let tables = {};               // name -> {cols, rows, sort, desc}

// ---- loading ----------------------------------------------------------------------------------
async function fetchSubmissions(user) {
  const url = `https://firestore.googleapis.com/v1/projects/${window.FIREBASE_CONFIG.projectId}`
    + '/databases/(default)/documents:runQuery';
  const out = [];
  let last = null;
  for (;;) {
    const q = { from: [{ collectionId: 'submissions' }], select: { fields: FIELDS.map((f) => ({ fieldPath: f })) },
      orderBy: [{ field: { fieldPath: '__name__' } }], limit: 5000 };
    if (last) q.startAt = { values: [{ referenceValue: last }], before: false };
    const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${await user.getIdToken()}`,
      'Content-Type': 'application/json' }, body: JSON.stringify({ structuredQuery: q }) });
    if (!r.ok) throw new Error(`samples: ${r.status} ${(await r.text()).slice(0, 200)}`);
    const docs = (await r.json()).filter((x) => x.document).map((x) => x.document);
    for (const d of docs) {
      const f = d.fields || {}, v = (k) => f[k] && (f[k].stringValue ?? f[k].timestampValue ?? null);
      out.push({ id: d.name.split('/').pop(), writer_id: v('writer_id'), text: v('text') || '',
        prompt_id: v('prompt_id'), created_at: Date.parse(v('created_at')) || 0 });
    }
    $('loaded').textContent = t('adm.loadingN', out.length);
    if (docs.length < 5000) break;
    last = docs[docs.length - 1].name;
  }
  return out;
}

async function load() {
  const f = await signIn();
  if (!f) { $('auth-info').textContent = t('val.noConfig'); return; }
  const email = f.user.email;
  let admin = false;
  try { admin = (await f.fs.getDoc(f.fs.doc(f.db, 'admins', email))).exists(); } catch { admin = false; }
  if (!admin) {
    $('auth-info').innerHTML = t('adm.notAdmin', esc(email));
    return;
  }
  $('start').hidden = true;
  $('dash').hidden = false;
  $('who').textContent = t('adm.who', email);
  const ms = (t) => (t && t.toMillis ? t.toMillis() : 0);
  const [submissions, revSnap, profSnap] = await Promise.all([fetchSubmissions(f.user),
    f.fs.getDocs(f.fs.collection(f.db, 'reviews')), f.fs.getDocs(f.fs.collection(f.db, 'profiles'))]);
  const reviews = revSnap.docs.map((d) => { const r = d.data(); return { ...r, created_at: ms(r.created_at) }; });
  const profiles = Object.fromEntries(profSnap.docs.map((d) => [d.id, d.data()]));
  render({ submissions, reviews, profiles });
}

// ---- rankings (pure) --------------------------------------------------------------------------
/* data: {submissions: [{id, writer_id, text, prompt_id, created_at(ms)}],
          reviews: [{submission_id, validator_uid, verdict, corrected_text, created_at(ms)}],
          profiles: {uid: {name, email}}}; since: ms (0 = all time). Decisions always use all votes. */
export function rankings(d, since = 0) {
  const bySub = new Map();
  for (const r of d.reviews) { if (!bySub.has(r.submission_id)) bySub.set(r.submission_id, []); bySub.get(r.submission_id).push(r); }
  const subs = new Map(d.submissions.map((s) => [s.id, s]));
  const dec = new Map(d.submissions.map((s) => [s.id, decide(bySub.get(s.id) || [], s.text)]));
  const who = (uid) => { const p = d.profiles[uid] || {}; return { name: p.name || '', email: p.email || uid || '?' }; };
  const totals = { samples: 0, accepted: 0, rejected: 0, open: 0, excluded_pii: 0, votes: 0 };

  const C = new Map();
  for (const s of d.submissions) {
    if (s.created_at < since) continue;
    const c = C.get(s.writer_id) || { ...who(s.writer_id), samples: 0, accepted: 0, rejected: 0, open: 0,
      excluded_pii: 0, words: new Set(), last: 0 };
    const st = dec.get(s.id).status;
    c.samples++; totals.samples++;
    if (st === 'accepted' || st === 'rejected' || st === 'excluded_pii') { c[st]++; totals[st]++; } else { c.open++; totals.open++; }
    c.words.add(s.prompt_id || s.text);
    c.last = Math.max(c.last, s.created_at);
    C.set(s.writer_id, c);
  }
  const contributors = [...C.values()].map((c) => ({ ...c, words: c.words.size,
    acceptance: c.accepted + c.rejected ? c.accepted / (c.accepted + c.rejected) : null }));

  const V = new Map();
  for (const r of d.reviews) {
    if (r.created_at < since) continue;
    const v = V.get(r.validator_uid) || { ...who(r.validator_uid), votes: 0, decided: 0, agree: 0, corrections: 0, last: 0 };
    v.votes++; totals.votes++;
    if (r.verdict === 'wrong_label') v.corrections++;
    const s = subs.get(r.submission_id);
    const a = s ? agreed(r, dec.get(s.id), s.text) : null;
    if (a !== null) { v.decided++; if (a) v.agree++; }
    v.last = Math.max(v.last, r.created_at);
    V.set(r.validator_uid, v);
  }
  const validators = [...V.values()].map((v) => ({ ...v, agreement: v.decided ? v.agree / v.decided : null }));
  totals.contributors = contributors.length;
  totals.validators = validators.length;
  return { contributors, validators, totals };
}

// ---- rendering --------------------------------------------------------------------------------
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)} %`);
const date = (t) => (t ? new Date(t).toLocaleString(window.KHTR.lang(), { dateStyle: 'short', timeStyle: 'short' }) : '—');

const COLS = {
  contributors: [['name', 'c.name'], ['email', 'c.email'], ['accepted', 'c.accepted'], ['samples', 'c.samples'],
    ['rejected', 'c.rejected'], ['open', 'c.open'], ['excluded_pii', 'c.pii'], ['acceptance', 'c.acceptance', pct],
    ['words', 'c.words'], ['last', 'c.last', date]],
  validators: [['name', 'c.name'], ['email', 'c.email'], ['votes', 'c.votes'], ['decided', 'c.decided'],
    ['agreement', 'c.agreement', pct], ['corrections', 'c.corrections'], ['last', 'c.lastVote', date]],
};
const DEFAULT_SORT = { contributors: ['accepted', 'samples'], validators: ['votes', 'agreement'] };

export function render(d) {
  data = d;
  const days = +$('period').value;
  const R = rankings(d, days ? Date.now() - days * DAY : 0);
  const n = R.totals;
  $('tiles').innerHTML = [['c.samples', n.samples], ['c.contributors', n.contributors], ['c.votes', n.votes],
    ['c.validators', n.validators], ['c.accepted', n.accepted], ['c.rejected', n.rejected], ['c.open', n.open],
    ['c.excluded', n.excluded_pii]]
    .map(([k, v]) => `<div class="tile"><div class="tile-v">${v.toLocaleString()}</div><div class="muted">${t(k)}</div></div>`).join('');
  $('loaded').textContent = t('adm.loaded', d.submissions.length, d.reviews.length, Object.keys(d.profiles).length,
    new Date().toLocaleString());
  for (const name of ['contributors', 'validators']) {
    const prev = tables[name];
    tables[name] = { cols: COLS[name], rows: R[name], sort: prev ? prev.sort : DEFAULT_SORT[name][0], desc: prev ? prev.desc : true };
    drawTable(name);
  }
}

function sorted(name) {
  const T = tables[name], [, tie] = DEFAULT_SORT[name];
  const key = (r, k) => (r[k] == null ? -Infinity : typeof r[k] === 'string' ? r[k].toLowerCase() : r[k]);
  return [...T.rows].sort((a, b) => {
    const x = key(a, T.sort), y = key(b, T.sort);
    const c = x < y ? -1 : x > y ? 1 : 0;
    return (T.desc ? -c : c) || (key(b, tie) - key(a, tie)) || 0;   // ties: larger secondary value first
  });
}

function drawTable(name) {
  const T = tables[name], rows = sorted(name);
  const head = '<tr><th>#</th>' + T.cols.map(([k, label]) =>
    `<th data-k="${k}" class="${k === T.sort ? (T.desc ? 'desc' : 'asc') : ''}">${t(label)}</th>`).join('') + '</tr>';
  const body = rows.map((r, i) => `<tr><td>${i + 1}</td>` + T.cols.map(([k, , fmt]) =>
    `<td>${esc(fmt ? fmt(r[k]) : r[k])}</td>`).join('') + '</tr>').join('');
  const el = $('t-' + name);
  el.innerHTML = `<thead>${head}</thead><tbody>${body || `<tr><td colspan="${T.cols.length + 1}" class="muted">${t('adm.noData')}</td></tr>`}</tbody>`;
  el.querySelectorAll('th[data-k]').forEach((th) => {
    th.onclick = () => { const k = th.dataset.k; T.desc = T.sort === k ? !T.desc : true; T.sort = k; drawTable(name); };
  });
}

function csv(name) {
  const T = tables[name], q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['rank', ...T.cols.map(([k]) => k)].join(',')]
    .concat(sorted(name).map((r, i) => [i + 1, ...T.cols.map(([k, , fmt]) => q(fmt && k === 'last' ? fmt(r[k]) : r[k]))].join(',')));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
  a.download = `${name}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

// ---- wire up ----------------------------------------------------------------------------------
$('signin').onclick = () => load().catch((e) => { $('auth-info').textContent = 'Error: ' + e.message; console.error(e); });
$('reload').onclick = () => load().catch((e) => { $('loaded').textContent = 'Error: ' + e.message; });
$('period').onchange = () => data && render(data);
window.addEventListener('khtr:lang', () => { if (data) render(data); });
document.querySelectorAll('[data-csv]').forEach((b) => { b.onclick = () => csv(b.dataset.csv); });
loadFirebase().catch(() => {});
window.KHTR_ADMIN = { render, rankings, show: () => { $('start').hidden = true; $('dash').hidden = false; } };   // test hook
