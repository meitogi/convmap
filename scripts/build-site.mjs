// Assembles the hosted page in _site/ : the same page as the local one, with
// the browser store in place of the server's, and the snapshot as its data.
//
// The snapshot in the repository is sealed with the master key. Each build
// re-seals it with a new data key and publishes that data key wrapped for
// every key on the access list : someone removed from the list cannot open
// the next build, whatever they kept.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readAccess, wrapDataKey } from '../lib/access.mjs';
import { generateKey, open, seal } from '../lib/crypto.mjs';
import { withManual } from '../lib/manual.mjs';
import { masterKey } from './master-key.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const site = `${root}_site`;
const master = masterKey();

const accessFile = `${root}snapshot/access.bin`;
const list = await readAccess(existsSync(accessFile) ? new Uint8Array(readFileSync(accessFile)) : null, master);
const dataKey = generateKey();
// The agenda's events, with the shared manual base laid over them when
// there is one. updatedAt moves with either, so that browsers re-merge
// after a change of the base alone.
const agenda = JSON.parse(await open(new Uint8Array(readFileSync(`${root}snapshot/events.bin`)), master));
const manualFile = `${root}snapshot/manual.bin`;
const manual = existsSync(manualFile) ? JSON.parse(await open(new Uint8Array(readFileSync(manualFile)), master)) : null;
const feed = manual
  ? { fetchedAt: agenda.fetchedAt, updatedAt: manual.updatedAt > agenda.fetchedAt ? manual.updatedAt : agenda.fetchedAt, events: withManual(agenda.events, manual) }
  : agenda;
const data = await seal(JSON.stringify(feed), dataKey);

rmSync(site, { recursive: true, force: true });
cpSync(`${root}public`, site, { recursive: true, filter: (source) => !/store-(api|browser)\.js$/.test(source) });
cpSync(`${root}public/store-browser.js`, `${site}/store.js`);
mkdirSync(`${site}/lib`);
for (const name of ['access', 'area', 'crypto', 'events', 'export', 'geo', 'releases', 'series', 'share']) cpSync(`${root}lib/${name}.mjs`, `${site}/lib/${name}.mjs`);
cpSync(`${root}CHANGELOG.md`, `${site}/CHANGELOG.md`);
mkdirSync(`${site}/data`);
writeFileSync(`${site}/data/events.bin`, data);
writeFileSync(`${site}/data/keys.json`, JSON.stringify(await wrapDataKey(list, master, dataKey)));
console.log(`site built in ${site} — ${list.length} personal link(s) besides the master key${manual ? `, ${feed.events.length - agenda.events.length} shared edition(s)` : ''}`);
