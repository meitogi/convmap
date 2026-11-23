// Reading and writing snapshot/manual.bin, the sealed shared manual base
// (lib/manual.mjs), for scripts/manual.mjs and scripts/update.mjs.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { open, seal } from '../lib/crypto.mjs';
import { emptyDoc, validate, withManual } from '../lib/manual.mjs';
import { masterKey } from './master-key.mjs';

export const root = fileURLToPath(new URL('..', import.meta.url));
const MANUAL = 'snapshot/manual.bin';
const AGENDA = 'snapshot/events.bin';

async function openFile(path) {
  return JSON.parse(await open(new Uint8Array(readFileSync(root + path)), masterKey()));
}

// The base, or an empty one before the first edition is added.
export async function readManual() {
  if (!existsSync(root + MANUAL)) return emptyDoc();
  const { updatedAt, ...doc } = await openFile(MANUAL);
  return { ...emptyDoc(), ...doc };
}

// The agenda's events as last published : { fetchedAt, events }.
export function readAgenda() {
  return existsSync(root + AGENDA) ? openFile(AGENDA) : Promise.resolve({ fetchedAt: null, events: [] });
}

// Validates, seals and writes the base, then brings the local base up to
// date. Throws with every problem when the document is invalid : nothing is
// written then.
export async function writeManual(doc) {
  const problems = validate(doc);
  if (problems.length) throw new Error(problems.join('\n'));
  const updatedAt = new Date().toISOString();
  writeFileSync(root + MANUAL, await seal(JSON.stringify({ updatedAt, ...doc }, null, 1), masterKey()));

  const { openDb, getMeta, upsertAgenda } = await import('../lib/db.mjs');
  const agenda = await readAgenda();
  if (!agenda.events.length) return;
  mkdirSync(`${root}data`, { recursive: true });
  const db = openDb(process.env.AGENDA_DB || `${root}data/agenda.db`);
  // The agenda was not re-read : the page keeps saying when it last was.
  upsertAgenda(db, withManual(agenda.events, doc), updatedAt, getMeta(db, 'fetched_at') || agenda.fetchedAt);
}

// Commits the base alone : whatever else is being worked on stays out.
export function commitManual(message) {
  execFileSync('git', ['add', MANUAL], { cwd: root });
  execFileSync('git', ['commit', '--quiet', '--only', MANUAL, '-m', message], { cwd: root });
}
