// Reads the whole agenda once and brings everything that depends on it up
// to date :
//   - the local base (data/agenda.db), for the page served by npm start ;
//   - snapshot/events.bin, the encrypted copy the hosted page is published
//     with — and commits it, so that pushing publishes it.
//
//   node scripts/update.mjs              base + snapshot + commit
//   node scripts/update.mjs --no-commit  base + snapshot, left uncommitted
//   node scripts/update.mjs --ci         snapshot only (GitHub Actions, which
//                                        commits by itself)
//
// Nothing is written if the agenda cannot be read to the end.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fetchAgenda } from '../lib/agenda.mjs';
import { open, seal } from '../lib/crypto.mjs';
import { masterKey } from './master-key.mjs';

const args = process.argv.slice(2);
const ci = args.includes('--ci');
const commit = !ci && !args.includes('--no-commit');
const root = fileURLToPath(new URL('..', import.meta.url));
const snapshotFile = `${root}snapshot/events.bin`;
const key = masterKey();

console.log('Reading the agenda — 2 to 3 minutes.');
let events;
try {
  events = await fetchAgenda((page, pages) => console.log(`  page ${page} / ${pages}`));
} catch (error) {
  console.error(`The agenda could not be read : ${error.message}\nNothing was changed. Try again later.`);
  process.exit(1);
}
// A stable order : two readings of the same agenda give the same snapshot.
events.sort((a, b) => a.source_id - b.source_id);

if (!ci) {
  const { openDb, upsertAgenda } = await import('../lib/db.mjs');
  const { readManual } = await import('./manual-store.mjs');
  const { withManual } = await import('../lib/manual.mjs');
  mkdirSync(`${root}data`, { recursive: true });
  // The shared manual base rides along : the local page shows it too.
  const stats = upsertAgenda(openDb(process.env.AGENDA_DB || `${root}data/agenda.db`), withManual(events, await readManual()), new Date().toISOString());
  console.log(`Local base : ${stats.total} events — ${stats.added} new, ${stats.changed} changed, ${stats.gone} gone. Reload the page to see them.`);
}

let previous = null;
if (existsSync(snapshotFile)) {
  try {
    previous = JSON.parse(await open(new Uint8Array(readFileSync(snapshotFile)), key)).events;
  } catch {
    console.log('The existing snapshot was sealed with another key : it is replaced.');
  }
}
if (previous && JSON.stringify(previous) === JSON.stringify(events)) {
  console.log('Snapshot : the agenda has not changed since the last one. Nothing to publish.');
  process.exit(0);
}

writeFileSync(snapshotFile, await seal(JSON.stringify({ fetchedAt: new Date().toISOString(), events }), key));
console.log(`Snapshot : ${events.length} events written to snapshot/events.bin, encrypted.`);

if (commit) {
  // Only this file : whatever else is being worked on stays out of the commit.
  execFileSync('git', ['add', 'snapshot/events.bin'], { cwd: root });
  execFileSync('git', ['commit', '--quiet', '--only', 'snapshot/events.bin', '-m', 'Refresh the agenda snapshot'], { cwd: root });
  console.log(`Committed. To publish : push the main branch — the site is rebuilt in a minute or two.
If the push is refused because GitHub refreshed the snapshot in the meantime :
git pull --rebase -X theirs, then push again (either snapshot is a full, valid copy).`);
} else if (!ci) {
  console.log('Not committed (--no-commit). To publish : commit snapshot/events.bin and push.');
}
