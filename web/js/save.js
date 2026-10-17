// Save slots live in localStorage; each slot is also synced to the server under a
// save code, so the same game can be continued on another device.
const KEY = 'scb.slots.v1';
export const SLOT_COUNT = 3;

export function readSlots() {
  let slots = [];
  try { slots = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { slots = []; }
  if (!Array.isArray(slots)) slots = [];
  return Array.from({ length: SLOT_COUNT }, (_, i) => slots[i] || null);
}

function writeSlots(slots) {
  try { localStorage.setItem(KEY, JSON.stringify(slots)); return true; } catch { return false; }
}

export function deleteSlot(i) {
  const slots = readSlots();
  slots[i] = null;
  writeSlots(slots);
}

export const formatCode = (c) => (c && c.length === 8 ? c.slice(0, 4) + '-' + c.slice(4) : c || '');
export const normalizeCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const api = (path) => new URL('api/saves' + path, location.href).toString();

async function request(method, path, body) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 6000);
  try {
    const res = await fetch(api(path), {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
    let json = null;
    try { json = await res.json(); } catch { /* non-JSON */ }
    if (!res.ok) {
      const err = new Error(json?.error || `server error ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return json;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('server did not respond');
    if (e instanceof TypeError) throw new Error('server unreachable');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Saves locally first, then syncs to the server. Returns the slot record plus sync status.
export async function saveToSlot(i, data) {
  const slots = readSlots();
  const rec = { savedAt: Date.now(), code: slots[i]?.code || null, summary: data.summary, data };
  slots[i] = rec;
  const local = writeSlots(slots);
  let syncError = null;
  try {
    let res;
    if (rec.code) {
      try { res = await request('PUT', '/' + rec.code, { data }); } catch (e) {
        if (e.status !== 404) throw e;
        res = await request('POST', '', { data }); // code expired on the server: get a new one
      }
    } else res = await request('POST', '', { data });
    rec.code = res.code;
    rec.syncedAt = Date.parse(res.updatedAt) || Date.now();
  } catch (e) {
    syncError = e.message;
  }
  slots[i] = rec;
  writeSlots(slots);
  if (!local && syncError) throw new Error(`Could not save: browser storage is unavailable and ${syncError}.`);
  return { rec, local, syncError };
}

export async function fetchByCode(code) {
  const c = normalizeCode(code);
  if (c.length !== 8) throw new Error('Save codes are 8 characters, like ABCD-EFGH.');
  const res = await request('GET', '/' + c);
  return { code: res.code, data: res.data, updatedAt: Date.parse(res.updatedAt) || Date.now() };
}

// Loads a slot. If the slot has a code and the server copy is newer (saved on another
// device), the server copy wins. Returns { data, source: 'local' | 'server', note }.
export async function loadSlot(i) {
  const slots = readSlots();
  const rec = slots[i];
  if (!rec) throw new Error('That slot is empty.');
  if (rec.code) {
    try {
      const remote = await fetchByCode(rec.code);
      if (remote.updatedAt > (rec.syncedAt || rec.savedAt) + 1000) {
        slots[i] = { ...rec, savedAt: remote.updatedAt, syncedAt: remote.updatedAt, data: remote.data, summary: remote.data?.summary };
        writeSlots(slots);
        return { data: remote.data, source: 'server' };
      }
    } catch { /* offline: use the local copy */ }
  }
  return { data: rec.data, source: 'local' };
}

export function importToSlot(i, remote) {
  const slots = readSlots();
  slots[i] = { savedAt: remote.updatedAt, syncedAt: remote.updatedAt, code: remote.code, summary: remote.data?.summary, data: remote.data };
  return writeSlots(slots);
}
