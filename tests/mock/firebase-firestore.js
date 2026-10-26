// In-memory stand-in for firebase-firestore. Data: globalThis.__MOCK.db = {collection: {id: data}}.
const DB = () => globalThis.__MOCK.db;
const snap = (col, id) => {
  const d = (DB()[col] || {})[id];
  return { id, exists: () => d !== undefined, data: () => (d === undefined ? undefined : { ...d }) };
};
export function getFirestore() { return {}; }
export function doc(db, col, id) { return { col, id }; }
export function collection(db, col) { return { col, cons: [] }; }
export function orderBy(field, dir = 'asc') { return { type: 'orderBy', field, dir }; }
export function limit(n) { return { type: 'limit', n }; }
export function startAfter(s) { return { type: 'startAfter', s }; }
export function where(field, op, value) { return { type: 'where', field, op, value }; }
export function query(ref, ...cons) { return { col: ref.col, cons }; }
export function serverTimestamp() { return Date.now(); }
export async function getDoc(ref) { globalThis.__MOCK.reads = (globalThis.__MOCK.reads || 0) + 1; return snap(ref.col, ref.id); }
export async function setDoc(ref, data, opts) {
  const c = (DB()[ref.col] = DB()[ref.col] || {});
  c[ref.id] = opts && opts.merge ? { ...(c[ref.id] || {}), ...data } : { ...data };
}
export async function addDoc(ref, data) {
  const id = 'auto' + Math.random().toString(36).slice(2, 10);
  await setDoc({ col: ref.col, id }, data);
  return { id };
}
export async function getDocs(q) {
  let docs = Object.keys(DB()[q.col] || {}).map((id) => snap(q.col, id));
  for (const c of q.cons || []) {
    if (c.type === 'where') docs = docs.filter((d) => d.data()[c.field] === c.value);
    if (c.type === 'orderBy') {
      const k = (d) => d.data()[c.field];
      docs.sort((a, b) => (k(a) < k(b) ? -1 : k(a) > k(b) ? 1 : 0) * (c.dir === 'desc' ? -1 : 1));
    }
  }
  const sa = (q.cons || []).find((c) => c.type === 'startAfter');
  if (sa) docs = docs.slice(docs.findIndex((d) => d.id === sa.s.id) + 1);
  const lim = (q.cons || []).find((c) => c.type === 'limit');
  if (lim) docs = docs.slice(0, lim.n);
  return { docs };
}
