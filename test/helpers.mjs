import { readFileSync } from 'node:fs';
import { mapEvent } from '../lib/agenda.mjs';

// Real events of the agenda's API (organizer e-mails and phones replaced).
export const rawEvents = JSON.parse(readFileSync(new URL('./fixtures/agenda-events.json', import.meta.url), 'utf8'));

export const TODAY = '2026-11-23';

// The fixture as rows of the `events` table.
export function fixtureEvents() {
  return rawEvents.map((raw, index) => ({ id: index + 1, source: 'agenda', ...mapEvent(raw) }));
}
