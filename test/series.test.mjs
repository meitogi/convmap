import assert from 'node:assert/strict';
import { test } from 'node:test';
import { distanceKm } from '../lib/geo.mjs';
import { buildSeries, normalizeTitle, seriesName } from '../lib/series.mjs';
import { fixtureEvents, TODAY } from './helpers.mjs';

const series = buildSeries(fixtureEvents(), TODAY);
const named = (name) => {
  const found = series.filter((s) => s.name === name);
  assert.equal(found.length, 1, `exactly one series named "${name}", got ${found.length}`);
  return found[0];
};
const dates = (s) => s.editions.map((e) => e.start_date);

test('distanceKm : Rennes → Tours is about 204 km', () => {
  const km = distanceKm(48.117, -1.678, 47.3801139, 0.7264525);
  assert.ok(km > 195 && km < 205, String(km));
  assert.equal(distanceKm(48, -1, 48, -1), 0);
});

test('normalizeTitle drops years, edition numbers and accents', () => {
  assert.equal(normalizeTitle('Geek Days Rennes 2026'), 'geek days rennes');
  assert.equal(normalizeTitle('L’Imagina’Livres 8ème édition'), 'l imagina livres');
  assert.equal(normalizeTitle('L’Imagina’Livres 2024'), 'l imagina livres');
  assert.equal(normalizeTitle('LUDIGEEK FESTIVAL 5 EDITION'), 'ludigeek festival');
  assert.equal(normalizeTitle('Bravo les Rôlistes : Aventures en Eternium #2'), 'bravo les rolistes aventures en eternium');
  assert.equal(normalizeTitle('2026'), '2026');
});

test('seriesName keeps the wording, drops the year and the trailing number', () => {
  assert.equal(seriesName('BROC’ LAND GEEK – CLISSON 2026'), 'BROC’ LAND GEEK – CLISSON');
  assert.equal(seriesName('Bravo les Rôlistes : Aventures en Eternium #2'), 'Bravo les Rôlistes : Aventures en Eternium');
});

test('yearly editions form one series, with an announced next edition', () => {
  const s = named('Japan Tours Festival');
  assert.deepEqual(dates(s), ['2024-06-28', '2025-06-27', '2026-07-03', '2027-07-02']);
  assert.equal(s.tag, 'regular');
  assert.equal(s.upcoming.announced, true);
  assert.equal(s.upcoming.event.start_date, '2027-07-02');
  assert.equal(s.upcoming.event.end_date, '2027-07-04');
  assert.equal(s.city, 'Tours');
  assert.equal(s.website, 'http://www.japantoursfestival.com/');
  assert.equal(s.organizer, 'Tours Evénements');
});

test('a sibling festival in the same city stays its own series', () => {
  assert.deepEqual(dates(named('Korean Tours Festival')), ['2025-02-22', '2026-02-27', '2027-02-26']);
});

test('titles written with an edition number or with a year are the same series', () => {
  assert.deepEqual(dates(named('L’Imagina’Livres')), ['2023-04-15', '2024-04-27', '2025-04-05', '2026-04-11', '2027-03-27']);
});

test('a regular series with no announced date gets a probable month', () => {
  const s = named('Geek Days Rennes');
  assert.deepEqual(dates(s), ['2024-02-17', '2025-02-08', '2026-02-07']);
  assert.equal(s.tag, 'regular');
  assert.deepEqual(s.upcoming, { announced: false, event: null, month: '2027-02' });
});

test('an edition that just ended pushes the probable month to next year', () => {
  const s = named('Ludigeek Festival');
  assert.deepEqual(dates(s), ['2022-11-12', '2024-11-09', '2026-11-14']);
  assert.deepEqual(s.upcoming, { announced: false, event: null, month: '2027-11' });
});

test('two dates the same year are not a regular series', () => {
  const s = named('Les Plus Belles Musiques des Films de Miyazaki');
  assert.deepEqual(dates(s), ['2025-06-14', '2025-06-15']);
  assert.equal(s.tag, 'oneoff');
  assert.equal(s.upcoming, null);
});

test('a first-year event is new', () => {
  const s = named('Bravo les Rôlistes : Aventures en Eternium');
  assert.deepEqual(dates(s), ['2026-10-04', '2026-11-01']);
  assert.equal(s.tag, 'new');
  assert.equal(s.email, 'contact130051@example.org');
});

test('a regular series silent for more than 18 months is paused, with no guess', () => {
  const s = named('Roazhon Japan');
  assert.deepEqual(dates(s), ['2024-03-16', '2025-03-08']);
  assert.equal(s.tag, 'paused');
  assert.equal(s.upcoming, null);
});

test('same title far away is another series ; a nearby move is not', () => {
  const event = (id, start_date, lat, lng, city) => ({ id, title: 'Le Grand Concert', start_date, end_date: start_date, lat, lng, city });
  const built = buildSeries(
    [event(1, '2025-03-01', 48.117, -1.678, 'Rennes'), event(2, '2025-04-01', 43.6, 1.44, 'Toulouse'), event(3, '2026-03-01', 48.057, -1.733, 'Bruz')],
    TODAY,
  );
  assert.deepEqual(built.map((s) => s.editions.map((e) => e.id)), [[1, 3], [2]]);
  assert.equal(built[0].city, 'Bruz');
});

test('an event with no coordinates joins its series by city', () => {
  const built = buildSeries(
    [
      { id: 1, title: 'Salon X 2025', start_date: '2025-05-01', end_date: '2025-05-01', lat: 48.1, lng: -1.6, city: 'Rennes' },
      { id: 2, title: 'Salon X 2026', start_date: '2026-05-01', end_date: '2026-05-01', lat: null, lng: null, city: 'rennes' },
    ],
    TODAY,
  );
  assert.equal(built.length, 1);
  assert.equal(built[0].lat, 48.1);
});
