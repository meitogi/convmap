// Prints the access key, creating it on first use. The key is kept in
// .agenda-key, which git ignores.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { generateKey } from '../lib/crypto.mjs';

const file = new URL('../.agenda-key', import.meta.url);
const fresh = process.argv.includes('--new');
if (fresh || !existsSync(file)) writeFileSync(file, `${generateKey()}\n`, { mode: 0o600 });
const key = readFileSync(file, 'utf8').trim();

console.log(`${fresh ? 'New master key' : 'Master key'} : ${key}

It seals the snapshot and the access list kept in the repository. Keep it
to yourself : personal links are made on the site's admin.html page.

1. GitHub, in the repository : Settings > Secrets and variables > Actions >
   New repository secret, named AGENDA_KEY, with the key as its value.

2. Your own link to the page (and the key admin.html asks for) :
   https://convmap.suuuper.app/#k=${key}
   The part after # stays in the browser : it is never sent to GitHub.
${fresh ? `
The key changed : run node scripts/update.mjs and push, update the
AGENDA_KEY secret, and create the personal links again on admin.html — the
previous list was sealed with the old key. Delete snapshot/access.bin first.
` : ''}`);
