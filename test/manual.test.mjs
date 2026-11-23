import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { getEvent, listEvents, openDb, upsertAgenda } from '../lib/db.mjs';
import { editChanges, mergeAgenda, present } from '../lib/events.mjs';
import { manualRows, SHARED_ID_BASE, sharedId, validate, withManual } from '../lib/manual.mjs';
import { buildSeries } from '../lib/series.mjs';
import { fixtureEvents, TODAY } from './helpers.mjs';

const agenda = () => fixtureEvents().map(({ id, source, ...event }) => event);
const japanTours = (events) => events.find((event) => event.title === 'Japan Tours Festival 2027');

function doc() {
  return {
    series: [
      {
        title: 'Otaku City Festival',
        venue: 'Cité des Arts',
        city: 'Saint-Denis',
        zip: '97400',
        country: 'France',
        lat: -20.8823,
        lng: 55.4504,
        facebook: 'https://www.facebook.com/otakucityfestival',
        editions: [
          { start_date: '2025-05-03', links: ['https://www.facebook.com/events/111'], note: 'Fetanoo' },
          { start_date: '2026-05-16', end_date: '2026-05-17', venue: 'Parc de la Nordev', links: ['https://974.agendaculturel.fr/festival/otaku-city-festival.html'] },
        ],
      },
    ],
    agenda_links: {},
  };
}

test('each edition becomes a feed row : the series, then the edition on top', () => {
  const [first, second] = manualRows(doc());
  assert.deepEqual(second, {
    url: '',
    title: 'Otaku City Festival',
    start_date: '2026-05-16',
    end_date: '2026-05-17',
    venue: 'Parc de la Nordev',
    city: 'Saint-Denis',
    zip: '97400',
    country: 'France',
    lat: -20.8823,
    lng: 55.4504,
    category: '',
    website: '',
    organizer: '',
    email: '',
    phone: '',
    facebook: 'https://www.facebook.com/otakucityfestival',
    instagram: '',
    links: 'https://974.agendaculturel.fr/festival/otaku-city-festival.html',
    origin: 'shared',
    source_id: sharedId('Otaku City Festival', '2026-05-16'),
  });
  assert.equal(first.venue, 'Cité des Arts');
  assert.equal(first.end_date, '2025-05-03');
  assert.equal('note' in first, false);
});

test('a shared id is stable, above every agenda id, and ignores the year in the title', () => {
  const id = sharedId('Otaku City Festival', '2026-05-16');
  assert.ok(id >= SHARED_ID_BASE && Number.isSafeInteger(id));
  assert.equal(sharedId('Otaku City Festival 2026', '2026-05-16'), id);
  assert.notEqual(sharedId('Otaku City Festival', '2026-05-17'), id);
  for (const event of agenda()) assert.ok(event.source_id < SHARED_ID_BASE);
});

test('agenda links land on their agenda edition only', () => {
  const events = agenda();
  const target = japanTours(events);
  const base = { ...doc(), agenda_links: { [target.source_id]: ['https://www.facebook.com/events/222', 'https://tickets.example.org/jtf'] } };
  const feed = withManual(events, base);
  assert.equal(feed.length, events.length + 2);
  assert.equal(japanTours(feed).links, 'https://www.facebook.com/events/222\nhttps://tickets.example.org/jtf');
  assert.equal(japanTours(events).links, undefined);
  assert.equal(feed.filter((event) => event.links && !event.origin).length, 1);
});

test('validation names the faulty entry', () => {
  assert.deepEqual(validate(doc()), []);
  const bad = doc();
  bad.series[0].editions[1].start_date = '16/05/2026';
  bad.series[0].editions[0].links = ['facebook.com/events/111'];
  bad.series[0].lat = '-20.88';
  bad.agenda_links = { abc: [] };
  assert.deepEqual(validate(bad), [
    'series[0] « Otaku City Festival » : lat doit être un nombre',
    'series[0] « Otaku City Festival » editions[0] : lien invalide « facebook.com/events/111 »',
    'series[0] « Otaku City Festival » editions[1] : start_date doit être AAAA-MM-JJ',
    "agenda_links : « abc » n'est pas un id de l'agenda",
  ]);
  const twice = doc();
  twice.series[0].editions.push({ start_date: '2026-05-16' });
  assert.match(validate(twice)[0], /editions\[2\] : même titre et même date que .*editions\[1\]/);
  assert.match(validate({ series: [{ title: 'X', editions: [] }] })[0], /au moins une édition/);
});

