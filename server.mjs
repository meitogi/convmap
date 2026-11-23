import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { fetchAgenda } from './lib/agenda.mjs';
import { createManualEvent, deleteManualEvent, deleteSearch, getMeta, listEvents, listSearches, openDb, saveSearch, updateEvent, upsertAgenda } from './lib/db.mjs';

const PORT = Number(process.env.PORT) || 4180;
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = fileURLToPath(new URL('.', import.meta.url));

// Everything the page may load : its own files, and the modules it
// shares with the server.
const FILES = {
  '/': 'public/index.html',
  '/app.js': 'public/app.js',
  '/store.js': 'public/store-api.js',
  '/copy.js': 'public/copy.js',
  '/favicon.svg': 'public/favicon.svg',
  '/apple-touch-icon.png': 'public/apple-touch-icon.png',
  '/app.css': 'public/app.css',
  '/vendor/leaflet/leaflet.js': 'public/vendor/leaflet/leaflet.js',
  '/vendor/leaflet/leaflet.css': 'public/vendor/leaflet/leaflet.css',
  '/lib/geo.mjs': 'lib/geo.mjs',
  '/lib/releases.mjs': 'lib/releases.mjs',
  '/CHANGELOG.md': 'CHANGELOG.md',
  '/lib/area.mjs': 'lib/area.mjs',
  '/lib/series.mjs': 'lib/series.mjs',
  '/lib/export.mjs': 'lib/export.mjs',
};
const TYPES = { html: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', png: 'image/png', md: 'text/markdown' };

mkdirSync(`${ROOT}data`, { recursive: true });
// AGENDA_DB : another base than the default one — the demo's, for instance.
const db = openDb(process.env.AGENDA_DB || `${ROOT}data/agenda.db`);
let refetching = null;

function send(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  let text = '';
  for await (const chunk of request) text += chunk;
  return JSON.parse(text || '{}');
}

async function refetch() {
  const rows = await fetchAgenda((page, pages) => console.log(`agenda : page ${page}/${pages}`));
  return upsertAgenda(db, rows, new Date().toISOString());
}

async function api(request, response, path, query) {
  const method = request.method;
  if (path === '/api/searches') {
    if (method === 'POST') saveSearch(db, await readJson(request));
    else if (method === 'DELETE') deleteSearch(db, query.get('name'));
    else if (method !== 'GET') return send(response, 404, { error: 'not found' });
    return send(response, 200, listSearches(db));
  }
  if (path === '/api/events' && method === 'GET') {
    return send(response, 200, { events: listEvents(db), fetchedAt: getMeta(db, 'fetched_at') });
  }
  if (path === '/api/events' && method === 'POST') {
    return send(response, 201, createManualEvent(db, await readJson(request)));
  }
  if (path === '/api/refetch' && method === 'POST') {
    // One fetch at a time : a second click joins the one in flight.
    refetching ??= refetch().finally(() => (refetching = null));
    return send(response, 200, await refetching);
  }
  const match = /^\/api\/events\/(\d+)$/.exec(path);
  if (match && method === 'PUT') {
    const event = updateEvent(db, Number(match[1]), await readJson(request));
    return event ? send(response, 200, event) : send(response, 404, { error: 'unknown event' });
  }
  if (match && method === 'DELETE') {
    return deleteManualEvent(db, Number(match[1])) ? send(response, 200, {}) : send(response, 404, { error: 'not a manual event' });
  }
  return send(response, 404, { error: 'not found' });
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const path = url.pathname;
  try {
    if (path.startsWith('/api/')) return await api(request, response, path, url.searchParams);
    const file = FILES[path];
    if (!file || request.method !== 'GET') return send(response, 404, { error: 'not found' });
    const body = await readFile(ROOT + file);
    response.writeHead(200, { 'content-type': `${TYPES[file.slice(file.lastIndexOf('.') + 1)]}; charset=utf-8`, 'cache-control': 'no-cache' });
    response.end(body);
  } catch (error) {
    console.error(`${request.method} ${path} : ${error.message}`);
    send(response, 400, { error: error.message });
  }
});

server.listen(PORT, HOST, () => console.log(`convmap : http://localhost:${PORT}`));
