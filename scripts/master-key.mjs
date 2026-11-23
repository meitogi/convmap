// The master key : AGENDA_KEY when it is set (GitHub Actions), else the
// .agenda-key file that scripts/key.mjs creates. Exits with what to do when
// there is none.

import { existsSync, readFileSync } from 'node:fs';

export function masterKey() {
  const file = new URL('../.agenda-key', import.meta.url);
  const key = process.env.AGENDA_KEY || (existsSync(file) ? readFileSync(file, 'utf8').trim() : '');
  if (!key) {
    console.error('No master key : set AGENDA_KEY, or run node scripts/key.mjs first.');
    process.exit(1);
  }
  return key;
}
