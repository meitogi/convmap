import { DatabaseSync } from 'node:sqlite';

// Columns the agenda provides ; the same ones a manual edit may override.
export const FIELDS = ['title', 'start_date', 'end_date', 'venue', 'city', 'zip', 'lat', 'lng', 'category', 'url', 'website', 'organizer', 'email', 'phone'];
const NUMERIC = { lat: true, lng: true };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('agenda', 'manual')),
  source_id INTEGER UNIQUE,
  title TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  venue TEXT, city TEXT, zip TEXT, lat REAL, lng REAL,
  category TEXT, url TEXT, website TEXT,
  organizer TEXT, email TEXT, phone TEXT,
  overrides TEXT,
  note TEXT,
  gone_at TEXT,
  fetched_at TEXT
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS searches (name TEXT PRIMARY KEY, params TEXT NOT NULL);
`;

export function openDb(path) {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}

function clean(field, value) {
  if (NUMERIC[field]) {
    const number = value === '' || value == null ? NaN : Number(value);
    return Number.isFinite(number) ? number : null;
  }
  return value == null ? '' : String(value).trim();
}

// The row as the page shows it : manual overrides win over the agenda's values.
function present(row) {
  const overrides = row.overrides ? JSON.parse(row.overrides) : null;
  const event = { id: row.id, source: row.source, note: row.note || '', gone_at: row.gone_at, overridden: [] };
  for (const field of FIELDS) {
    if (overrides && field in overrides) {
      event[field] = overrides[field];
      event.overridden.push(field);
    } else {
      event[field] = row[field];
    }
  }
  return event;
}

export function listEvents(db) {
  return db.prepare('SELECT * FROM events ORDER BY start_date, id').all().map(present);
}

export function getMeta(db, key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : null;
}

function validate(values) {
  if (!values.title) throw new Error('title is required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.start_date)) throw new Error('start_date must be YYYY-MM-DD');
  if (values.end_date && !/^\d{4}-\d{2}-\d{2}$/.test(values.end_date)) throw new Error('end_date must be YYYY-MM-DD');
}

function cleanAll(input) {
  const values = {};
  for (const field of FIELDS) values[field] = clean(field, input[field]);
  return values;
}

export function createManualEvent(db, input) {
  const values = cleanAll(input);
  validate(values);
  const columns = FIELDS.join(', ');
  const marks = FIELDS.map(() => '?').join(', ');
  const result = db
    .prepare(`INSERT INTO events (source, note, ${columns}) VALUES ('manual', ?, ${marks})`)
    .run(clean('note', input.note), ...FIELDS.map((f) => values[f]));
  return getEvent(db, Number(result.lastInsertRowid));
}

export function getEvent(db, id) {
  const row = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  return row ? present(row) : null;
}

// A manual row is rewritten in place. An agenda row keeps its columns — the
// next re-fetch owns them — and stores only what differs, in `overrides`.
export function updateEvent(db, id, input) {
  const row = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!row) return null;
  // A field the caller did not send keeps its current value : the form has
  // no input for `url`, and that must not blank the link to the agenda.
  const current = present(row);
  const values = {};
  for (const field of FIELDS) values[field] = field in input ? clean(field, input[field]) : current[field];
  validate(values);
  const note = 'note' in input ? clean('note', input.note) : current.note;
  if (row.source === 'manual') {
    const sets = FIELDS.map((f) => `${f} = ?`).join(', ');
    db.prepare(`UPDATE events SET ${sets}, note = ? WHERE id = ?`).run(...FIELDS.map((f) => values[f]), note, id);
  } else {
    const overrides = {};
    let any = false;
    for (const field of FIELDS) {
      if (values[field] !== clean(field, row[field])) {
        overrides[field] = values[field];
        any = true;
      }
    }
    db.prepare('UPDATE events SET overrides = ?, note = ? WHERE id = ?').run(any ? JSON.stringify(overrides) : null, note, id);
  }
  return getEvent(db, id);
}

// Only what the user added themselves can be deleted.
export function deleteManualEvent(db, id) {
  return db.prepare("DELETE FROM events WHERE id = ? AND source = 'manual'").run(id).changes === 1;
}

// A saved search : a name and the page's filters (place, radius, period…),
// stored as the page sent them.
export function listSearches(db) {
  return db
    .prepare('SELECT name, params FROM searches ORDER BY name COLLATE NOCASE')
    .all()
    .map((row) => ({ name: row.name, params: JSON.parse(row.params) }));
}

export function saveSearch(db, input) {
  const name = clean('name', input.name);
  if (!name) throw new Error('name is required');
  db.prepare('INSERT INTO searches (name, params) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET params = excluded.params').run(
    name,
    JSON.stringify(input.params || {}),
  );
  return { name, params: input.params || {} };
}

export function deleteSearch(db, name) {
  return db.prepare('DELETE FROM searches WHERE name = ?').run(name).changes === 1;
}

// rows : the complete agenda, as mapEvent() rows. Refreshes the agenda's
// columns only ; overrides, notes and manual rows are never touched. An event
// missing from `rows` is kept and stamped `gone_at`.
export function upsertAgenda(db, rows, now) {
  const find = db.prepare('SELECT * FROM events WHERE source_id = ?');
  const insert = db.prepare(
    `INSERT INTO events (source, source_id, fetched_at, ${FIELDS.join(', ')}) VALUES ('agenda', ?, ?, ${FIELDS.map(() => '?').join(', ')})`,
  );
  const update = db.prepare(`UPDATE events SET fetched_at = ?, gone_at = NULL, ${FIELDS.map((f) => `${f} = ?`).join(', ')} WHERE source_id = ?`);
  const stats = { added: 0, changed: 0, gone: 0, total: rows.length };

  db.exec('BEGIN');
  try {
    for (const row of rows) {
      const values = FIELDS.map((f) => clean(f, row[f]));
      const sourceId = row.source_id;
      const existing = find.get(sourceId);
      if (!existing) {
        insert.run(sourceId, now, ...values);
        stats.added++;
        continue;
      }
      if (existing.gone_at || FIELDS.some((f, i) => clean(f, existing[f]) !== values[i])) stats.changed++;
      update.run(now, ...values, sourceId);
    }
    stats.gone = Number(
      db.prepare("UPDATE events SET gone_at = ? WHERE source = 'agenda' AND gone_at IS NULL AND fetched_at <> ?").run(now, now).changes,
    );
    db.prepare("INSERT INTO meta (key, value) VALUES ('fetched_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(now);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return stats;
}
