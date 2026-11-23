import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accessLink, addPerson, keyId, readAccess, removePerson, sealAccess, unwrapDataKey, wrapDataKey } from '../lib/access.mjs';
import { generateKey, open, seal } from '../lib/crypto.mjs';

test('the list starts empty, grows by name, and refuses a name twice', () => {
  let list = addPerson([], '  Léa ', '2026-11-23');
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Léa');
  assert.equal(list[0].created, '2026-11-23');
  assert.match(list[0].key, /^[\w-]{43}$/);
  list = addPerson(list, 'Tom', '2026-11-24');
  assert.notEqual(list[0].key, list[1].key);
  assert.throws(() => addPerson(list, 'léa', '2026-11-24'), /already/);
  assert.throws(() => addPerson(list, '  ', '2026-11-24'), /name/);
  assert.deepEqual(removePerson(list, 'Léa').map((p) => p.name), ['Tom']);
});

test('the sealed list reads back with the master key only', async () => {
  const master = generateKey();
  const list = addPerson(addPerson([], 'Léa', '2026-11-23'), 'Tom', '2026-11-24');
  const bytes = await sealAccess(list, master);
  assert.deepEqual(await readAccess(bytes, master), list);
  await assert.rejects(readAccess(bytes, list[0].key), /wrong key/);
  assert.ok(!Buffer.from(bytes).includes('Tom'));
  assert.deepEqual(await readAccess(null, master), []);
});

test('a link carries the key after the #', () => {
  assert.equal(accessLink('https://x.github.io/agenda/', 'abc'), 'https://x.github.io/agenda/#k=abc');
});

test('every listed key and the master key open the data ; nobody else does', async () => {
  const master = generateKey();
  const list = addPerson(addPerson([], 'Léa', '2026-11-23'), 'Tom', '2026-11-24');
  const dataKey = generateKey();
  const data = await seal('{"events":[1,2,3]}', dataKey);
  const table = await wrapDataKey(list, master, dataKey);

  for (const key of [master, list[0].key, list[1].key]) {
    assert.equal(await open(data, await unwrapDataKey(table, key)), '{"events":[1,2,3]}');
  }
  assert.equal(await unwrapDataKey(table, generateKey()), null);
  // The table names nobody and holds no key.
  const published = JSON.stringify(table);
  for (const secret of ['Léa', 'Tom', master, list[0].key, dataKey]) assert.ok(!published.includes(secret));
  assert.deepEqual(Object.keys(table).sort(), (await Promise.all([master, list[0].key, list[1].key].map(keyId))).sort());
});

test('a revoked key opens neither the next table nor the next data', async () => {
  const master = generateKey();
  const before = addPerson(addPerson([], 'Léa', '2026-11-23'), 'Tom', '2026-11-24');
  const lea = before[0].key;
  const oldDataKey = generateKey();
  assert.equal(await unwrapDataKey(await wrapDataKey(before, master, oldDataKey), lea), oldDataKey);

  // The next build : Léa removed, a new data key.
  const after = removePerson(before, 'Léa');
  const newDataKey = generateKey();
  const data = await seal('next', newDataKey);
  const table = await wrapDataKey(after, master, newDataKey);
  assert.equal(await unwrapDataKey(table, lea), null);
  await assert.rejects(open(data, oldDataKey), /wrong key/);
  assert.equal(await open(data, await unwrapDataKey(table, after[0].key)), 'next');
});