test('in the browser store : shared editions merge, keep corrections, and go without a ghost', () => {
  const events = agenda();
  let rows = mergeAgenda([], withManual(events, doc()), 't1').rows;
  const shared = rows.find((row) => row.start_date === '2026-05-16' && row.origin === 'shared');
  Object.assign(shared, editChanges(shared, { phone: '0262 00 00 00', note: 'vu sur place' }));

  // The 2025 edition is taken out of the base ; the 2026 one gets a new link.
  const next = doc();
  next.series[0].editions.shift();
  next.series[0].editions[0].links.push('https://www.facebook.com/events/333');
  const merged = mergeAgenda(rows, withManual(events, next), 't2');
  rows = merged.rows;
  assert.equal(merged.stats.gone, 0);
  assert.equal(rows.filter((row) => row.origin === 'shared').length, 1);
  const after = present(rows.find((row) => row.id === shared.id));
  assert.equal(after.phone, '0262 00 00 00');
  assert.equal(after.note, 'vu sur place');
  assert.equal(after.links.split('\n').length, 2);
});

test('in the local base : the same, and the agenda read date is kept', () => {
  const db = openDb(':memory:');
  const events = agenda();
  upsertAgenda(db, withManual(events, doc()), 't1');
  const shared = listEvents(db).filter((event) => event.origin === 'shared');
  assert.equal(shared.length, 2);
  assert.equal(shared[0].source, 'agenda');

  const next = doc();
  next.series[0].editions.shift();
  const stats = upsertAgenda(db, withManual(events, next), 't2', 't1');
  assert.equal(stats.gone, 0);
  assert.equal(listEvents(db).filter((event) => event.origin === 'shared').length, 1);
  assert.equal(getEvent(db, shared[0].id), null);
  assert.equal(db.prepare("SELECT value FROM meta WHERE key = 'fetched_at'").get().value, 't1');
});

test('a base made before links existed gets the columns', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'convmap-')), 'old.db');
  const old = openDb(path);
  old.exec('ALTER TABLE events DROP COLUMN links');
  old.exec('ALTER TABLE events DROP COLUMN origin');
  old.close();
  const columns = openDb(path).prepare('PRAGMA table_info(events)').all().map((column) => column.name);
  assert.ok(columns.includes('links') && columns.includes('origin'));
});

test('a shared edition joins the agenda series of the same event', () => {
  const events = agenda();
  const target = japanTours(events);
  const base = { series: [{ title: 'Japan Tours Festival', city: target.city, lat: target.lat, lng: target.lng, editions: [{ start_date: '2028-07-07' }] }], agenda_links: {} };
  const rows = mergeAgenda([], withManual(events, base), 't1').rows.map(present);
  const series = buildSeries(rows, TODAY).find((s) => s.editions.some((edition) => edition.origin === 'shared'));
  assert.ok(series.editions.length > 1);
});

test('contacts correct every edition of an event, the agenda\'s included, and can clear a dead site', () => {
  const events = agenda();
  const target = japanTours(events);
  const base = { ...doc(), contacts: { 'japan tours festival': { website: '', instagram: 'https://www.instagram.com/jtf/' }, 'otaku city festival': { email: 'contact@example.org' } } };
  const feed = withManual(events, base);
  const tours = feed.filter((event) => event.title.startsWith('Japan Tours Festival'));
  assert.ok(tours.length > 1);
  for (const edition of tours) {
    assert.equal(edition.website, '');
    assert.equal(edition.instagram, 'https://www.instagram.com/jtf/');
  }
  assert.equal(japanTours(events).website, target.website);
  assert.ok(feed.filter((event) => event.origin === 'shared').every((event) => event.email === 'contact@example.org'));
  assert.deepEqual(validate(base), []);
  assert.deepEqual(validate({ ...doc(), contacts: { x: { website: 'japandco.com', email: 'nope', fax: '1' } } }), [
    'contacts[x].website : lien invalide « japandco.com »',
    'contacts[x].email : e-mail invalide « nope »',
    'contacts[x].fax : champ inconnu',
  ]);
});
