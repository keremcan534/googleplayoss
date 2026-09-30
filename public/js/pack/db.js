/*
 * Tarayıcı içi kalıcılık: projeler ve görsel dosyaları IndexedDB'de tutulur.
 * Hiçbir şey sunucuya gönderilmez. IndexedDB yoksa (bazı özel pencereler) bellek içi
 * yedeğe düşer ve arayüz bunu kullanıcıya söyler.
 */
const DB_NAME = 'gpo-projects';
const DB_VERSION = 1;

let dbp = null;
const mem = { projects: new Map(), assets: new Map() };
export const storage = { persistent: true };

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch { storage.persistent = false; resolve(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('assets')) {
        const s = db.createObjectStore('assets', { keyPath: 'id' });
        s.createIndex('projectId', 'projectId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { storage.persistent = false; resolve(null); };
    req.onblocked = () => { storage.persistent = false; resolve(null); };
  });
  return dbp;
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then((v) => { out = v; });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('İşlem iptal edildi'));
  });
}
const req2p = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

export async function listProjects() {
  const db = await open();
  const all = db ? await tx(db, 'projects', 'readonly', (s) => req2p(s.getAll())) : [...mem.projects.values()];
  return (all || []).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
export async function getProject(id) {
  const db = await open();
  return db ? tx(db, 'projects', 'readonly', (s) => req2p(s.get(id))) : mem.projects.get(id) || null;
}
export async function putProject(p) {
  const db = await open();
  const copy = JSON.parse(JSON.stringify(p));
  if (db) await tx(db, 'projects', 'readwrite', (s) => req2p(s.put(copy)));
  else mem.projects.set(p.id, copy);
  return p;
}
export async function deleteProject(id) {
  const db = await open();
  if (!db) {
    mem.projects.delete(id);
    for (const [k, a] of mem.assets) if (a.projectId === id) mem.assets.delete(k);
    return;
  }
  const ids = await tx(db, 'assets', 'readonly', (s) => req2p(s.index('projectId').getAllKeys(id)));
  await tx(db, 'assets', 'readwrite', (s) => { for (const k of ids) s.delete(k); });
  await tx(db, 'projects', 'readwrite', (s) => req2p(s.delete(id)));
}

function assetId() {
  const r = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}${Math.random()}`;
  return `a_${String(r).replace(/[^a-z0-9]/gi, '').slice(0, 20)}`;
}

/** @param {{projectId, kind, type, bytes:Uint8Array, w, h, name?}} a */
export async function putAsset(a) {
  const db = await open();
  const rec = { id: a.id || assetId(), projectId: a.projectId, kind: a.kind, type: a.type, w: a.w, h: a.h, name: a.name || '', size: a.bytes.length,
    bytes: a.bytes.buffer.slice(a.bytes.byteOffset, a.bytes.byteOffset + a.bytes.byteLength), createdAt: new Date().toISOString() };
  if (db) await tx(db, 'assets', 'readwrite', (s) => req2p(s.put(rec)));
  else mem.assets.set(rec.id, rec);
  return rec.id;
}
export async function getAsset(id) {
  if (!id) return null;
  const db = await open();
  const rec = db ? await tx(db, 'assets', 'readonly', (s) => req2p(s.get(id))) : mem.assets.get(id);
  return rec ? { ...rec, bytes: new Uint8Array(rec.bytes) } : null;
}
export async function deleteAssets(ids) {
  const list = (ids || []).filter(Boolean);
  if (!list.length) return;
  const db = await open();
  if (!db) { for (const k of list) mem.assets.delete(k); return; }
  await tx(db, 'assets', 'readwrite', (s) => { for (const k of list) s.delete(k); });
}
export async function projectAssetIds(projectId) {
  const db = await open();
  if (!db) return [...mem.assets.values()].filter((a) => a.projectId === projectId).map((a) => a.id);
  return tx(db, 'assets', 'readonly', (s) => req2p(s.index('projectId').getAllKeys(projectId)));
}
