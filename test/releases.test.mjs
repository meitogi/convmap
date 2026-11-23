import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseReleases } from '../lib/releases.mjs';

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

test('parseReleases reads titles, dates, items and wrapped lines', () => {
  const releases = parseReleases(`# Title

Some introduction.
- not an item : no release is open yet

## 1.1.0 — 2027-01-05

- First thing,
  on two lines.
- Second thing.

Some prose between.

## 1.0.0

- The start.
`);
  assert.deepEqual(releases, [
    { version: '1.1.0', date: '2027-01-05', items: ['First thing, on two lines.', 'Second thing.'] },
    { version: '1.0.0', date: '', items: ['The start.'] },
  ]);
  assert.deepEqual(parseReleases(''), []);
});

test('the changelog opens with the version package.json carries', () => {
  const releases = parseReleases(read('CHANGELOG.md'));
  const latest = releases[0];
  assert.equal(latest.version, JSON.parse(read('package.json')).version);
  assert.match(latest.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(latest.items.length > 0);
  for (const release of releases) assert.ok(release.items.every((item) => item.length > 0));
});
