import { DatabaseSync } from 'node:sqlite';

import { clean, editChanges, FIELDS, manualValues, present } from './events.mjs';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('agenda', 'manual')),
  source_id INTEGER UNIQUE,
  title TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  venue TEXT, city TEXT, zip TEXT, country TEXT, lat REAL, lng REAL,
  category TEXT, url TEXT, website TEXT,
  organizer TEXT, email TEXT, phone TEXT, facebook TEXT, instagram TEXT,
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
  // A base created before a field existed gets its column.
  const columns = db.prepare('PRAGMA table_info(events)').all().map((column) => column.name);
  for (const field of FIELDS) {
    if (!columns.includes(field)) db.exec(`ALTER TABLE events ADD COLUMN ${field} TEXT`);
  }
  return db;
}

export function listEvents(db) {
  return db.prepare('SELECT * FROM events ORDER BY start_date, id').all().map(present);
}

export function getMeta(db, key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function createManualEvent(db, input) {
  const values = manualValues(input);
  const columns = FIELDS.join(', ');
  const marks = FIELDS.map(() => '?').join(', ');
  const result = db
    .prepare(`INSERT INTO events (source, note, ${columns}) VALUES ('manual', ?, ${marks})`)
    .run(values.note, ...FIELDS.map((f) => values[f]));
  return getEvent(db, Number(result.lastInsertRowid));
}

export function getEvent(db, id) {
  const row = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  return row ? present(row) : null;
}

export function updateEvent(db, id, input) {
  const row = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!row) return null;
  const changes = editChanges(row, input);
  const columns = [];
  const values = [];
  for (const column in changes) {
    columns.push(`${column} = ?`);
    values.push(changes[column]);
  }
  db.prepare(`UPDATE events SET ${columns.join(', ')} WHERE id = ?`).run(...values, id);
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

// rows : the complete feed, as mapEvent() rows. Refreshes the feed's
// columns only ; overrides, notes and manual rows are never touched. An event
// missing from `rows` is kept and stamped `gone_at` — a shared-base edition
// is deleted instead (see mergeAgenda). readAt : when the agenda itself was
// read, shown on the page ; `now` unless only the shared base changed.
export function upsertAgenda(db, rows, now, readAt = now) {
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
    db.prepare("DELETE FROM events WHERE source = 'agenda' AND origin = 'shared' AND fetched_at <> ?").run(now);
    stats.gone = Number(
      db.prepare("UPDATE events SET gone_at = ? WHERE source = 'agenda' AND gone_at IS NULL AND fetched_at <> ?").run(now, now).changes,
    );
    db.prepare("INSERT INTO meta (key, value) VALUES ('fetched_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(readAt);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return stats;
}
