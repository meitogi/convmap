// The rules of an event row, shared by the SQLite store (the local server)
// and the browser store (the hosted page). A row is :
//   { id, source: 'agenda' | 'manual', source_id, ...FIELDS,
//     overrides: JSON text | null, note, gone_at, fetched_at }

// Columns the agenda provides ; the same ones a manual edit may override.
export const FIELDS = ['title', 'start_date', 'end_date', 'venue', 'city', 'zip', 'country', 'lat', 'lng', 'category', 'url', 'website', 'organizer', 'email', 'phone', 'facebook', 'instagram'];
const NUMERIC = { lat: true, lng: true };

export function clean(field, value) {
  if (NUMERIC[field]) {
    const number = value === '' || value == null ? NaN : Number(value);
    return Number.isFinite(number) ? number : null;
  }
  return value == null ? '' : String(value).trim();
}

function validate(values) {
  if (!values.title) throw new Error('title is required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.start_date)) throw new Error('start_date must be YYYY-MM-DD');
  if (values.end_date && !/^\d{4}-\d{2}-\d{2}$/.test(values.end_date)) throw new Error('end_date must be YYYY-MM-DD');
}

// The row as the page shows it : manual overrides win over the agenda's values.
export function present(row) {
  const overrides = row.overrides ? JSON.parse(row.overrides) : null;
  const event = { id: row.id, source: row.source, note: row.note || '', gone_at: row.gone_at || null, overridden: [] };
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

// The columns of a new manual event, validated.
export function manualValues(input) {
  const values = {};
  for (const field of FIELDS) values[field] = clean(field, input[field]);
  validate(values);
  values.note = clean('note', input.note);
  return values;
}

// What an edit changes on a row, as { column: value }. A manual row is
// rewritten in place. An agenda row keeps its columns — the next re-fetch
// owns them — and stores only what differs, in `overrides`.
export function editChanges(row, input) {
  // A field the caller did not send keeps its current value : the form has
  // no input for `url`, and that must not blank the link to the agenda.
  const current = present(row);
  const values = {};
  for (const field of FIELDS) values[field] = field in input ? clean(field, input[field]) : current[field];
  validate(values);
  const note = 'note' in input ? clean('note', input.note) : current.note;
  if (row.source === 'manual') return { ...values, note };
  const overrides = {};
  let any = false;
  for (const field of FIELDS) {
    if (values[field] !== clean(field, row[field])) {
      overrides[field] = values[field];
      any = true;
    }
  }
  return { overrides: any ? JSON.stringify(overrides) : null, note };
}

// rows : every row held so far ; fresh : the complete agenda, as mapEvent()
// rows. Returns the new rows and what changed. Only the agenda's columns are
// refreshed ; overrides, notes and manual rows are never touched, and an
// event missing from `fresh` is kept, stamped `gone_at`. An agenda row's id
// is its agenda id.
export function mergeAgenda(rows, fresh, now) {
  const known = {};
  for (const row of rows) if (row.source === 'agenda') known[row.source_id] = row;
  const stats = { added: 0, changed: 0, gone: 0, total: fresh.length };
  const merged = [];
  for (const row of rows) if (row.source !== 'agenda') merged.push(row);
  for (const incoming of fresh) {
    const sourceId = incoming.source_id;
    const existing = known[sourceId];
    const row = existing ? { ...existing } : { id: sourceId, source: 'agenda', source_id: sourceId, overrides: null, note: '' };
    let changed = !!(existing && existing.gone_at);
    for (const field of FIELDS) {
      const value = clean(field, incoming[field]);
      if (existing && clean(field, existing[field]) !== value) changed = true;
      row[field] = value;
    }
    if (!existing) stats.added++;
    else if (changed) stats.changed++;
    row.gone_at = null;
    row.fetched_at = now;
    merged.push(row);
    delete known[sourceId];
  }
  for (const sourceId in known) {
    const row = known[sourceId];
    if (!row.gone_at) {
      stats.gone++;
      merged.push({ ...row, gone_at: now });
    } else {
      merged.push(row);
    }
  }
  return { rows: merged, stats };
}
