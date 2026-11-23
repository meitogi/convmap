// Who may open the hosted page. Each person has a name and a key of their
// own, carried by their link. The list is kept in the repository, sealed
// with the master key ; the published page only gets, for each key, the
// data key wrapped with it — no name, and nothing a removed key can open.

import { fromBase64Url, generateKey, open, seal, toBase64Url } from './crypto.mjs';

// How a key is looked up in the published table without being published.
export async function keyId(key) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)));
  let hex = '';
  for (let i = 0; i < 8; i++) hex += digest[i].toString(16).padStart(2, '0');
  return hex;
}

// bytes : the sealed list, or null when there is none yet.
// Returns [{ name, key, created }].
export async function readAccess(bytes, master) {
  return bytes ? JSON.parse(await open(bytes, master)) : [];
}

export function sealAccess(list, master) {
  return seal(JSON.stringify(list), master);
}

// today : 'YYYY-MM-DD'. Returns a new list ; names are unique.
export function addPerson(list, name, today) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('name is required');
  if (list.some((person) => person.name.toLowerCase() === trimmed.toLowerCase())) throw new Error(`"${trimmed}" already has a link`);
  return list.concat({ name: trimmed, key: generateKey(), created: today });
}

export function removePerson(list, name) {
  return list.filter((person) => person.name !== name);
}

// base : the page's address, ending with a slash.
export function accessLink(base, key) {
  return `${base}#k=${key}`;
}

// The published table : { key id: data key wrapped with that key }, for the
// master key and for everyone on the list.
export async function wrapDataKey(list, master, dataKey) {
  const table = {};
  for (const key of [master].concat(list.map((person) => person.key))) {
    table[await keyId(key)] = toBase64Url(await seal(dataKey, key));
  }
  return table;
}

// The data key a personal key gives access to, or null when the key is not
// (or no longer) in the table.
export async function unwrapDataKey(table, key) {
  const wrapped = table[await keyId(key)];
  if (!wrapped) return null;
  try {
    return await open(fromBase64Url(wrapped), key);
  } catch {
    return null;
  }
}
