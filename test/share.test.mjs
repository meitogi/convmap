import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULTS, fromQuery, toQuery } from '../lib/share.mjs';

const full = {
  anchor: { lat: 48.117266, lng: -1.6777926, label: 'Rennes' },
  radius: 150,
  period: 'upcoming',
  from: '2026-11',
  sort: 'distance',
  regions: ['Bretagne', "Provence-Alpes-Côte d'Azur"],
  departments: ['44', '2A'],
  tag: 'regular',
  category: 'Salon / convention / brocante',
  search: ' japan ',
};

test('a search with nothing set gives an empty address', () => {
  assert.equal(toQuery(DEFAULTS), '');
  assert.equal(fromQuery(''), null);
  assert.equal(fromQuery('?utm_source=x'), null);
});

test('every filter goes into the address and comes back', () => {
  const query = toQuery(full);
  assert.equal(
    query,
    'lieu=Rennes&lat=48.11727&lng=-1.67779&rayon=150&periode=upcoming&depuis=2026-11&regions=Bretagne%2CProvence-Alpes-C%C3%B4te+d%27Azur&deps=44%2C2A&tag=regular&cat=Salon+%2F+convention+%2F+brocante&q=japan&tri=distance',
  );
  assert.deepEqual(fromQuery(`?${query}`), { ...full, anchor: { lat: 48.11727, lng: -1.67779, label: 'Rennes' }, search: 'japan' });
});

test('defaults stay out, and settings that do nothing without their partner too', () => {
  assert.equal(toQuery({ ...DEFAULTS, regions: ['Bretagne'] }), 'regions=Bretagne');
  // No place : the radius and the sort by distance mean nothing.
  assert.equal(toQuery({ ...DEFAULTS, radius: 250, sort: 'distance' }), '');
  // "From" only counts for the upcoming periods.
  assert.equal(toQuery({ ...DEFAULTS, from: '2027-01' }), '');
  assert.equal(toQuery({ ...DEFAULTS, period: 'announced', from: '2027-01' }), 'periode=announced&depuis=2027-01');
  assert.deepEqual(fromQuery('?regions=Bretagne'), { ...DEFAULTS, regions: ['Bretagne'] });
});

test('a place given by name only is left for the page to look up', () => {
  assert.deepEqual(fromQuery('?lieu=Nantes&rayon=50').anchor, { lat: null, lng: null, label: 'Nantes' });
  assert.equal(fromQuery('?lieu=Nantes&rayon=50').radius, 50);
});

test('values that make no sense are dropped', () => {
  const params = fromQuery('?lat=999&lng=abc&rayon=-5&periode=whenever&depuis=2026-13&tag=best&tri=price&deps=35,,%2044%20&q=%3Cscript%3E');
  assert.deepEqual(params, { ...DEFAULTS, departments: ['35', '44'], search: '<script>' });
  assert.equal(fromQuery('?rayon=5000&lat=48&lng=-1').radius, 100);
  assert.deepEqual(fromQuery('?lat=48&lng=-1').anchor, { lat: 48, lng: -1, label: 'ce point' });
});
