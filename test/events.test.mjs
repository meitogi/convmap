import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapEvent } from '../lib/agenda.mjs';
import { editChanges, manualValues, mergeAgenda, present } from '../lib/events.mjs';
import { rawEvents } from './helpers.mjs';

// The browser store's merge must behave as the SQLite upsert does.

const fresh = () => rawEvents.map(mapEvent);
const byTitle = (rows, title) => rows.find((row) => row.title === title);

test('first merge takes every event, keyed by its agenda id', () => {
  const all = fresh();
  const { rows, stats } = mergeAgenda([], all, 't1');
  assert.deepEqual(stats, { added: all.length, changed: 0, gone: 0, total: all.length });
  const row = byTitle(rows, 'Japan Tours Festival 2027');
  assert.equal(row.id, row.source_id);
  assert.equal(row.source, 'agenda');
  assert.equal(row.start_date, '2027-07-02');
  assert.equal(row.fetched_at, 't1');
  assert.equal(present(row).city, 'Tours');
});

test('a later merge refreshes the agenda and leaves manual work alone', () => {
  const all = fresh();
  let rows = mergeAgenda([], all, 't1').rows;

  const edited = byTitle(rows, 'Geek Days Rennes 2026');
  Object.assign(edited, editChanges(edited, { email: 'me@example.org', note: 'called them' }));
  const manual = { id: 1e9, source: 'manual', source_id: null, overrides: null, gone_at: null, fetched_at: null, ...manualValues({ title: 'Mon salon', start_date: '2027-01-10', city: 'Vannes', lat: '47.66', lng: '-2.76' }) };
  rows.push(manual);
  const asobi = byTitle(rows, 'ASOBI');

  const next = all
    .filter((row) => row.source_id !== asobi.source_id)
    .map((row) => (row.title === 'Geek Days Rennes 2026' ? { ...row, start_date: '2026-02-14', phone: '02 00 00 00 00' } : row));
  const merged = mergeAgenda(rows, next, 't2');
  assert.deepEqual(merged.stats, { added: 0, changed: 1, gone: 1, total: next.length });
  rows = merged.rows;
  assert.equal(rows.length, all.length + 1);

  const after = present(rows.find((row) => row.id === edited.id));
  assert.equal(after.start_date, '2026-02-14');
  assert.equal(after.phone, '02 00 00 00 00');
  assert.equal(after.email, 'me@example.org');
  assert.deepEqual(after.overridden, ['email']);
  assert.equal(after.note, 'called them');

  assert.deepEqual(rows.find((row) => row.id === 1e9), manual);
  assert.equal(manual.lat, 47.66);

  const gone = rows.find((row) => row.id === asobi.id);
  assert.equal(gone.gone_at, 't2');
  assert.equal(gone.title, 'ASOBI');

  // Still gone on the next merge, counted once ; then it comes back.
  assert.equal(mergeAgenda(rows, next, 't3').stats.gone, 0);
  const back = mergeAgenda(rows, all, 't4');
  assert.deepEqual(back.stats, { added: 0, changed: 2, gone: 0, total: all.length });
  assert.equal(back.rows.find((row) => row.id === asobi.id).gone_at, null);
});

test('an edit is validated', () => {
  const row = byTitle(mergeAgenda([], fresh(), 't1').rows, 'ASOBI');
  assert.throws(() => editChanges(row, { title: '' }), /title/);
  assert.throws(() => manualValues({ title: 'X', start_date: 'demain' }), /start_date/);
});
