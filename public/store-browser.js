// The page's data, kept in this browser (IndexedDB) : the hosted page has no
// server. Events start from the encrypted snapshot published with the page,
// so the page opens at once and works when the agenda cannot be reached ;
// "update" reads the agenda itself. The snapshot's key comes with the access
// link, after the # — a part of the address browsers never send anywhere.

import { fetchAgenda } from './lib/agenda.mjs';
import { unwrapDataKey } from './lib/access.mjs';
import { open } from './lib/crypto.mjs';
import { editChanges, manualValues, mergeAgenda, present } from './lib/events.mjs';

const SNAPSHOT = 'data/events.bin';
const KEYS = 'data/keys.json';
const KEY_STORE = 'convmap-key';
const FIRST_MANUAL_ID = 1e9;

function request(run) {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open('convmap', 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore('kv');
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const database = opening.result;
      const done = run(database.transaction('kv', 'readwrite').objectStore('kv'));
      done.onsuccess = () => resolve(done.result);
      done.onerror = () => reject(done.error);
      done.transaction.oncomplete = () => database.close();
    };
  });
}
const read = (key) => request((kv) => kv.get(key));
const write = (key, value) => request((kv) => kv.put(value, key));

// The key of the access link. It is remembered, so that the bare address
// works on the next visit, and taken out of the address bar : the address is
// what people copy to share a search, and it must not carry their key.
let keyFromLink = null;

function accessKey() {
  const fromLink = /[#&]k=([\w-]+)/.exec(location.hash);
  if (fromLink) {
    keyFromLink = fromLink[1];
    history.replaceState(null, '', location.pathname + location.search);
  }
  try {
    if (keyFromLink) localStorage.setItem(KEY_STORE, keyFromLink);
    return keyFromLink || localStorage.getItem(KEY_STORE);
  } catch {
    // Private window : the key lasts for this visit.
    return keyFromLink;
  }
}

// The published snapshot, with why it could not be read when it could not :
// 'nokey' (no access link yet), 'revoked' (the key is not, or no longer, on
// the list), 'offline' (the files cannot be fetched).
async function readSnapshot() {
  const key = accessKey();
  if (!key) return { status: 'nokey' };
  try {
    const [keys, data] = await Promise.all([fetch(KEYS), fetch(SNAPSHOT)]);
    if (!keys.ok || !data.ok) return { status: 'offline' };
    const dataKey = await unwrapDataKey(await keys.json(), key);
    if (!dataKey) return { status: 'revoked' };
    return { status: 'ok', snapshot: JSON.parse(await open(new Uint8Array(await data.arrayBuffer()), dataKey)) };
  } catch {
    return { status: 'offline' };
  }
}

// { rows, fetchedAt, live } — live : the rows were last read from the agenda
// itself, not from the snapshot.
let state = null;
let access = 'ok';

async function load() {
  if (state) return state;
  const stored = (await read('events')) || { rows: [], fetchedAt: null, live: false };
  // The snapshot is tried on every visit ; offline, the rows already stored do.
  const { status, snapshot } = await readSnapshot();
  access = status;
  if (status === 'revoked') {
    // The copy kept here goes with the access ; what the visitor added stays.
    stored.rows = stored.rows.filter((row) => row.source === 'manual');
    stored.fetchedAt = null;
    stored.live = false;
    await write('events', stored);
  } else if (snapshot && (!stored.fetchedAt || snapshot.fetchedAt > stored.fetchedAt)) {
    stored.rows = mergeAgenda(stored.rows, snapshot.events, snapshot.fetchedAt).rows;
    stored.fetchedAt = snapshot.fetchedAt;
    stored.live = false;
    await write('events', stored);
  }
  state = stored;
  return state;
}

function find(rows, id) {
  const row = rows.find((candidate) => candidate.id === Number(id));
  if (!row) throw new Error('unknown event');
  return row;
}

export async function listEvents() {
  const { rows, fetchedAt, live } = await load();
  const events = rows.map(present).sort((a, b) => (a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : a.id - b.id));
  // locked : 'nokey' or 'revoked' — the snapshot is closed to this visitor.
  return { events, fetchedAt, snapshot: !live, locked: access === 'nokey' || access === 'revoked' ? access : '' };
}

export async function createEvent(input) {
  const current = await load();
  const rows = current.rows;
  let id = FIRST_MANUAL_ID;
  for (const row of rows) if (row.id >= id) id = row.id + 1;
  rows.push({ id, source: 'manual', source_id: null, overrides: null, gone_at: null, fetched_at: null, ...manualValues(input) });
  await write('events', current);
}

export async function updateEvent(id, input) {
  const current = await load();
  const row = find(current.rows, id);
  Object.assign(row, editChanges(row, input));
  await write('events', current);
}

export async function deleteEvent(id) {
  const current = await load();
  const rows = current.rows;
  const row = find(rows, id);
  if (row.source !== 'manual') throw new Error('not a manual event');
  rows.splice(rows.indexOf(row), 1);
  await write('events', current);
}

// onPage(page, pages) is called as the agenda is read.
export async function refetch(onPage) {
  const current = await load();
  const fresh = await fetchAgenda(onPage);
  const now = new Date().toISOString();
  const { rows, stats } = mergeAgenda(current.rows, fresh, now);
  current.rows = rows;
  current.fetchedAt = now;
  current.live = true;
  await write('events', current);
  return stats;
}

export async function listSearches() {
  const searches = (await read('searches')) || [];
  return searches.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

export async function saveSearch(name, params) {
  const searches = (await listSearches()).filter((search) => search.name !== name);
  searches.push({ name, params });
  await write('searches', searches);
  return listSearches();
}

export async function deleteSearch(name) {
  await write('searches', (await listSearches()).filter((search) => search.name !== name));
  return listSearches();
}
