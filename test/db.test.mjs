import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeEntities, mapEvent, socialLinks } from '../lib/agenda.mjs';
import { createManualEvent, deleteManualEvent, deleteSearch, getEvent, getMeta, listEvents, listSearches, openDb, saveSearch, updateEvent, upsertAgenda } from '../lib/db.mjs';
import { rawEvents } from './helpers.mjs';

const rows = () => rawEvents.map(mapEvent);
const byTitle = (db, title) => listEvents(db).find((e) => e.title === title);

test('decodeEntities handles what the agenda actually sends', () => {
  assert.equal(decodeEntities('L&rsquo;Imagina&rsquo;Livres &amp; Cie &#8211; 3'), 'L’Imagina’Livres & Cie – 3');
  assert.equal(decodeEntities('Hélène&#038;Édouard'), 'Hélène&Édouard');
  assert.equal(decodeEntities(undefined), '');
});

test('mapEvent keeps every field of a real event', () => {
  const raw = rawEvents.find((e) => e.title === 'Bravo les Rôlistes : Aventures en Eternium #2');
  assert.deepEqual(mapEvent(raw), {
    source_id: raw.id,
    title: 'Bravo les Rôlistes : Aventures en Eternium #2',
    start_date: '2026-11-01',
    end_date: '2026-11-01',
    venue: decodeEntities(raw.venue.venue),
    city: 'Cesson-Sévigné',
    zip: raw.venue.zip,
    country: 'France',
    lat: 48.13200156229,
    lng: -1.6216712603301,
    category: decodeEntities(raw.categories[0].name),
    url: raw.url,
    website: 'https://www.helloasso.com/associations/bravo-les-rolistes/evenements/bravo-les-rolistes-actualplay-sur-scene-1er-novembre-2026',
    organizer: 'Bravo les Rôlistes',
    email: 'contact130051@example.org',
    phone: '01 23 45 67 89',
    facebook: '',
    instagram: 'https://www.instagram.com/bravolesrolistes/',
  });
});

test('mapEvent survives an event with no venue and no organizer', () => {
  const mapped = mapEvent(rawEvents.find((e) => Array.isArray(e.venue)));
  assert.equal(mapped.city, '');
  assert.equal(mapped.lat, null);
  assert.equal(mapped.lng, null);
});

test('first fetch inserts everything', () => {
  const db = openDb(':memory:');
  const all = rows();
  assert.deepEqual(upsertAgenda(db, all, '2026-11-23T10:00:00Z'), { added: all.length, changed: 0, gone: 0, total: all.length });
  assert.equal(listEvents(db).length, all.length);
  assert.equal(getMeta(db, 'fetched_at'), '2026-11-23T10:00:00Z');
  const event = byTitle(db, 'Japan Tours Festival 2027');
  assert.equal(event.start_date, '2027-07-02');
  assert.equal(event.end_date, '2027-07-04');
  assert.equal(event.city, 'Tours');
  assert.equal(event.lat, 47.3801139);
  assert.equal(event.source, 'agenda');
});

test('a re-fetch refreshes the agenda and leaves manual work alone', () => {
  const db = openDb(':memory:');
  const all = rows();
  upsertAgenda(db, all, 't1');

  const edited = byTitle(db, 'Geek Days Rennes 2026');
  updateEvent(db, edited.id, { ...edited, email: 'me@example.org', note: 'called them' });
  const manual = createManualEvent(db, { title: 'Mon salon', start_date: '2027-01-10', city: 'Vannes', lat: '47.66', lng: '-2.76', note: 'word of mouth' });
  const removed = byTitle(db, 'ASOBI');

  // Second fetch : one event renamed and moved, one gone, the rest identical.
  const next = all
    .filter((row) => row.source_id !== rawEvents.find((e) => e.id && mapEvent(e).title === 'ASOBI').id)
    .map((row) => (row.title === 'Geek Days Rennes 2026' ? { ...row, title: 'Geek Days Rennes 2026 !', start_date: '2026-02-14', phone: '02 00 00 00 00' } : row));
  const asobiCount = all.length - next.length;
  const stats = upsertAgenda(db, next, 't2');
  assert.deepEqual(stats, { added: 0, changed: 1, gone: asobiCount, total: next.length });

  const after = getEvent(db, edited.id);
  assert.equal(after.title, 'Geek Days Rennes 2026 !');
  assert.equal(after.start_date, '2026-02-14');
  assert.equal(after.phone, '02 00 00 00 00');
  assert.equal(after.email, 'me@example.org');
  assert.deepEqual(after.overridden, ['email']);
  assert.equal(after.note, 'called them');

  assert.deepEqual(getEvent(db, manual.id), manual);
  assert.equal(manual.source, 'manual');
  assert.equal(manual.lat, 47.66);
  assert.equal(manual.note, 'word of mouth');

  const gone = getEvent(db, removed.id);
  assert.equal(gone.gone_at, 't2');
  assert.equal(gone.title, 'ASOBI');

  // It comes back : no longer gone, counted as changed.
  assert.deepEqual(upsertAgenda(db, all, 't3'), { added: 0, changed: 1 + asobiCount, gone: 0, total: all.length });
  assert.equal(getEvent(db, removed.id).gone_at, null);
  assert.equal(getEvent(db, edited.id).email, 'me@example.org');
});

