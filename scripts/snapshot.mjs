// Reads the whole agenda and writes snapshot/events.bin : the copy the hosted
// page starts from, so it opens at once and still works when the agenda is
// unreachable. The file is encrypted with the access key — AGENDA_KEY, or
// the .agenda-key file that scripts/key.mjs creates.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fetchAgenda } from '../lib/agenda.mjs';
import { seal } from '../lib/crypto.mjs';

const keyFile = new URL('../.agenda-key', import.meta.url);
const key = process.env.AGENDA_KEY || (existsSync(keyFile) ? readFileSync(keyFile, 'utf8').trim() : '');
if (!key) {
  console.error('No access key : set AGENDA_KEY, or run node scripts/key.mjs first.');
  process.exit(1);
}

const events = await fetchAgenda((page, pages) => console.log(`agenda : page ${page}/${pages}`));
const bytes = await seal(JSON.stringify({ fetchedAt: new Date().toISOString(), events }), key);
writeFileSync(new URL('../snapshot/events.bin', import.meta.url), bytes);
console.log(`snapshot : ${events.length} events, ${bytes.length} bytes, encrypted`);
