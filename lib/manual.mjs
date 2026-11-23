// The shared manual base : events L'Agenda Geek does not list, and links
// added to any edition (a Facebook event, a local agenda's page…). It is
// kept sealed in snapshot/manual.bin and filled with scripts/manual.mjs.
//
// Its editions join the agenda's feed as ordinary agenda rows, marked
// `origin: 'shared'`, so the merge, the overrides and the notes work on them
// unchanged. The document :
//
//   { series: [{ title, venue, city, zip, country, lat, lng, category,
//                website, facebook, instagram, organizer, email, phone,
//                editions: [{ start_date, end_date, links: [url], note,
//                             …any series field, for this edition only }] }],
//     agenda_links: { '<agenda id>': [url] } }
//
// An edition's `note` is the curator's memo (where a date was found…) ; it
// is not published.

import { FIELDS } from './events.mjs';
import { normalizeTitle } from './series.mjs';

// Agenda ids are WordPress post ids, far below this.
export const SHARED_ID_BASE = 2e9;
// What a series may set ; an edition may set the same, for itself.
const SERIES_FIELDS = FIELDS.filter((field) => field !== 'url' && field !== 'links' && field !== 'origin');
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function emptyDoc() {
  return { series: [], agenda_links: {} };
}

// FNV-1a : the same title and date always give the same id, so a person's
// corrections on a shared edition survive the next publication.
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function sharedId(title, startDate) {
  return SHARED_ID_BASE + hash(`${normalizeTitle(title)}|${startDate}`);
}

function checkLinks(links, where, problems) {
  if (links === undefined) return;
  if (!Array.isArray(links)) return problems.push(`${where} : links doit être une liste`);
  for (const link of links) if (!/^https?:\/\/\S+$/.test(link)) problems.push(`${where} : lien invalide « ${link} »`);
}

function checkFields(entry, where, problems) {
  for (const field of ['lat', 'lng']) {
    if (field in entry && entry[field] !== null && !Number.isFinite(entry[field])) problems.push(`${where} : ${field} doit être un nombre`);
  }
}

// Every problem of the document, each naming its entry ; [] when it is valid.
export function validate(doc) {
  const problems = [];
  if (!doc || !Array.isArray(doc.series)) return ['series doit être une liste'];
  const ids = {};
  doc.series.forEach((series, i) => {
    const where = `series[${i}] « ${series.title || '?'} »`;
    if (!series.title) problems.push(`${where} : title manque`);
    checkFields(series, where, problems);
    if (!Array.isArray(series.editions) || !series.editions.length) return problems.push(`${where} : editions doit contenir au moins une édition`);
    series.editions.forEach((edition, j) => {
      const at = `${where} editions[${j}]`;
      if (!DATE.test(edition.start_date || '')) problems.push(`${at} : start_date doit être AAAA-MM-JJ`);
      if (edition.end_date && !DATE.test(edition.end_date)) problems.push(`${at} : end_date doit être AAAA-MM-JJ`);
      if (edition.end_date && edition.end_date < edition.start_date) problems.push(`${at} : end_date avant start_date`);
      checkFields(edition, at, problems);
      checkLinks(edition.links, at, problems);
      const id = sharedId(edition.title || series.title || '', edition.start_date || '');
      if (ids[id]) problems.push(`${at} : même titre et même date que ${ids[id]}`);
      ids[id] = at;
    });
  });
  const agendaLinks = doc.agenda_links || {};
  for (const id in agendaLinks) {
    if (!/^\d+$/.test(id)) problems.push(`agenda_links : « ${id} » n'est pas un id de l'agenda`);
    checkLinks(agendaLinks[id], `agenda_links[${id}]`, problems);
  }
  return problems;
}

// One feed row per edition, shaped as mapEvent() rows : the series' fields,
// then the edition's own on top.
export function manualRows(doc) {
  const rows = [];
  for (const series of doc.series) {
    for (const edition of series.editions) {
      const row = { url: '' };
      for (const field of SERIES_FIELDS) {
        const value = field in edition ? edition[field] : series[field];
        row[field] = value === undefined ? (field === 'lat' || field === 'lng' ? null : '') : value;
      }
      row.title = edition.title || series.title;
      row.end_date = edition.end_date || edition.start_date;
      row.links = (edition.links || []).join('\n');
      row.origin = 'shared';
      row.source_id = sharedId(row.title, row.start_date);
      rows.push(row);
    }
  }
  return rows;
}

// The feed published with the page : the agenda's events, with the links
// added to them, followed by the shared editions.
export function withManual(agendaEvents, doc) {
  const agendaLinks = doc.agenda_links || {};
  const feed = agendaEvents.map((event) => {
    const links = agendaLinks[event.source_id];
    return links ? { ...event, links: links.join('\n') } : event;
  });
  for (const row of manualRows(doc)) feed.push(row);
  return feed;
}
