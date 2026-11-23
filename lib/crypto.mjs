// The snapshot published with the hosted page is encrypted : the repository
// and the page are public, the data is readable only with the key carried by
// the access link. AES-256-GCM over the gzipped JSON ; Web Crypto, so the
// same code runs in Node (sealing) and in the browser (opening).

const IV_BYTES = 12;

export function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text) {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

// A new key, as the 43 characters that go in the access link.
export function generateKey() {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function importKey(key) {
  let raw;
  try {
    raw = fromBase64Url(key);
  } catch {
    raw = [];
  }
  if (raw.length !== 32) throw new Error('invalid key');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function pipe(bytes, transform) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(transform)).arrayBuffer());
}

// text → bytes : a random IV, then the ciphertext and its tag.
export async function seal(text, key) {
  const aes = await importKey(key);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const packed = await pipe(new TextEncoder().encode(text), new CompressionStream('gzip'));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, packed));
  const bytes = new Uint8Array(IV_BYTES + sealed.length);
  bytes.set(iv);
  bytes.set(sealed, IV_BYTES);
  return bytes;
}

// bytes → text. Throws on a wrong key or on altered bytes.
export async function open(bytes, key) {
  const aes = await importKey(key);
  let packed;
  try {
    packed = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, IV_BYTES) }, aes, bytes.subarray(IV_BYTES));
  } catch {
    throw new Error('wrong key');
  }
  return new TextDecoder().decode(await pipe(new Uint8Array(packed), new DecompressionStream('gzip')));
}
