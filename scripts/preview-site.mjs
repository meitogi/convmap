// Serves _site/ as GitHub Pages will, to try the hosted page — and its
// admin.html — before or without publishing. Build first : npm run preview
// does both.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT) || 4181;
const site = fileURLToPath(new URL('../_site', import.meta.url));
const TYPES = { html: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json', bin: 'application/octet-stream' };

if (!existsSync(site)) {
  console.error('No _site/ yet : run node scripts/build-site.mjs first.');
  process.exit(1);
}

createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  // normalize() folds any "..", so the file always stays inside _site/.
  let file = join(site, normalize(`/${path}`));
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) {
    response.writeHead(404, { 'content-type': 'text/plain' });
    return response.end('not found');
  }
  response.writeHead(200, { 'content-type': `${TYPES[file.slice(file.lastIndexOf('.') + 1)] || 'application/octet-stream'}; charset=utf-8`, 'cache-control': 'no-cache' });
  response.end(readFileSync(file));
}).listen(PORT, '127.0.0.1', () => {
  const keyFile = new URL('../.agenda-key', import.meta.url);
  const key = existsSync(keyFile) ? readFileSync(keyFile, 'utf8').trim() : '<master key>';
  console.log(`Hosted page, as published : http://localhost:${PORT}/#k=${key}
Access page               : http://localhost:${PORT}/admin.html#k=${key}`);
});