test('setting a field back to the agenda value clears the override', () => {
  const db = openDb(':memory:');
  upsertAgenda(db, rows(), 't1');
  const event = byTitle(db, 'Roazhon Japan 2025');
  const changed = updateEvent(db, event.id, { ...event, city: 'Rennes centre', lat: '' });
  assert.deepEqual(changed.overridden, ['city', 'lat']);
  assert.equal(changed.city, 'Rennes centre');
  assert.equal(changed.lat, null);
  const back = updateEvent(db, event.id, event);
  assert.deepEqual(back.overridden, []);
  assert.equal(back.lat, event.lat);
});

test('manual events are validated, editable and deletable ; agenda events are not deletable', () => {
  const db = openDb(':memory:');
  upsertAgenda(db, rows(), 't1');
  assert.throws(() => createManualEvent(db, { title: '', start_date: '2027-01-10' }), /title/);
  assert.throws(() => createManualEvent(db, { title: 'X', start_date: '10/01/2027' }), /start_date/);
  const manual = createManualEvent(db, { title: 'X', start_date: '2027-01-10' });
  assert.equal(updateEvent(db, manual.id, { ...manual, title: 'Y', city: 'Brest' }).city, 'Brest');
  assert.equal(getEvent(db, manual.id).title, 'Y');
  assert.equal(deleteManualEvent(db, byTitle(db, 'ASOBI').id), false);
  assert.equal(deleteManualEvent(db, manual.id), true);
  assert.equal(getEvent(db, manual.id), null);
  assert.equal(updateEvent(db, 999999, manual), null);
});

test('saved searches keep their filters, are overwritten by name, and survive a re-fetch', () => {
  const db = openDb(':memory:');
  const rennes = { anchor: { lat: 48.11, lng: -1.67, label: 'Rennes' }, radius: 150, period: 'upcoming', from: '2026-11', tag: 'regular', category: '', search: 'japan' };
  assert.deepEqual(saveSearch(db, { name: ' Bretagne ', params: rennes }), { name: 'Bretagne', params: rennes });
  saveSearch(db, { name: 'autour de Tours', params: { radius: 50 } });
  assert.deepEqual(listSearches(db), [{ name: 'autour de Tours', params: { radius: 50 } }, { name: 'Bretagne', params: rennes }]);

  saveSearch(db, { name: 'Bretagne', params: { ...rennes, radius: 200 } });
  upsertAgenda(db, rows(), 't1');
  assert.equal(listSearches(db).length, 2);
  assert.equal(listSearches(db)[1].params.radius, 200);
  assert.equal(listSearches(db)[1].params.anchor.label, 'Rennes');

  assert.throws(() => saveSearch(db, { name: '  ', params: {} }), /name/);
  assert.equal(deleteSearch(db, 'Bretagne'), true);
  assert.equal(deleteSearch(db, 'Bretagne'), false);
  assert.deepEqual(listSearches(db).map((s) => s.name), ['autour de Tours']);
});

