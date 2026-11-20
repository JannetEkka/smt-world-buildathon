// E2E stand-in for gstatic firebase-firestore-lite.js: an in-memory Firestore (window.__fs: path → data),
// seeded from window.__mock.fsSeed; every write is recorded in window.__fsWrites.
window.__fs = new Map(Object.entries((window.__mock || {}).fsSeed || {})); window.__fsWrites = [];
const ts = v => v && v.__serverTimestamp ? Date.now() : v;
const resolve = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, ts(v)]));
export function getFirestore() { return { kind: "e2e-db" }; }
export function doc(db, ...segs) { return { path: segs.join("/") }; }
export function collection(db, ...segs) { return { path: segs.join("/"), col: true }; }
export function serverTimestamp() { return { __serverTimestamp: true }; }
export function orderBy(field, dir) { return { orderBy: field, dir }; }
export function limit(n) { return { limit: n }; }
export function query(col, ...parts) { return { ...col, parts }; }
function write(path, data, merge) {
  const v = merge ? { ...(window.__fs.get(path) || {}), ...resolve(data) } : resolve(data);
  window.__fs.set(path, v); window.__fsWrites.push({ path, data: v });
}
export async function setDoc(ref, data, opts) { write(ref.path, data, opts && opts.merge); }
export async function addDoc(col, data) { const id = "q" + (window.__fsWrites.length + 1) + Math.random().toString(36).slice(2, 6); write(col.path + "/" + id, data); return { path: col.path + "/" + id }; }
export async function getDocs(q) {
  let rows = [...window.__fs.entries()].filter(([p]) => p.startsWith(q.path + "/") && !p.slice(q.path.length + 1).includes("/"))
    .map(([p, d]) => ({ id: p.split("/").pop(), data: () => d }));
  for (const part of q.parts || []) {
    if (part.orderBy) rows.sort((a, b) => (a.data()[part.orderBy] - b.data()[part.orderBy]) * (part.dir === "desc" ? -1 : 1));
    if (part.limit) rows = rows.slice(0, part.limit);
  }
  return { forEach: f => rows.forEach(f), size: rows.length };
}
export function writeBatch() { const ops = []; return { set(ref, data) { ops.push([ref.path, data]); }, async commit() { ops.forEach(([p, d]) => write(p, d)); } }; }
