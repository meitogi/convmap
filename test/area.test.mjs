import assert from 'node:assert/strict';
import { test } from 'node:test';
import { areaOf, DEPARTMENTS, REGIONS } from '../lib/area.mjs';
import { buildSeries } from '../lib/series.mjs';
import { fixtureEvents, TODAY } from './helpers.mjs';

test('the table holds the 101 departments of the 18 regions', () => {
  let regions = 0;
  let departments = 0;
  for (const region in REGIONS) {
    regions++;
    for (const code in REGIONS[region]) departments++;
  }
  assert.equal(regions, 18);
  assert.equal(departments, 101);
  let indexed = 0;
  for (const code in DEPARTMENTS) indexed++;
  assert.equal(indexed, 101, 'no department code listed under two regions');
  assert.deepEqual(DEPARTMENTS['35'], { name: 'Ille-et-Vilaine', region: 'Bretagne' });
  assert.deepEqual(DEPARTMENTS['01'], { name: 'Ain', region: 'Auvergne-Rhône-Alpes' });
});

test('areaOf reads the department off the postal code', () => {
  assert.deepEqual(areaOf('35170', 'France'), { department: '35', region: 'Bretagne' });
  assert.deepEqual(areaOf('44800', ''), { department: '44', region: 'Pays de la Loire' });
  assert.deepEqual(areaOf('01000', 'France'), { department: '01', region: 'Auvergne-Rhône-Alpes' });
  assert.deepEqual(areaOf(' 75012 ', 'France'), { department: '75', region: 'Île-de-France' });
  assert.deepEqual(areaOf('20090', 'France'), { department: '2A', region: 'Corse' });
  assert.deepEqual(areaOf('20200', 'France'), { department: '2B', region: 'Corse' });
  assert.deepEqual(areaOf('97400', 'France'), { department: '974', region: 'La Réunion' });
});

test('abroad the country stands for the region, whatever the postal code looks like', () => {
  assert.deepEqual(areaOf('28042', 'Espagne'), { department: '', region: 'Espagne' });
  assert.deepEqual(areaOf('1000', 'Belgique'), { department: '', region: 'Belgique' });
  assert.deepEqual(areaOf('98000', 'Monaco'), { department: '', region: 'Monaco' });
});

test('no usable postal code, no area', () => {
  assert.equal(areaOf('', 'France'), null);
  assert.equal(areaOf(undefined, ''), null);
  assert.equal(areaOf('1000', ''), null);
  assert.equal(areaOf('99999', 'France'), null);
  assert.equal(areaOf('97500', 'France'), null);
});

test('a series carries what areaOf needs', () => {
  const series = buildSeries(fixtureEvents(), TODAY);
  const s = series.find((x) => x.name === 'Geek Days Rennes');
  assert.deepEqual(areaOf(s.zip, s.country), { department: '35', region: 'Bretagne' });
  const tours = series.find((x) => x.name === 'Japan Tours Festival');
  assert.deepEqual(areaOf(tours.zip, tours.country), { department: '37', region: 'Centre-Val de Loire' });
});