test('an edit that omits a field leaves it alone', () => {
  const db = openDb(':memory:');
  upsertAgenda(db, rows(), 't1');
  const event = byTitle(db, 'Geek Days Rennes 2026');
  assert.match(event.url, /^https:\/\/lagendageek\.com\/tevent\//);
  updateEvent(db, event.id, { title: event.title, start_date: event.start_date, email: 'a@example.org', note: 'n' });
  const after = updateEvent(db, event.id, { phone: '02 99 00 00 00' });
  assert.deepEqual(after.overridden, ['email', 'phone']);
  assert.equal(after.url, event.url);
  assert.equal(after.city, 'Bruz');
  assert.equal(after.email, 'a@example.org');
  assert.equal(after.note, 'n');

  const manual = createManualEvent(db, { title: 'X', start_date: '2027-01-10', url: 'https://example.org/x', city: 'Brest' });
  const edited = updateEvent(db, manual.id, { title: 'Y' });
  assert.equal(edited.url, 'https://example.org/x');
  assert.equal(edited.city, 'Brest');
});

test('socialLinks reads real events', () => {
  const links = (title, date) => socialLinks(rawEvents.find((e) => e.title === title && e.start_date.startsWith(date)));
  // Instagram with a tracking parameter in a custom field, Facebook profile as the website.
  assert.deepEqual(links('ASOBI', '2024'), { facebook: 'https://www.facebook.com/profile.php?id=100090873729078', instagram: 'https://www.instagram.com/asobi_evenement/' });
  assert.deepEqual(links('Bravo les Rôlistes : Aventures en Eternium #1', '2026'), {
    facebook: 'https://www.facebook.com/events/1623250863146184',
    instagram: 'https://www.instagram.com/bravolesrolistes/',
  });
  assert.deepEqual(links('Geek Days Rennes 2026', '2026'), { facebook: '', instagram: '' });
});

test('socialLinks : a page beats an event link, redirects and posts are ignored', () => {
  const event = (fields) => ({ custom_fields: {}, organizer: [], website: '', description: '', ...fields });
  assert.deepEqual(
    socialLinks(event({ website: 'https://fb.me/e/1MaUbQ5dA', organizer: [{ website: 'https://m.facebook.com/MonSalon/?ref=bookmarks' }] })),
    { facebook: 'https://www.facebook.com/MonSalon', instagram: '' },
  );
  assert.deepEqual(socialLinks(event({ website: 'https://fb.me/e/1MaUbQ5dA' })), { facebook: 'https://fb.me/e/1MaUbQ5dA', instagram: '' });
  assert.deepEqual(
    socialLinks(event({ description: '<a href="https://l.facebook.com/l.php?u=https%3A%2F%2Fx.fr&amp;h=AT0">x</a> <a href="https://www.instagram.com/p/Cabc/">post</a>' })),
    { facebook: '', instagram: '' },
  );
  // The description is read only when nothing better exists.
  const described = { description: 'Invité : https://www.facebook.com/UnInvite et https://www.instagram.com/un_invite.' };
  assert.deepEqual(socialLinks(event(described)), { facebook: 'https://www.facebook.com/UnInvite', instagram: 'https://www.instagram.com/un_invite/' });
  assert.deepEqual(
    socialLinks(event({ ...described, custom_fields: { a: { label: 'x', value: 'https://www.facebook.com/LeSalon' }, b: { label: 'y', value: 'https://instagram.com/le_salon' } } })),
    { facebook: 'https://www.facebook.com/LeSalon', instagram: 'https://www.instagram.com/le_salon/' },
  );
});

test('a base created before a column existed is migrated on open', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { mkdtempSync } = await import('node:fs');
  const path = `${mkdtempSync('/tmp/convmap-')}/old.db`;
  const old = new DatabaseSync(path);
  old.exec("CREATE TABLE events (id INTEGER PRIMARY KEY, source TEXT NOT NULL, source_id INTEGER UNIQUE, title TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT, venue TEXT, city TEXT, zip TEXT, lat REAL, lng REAL, category TEXT, url TEXT, website TEXT, organizer TEXT, email TEXT, phone TEXT, overrides TEXT, note TEXT, gone_at TEXT, fetched_at TEXT)");
  old.exec("INSERT INTO events (source, title, start_date, note) VALUES ('manual', 'Ancien', '2026-01-01', 'gardé')");
  old.close();
  const db = openDb(path);
  upsertAgenda(db, rows(), 't1');
  assert.equal(byTitle(db, 'Ancien').note, 'gardé');
  assert.equal(byTitle(db, 'Geek Days Rennes 2026').country, 'France');
  assert.equal(byTitle(db, 'ASOBI').instagram, 'https://www.instagram.com/asobi_evenement/');
});
