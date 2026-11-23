import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKey, open, seal } from '../lib/crypto.mjs';

const text = JSON.stringify({ fetchedAt: '2026-11-23T10:00:00Z', events: [{ title: 'Évènement — été', email: 'a@example.org' }] });

test('a key is 32 random bytes, safe in a link', () => {
  const key = generateKey();
  assert.match(key, /^[\w-]{43}$/);
  assert.notEqual(key, generateKey());
});

test('what is sealed opens with its key, and only with it', async () => {
  const key = generateKey();
  const bytes = await seal(text, key);
  assert.equal(await open(bytes, key), text);
  await assert.rejects(open(bytes, generateKey()), /wrong key/);
  await assert.rejects(open(bytes, 'abc'), /invalid key/);
  await assert.rejects(seal(text, ''), /invalid key/);
});

test('the sealed bytes show nothing of the text and differ each time', async () => {
  const key = generateKey();
  const first = await seal(text, key);
  const second = await seal(text, key);
  assert.ok(!Buffer.from(first).includes('example.org'));
  assert.ok(!Buffer.from(first).includes('fetchedAt'));
  assert.notDeepEqual(first, second);
});

test('altered bytes are refused', async () => {
  const key = generateKey();
  const bytes = await seal(text, key);
  bytes[bytes.length - 1] ^= 1;
  await assert.rejects(open(bytes, key), /wrong key/);
});
