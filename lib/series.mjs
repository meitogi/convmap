import { distanceKm } from './geo.mjs';

// A link to one Facebook event or post, as opposed to a page.
const FB_EVENT = /facebook\.com\/(events|share|story\.php|photo|permalink\.php)\b|fb\.me\/e\//i;

// Two editions of the same title further apart than this are different series
// (a touring show), closer they are one (a local move).
export const SERIES_RADIUS_KM = 50;
const PAUSED_AFTER_MONTHS = 18;
const NEW_WITHIN_MONTHS = 12;

// "Geek Days Rennes 2026" and "Geek Days Rennes 2025" must give the same key ;
// so must "L'Imagina'Livres 8ème édition" and "L'Imagina'Livres 2024".
export function normalizeTitle(title) {
  const base = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const key = base
    .replace(/\b(19|20)\d\d\b/g, ' ')
    .replace(/#\s*\d+|\bn°\s*\d+/g, ' ')
    .replace(/\b\d+\s*(e|eme|er|ere|nde?|th)\b/g, ' ')
    .replace(/\bedition\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/(\s\d+)+\s*$/, '')
    .trim();
  return key || base.replace(/[^a-z0-9]+/g, ' ').trim();
}

// The title as shown for the whole series : the edition's title minus its
// year and its trailing "#2".
export function seriesName(title) {
  return title
    .replace(/\b(19|20)\d\d\b/g, '')
    .replace(/#\s*\d+\s*$/, '')
    .replace(/\s+/g, ' ')
    .replace(/[\s–—\-:|,]+$/, '')
    .trim();
}

// 'YYYY-MM-DD' shifted by a number of months, as 'YYYY-MM' (day ignored).
function monthShift(date, months) {
  const total = Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1 + months;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

function sameCluster(cluster, event) {
  const ref = cluster.ref;
  if (ref.lat != null && event.lat != null) {
    return distanceKm(ref.lat, ref.lng, event.lat, event.lng) <= SERIES_RADIUS_KM;
  }
  return (ref.city || '').toLowerCase() === (event.city || '').toLowerCase();
}

function describe(editions, today) {
  const count = editions.length;
  const last = editions[count - 1];
  const years = [];
  const months = [];
  let next = null;
  for (let i = 0; i < count; i++) {
    const edition = editions[i];
    const start = edition.start_date;
    const year = start.slice(0, 4);
    if (!years.includes(year)) years.push(year);
    months.push(Number(start.slice(5, 7)));
    if (!next && (edition.end_date || start) >= today) next = edition;
  }

  const lastMonth = last.start_date.slice(0, 7);
  const recurring = years.length >= 2;
  let tag;
  if (recurring) tag = next || lastMonth >= monthShift(today, -PAUSED_AFTER_MONTHS) ? 'regular' : 'paused';
  else tag = next || lastMonth >= monthShift(today, -NEW_WITHIN_MONTHS) ? 'new' : 'oneoff';

  let upcoming = null;
  if (next) {
    upcoming = { announced: true, event: next, month: next.start_date.slice(0, 7) };
  } else if (tag === 'regular') {
    // Median month of the known editions, on the first year still ahead.
    months.sort((a, b) => a - b);
    const month = String(months[months.length >> 1]).padStart(2, '0');
    const thisMonth = today.slice(0, 7);
    let year = Number(last.start_date.slice(0, 4)) + 1;
    while (`${year}-${month}` < thisMonth) year++;
    upcoming = { announced: false, event: null, month: `${year}-${month}` };
  }

  let located = last;
  for (let i = count - 1; i >= 0 && located.lat == null; i--) {
    if (editions[i].lat != null) located = editions[i];
  }
  const contact = {};
  for (const field of ['website', 'organizer', 'email', 'phone', 'instagram']) {
    for (let i = count - 1; i >= 0 && !contact[field]; i--) contact[field] = editions[i][field] || '';
  }
  // The series' Facebook is its page. An event link speaks for one edition
  // only : it is used when it is the next (or else the last) edition's own.
  let facebook = '';
  for (let i = count - 1; i >= 0 && !facebook; i--) {
    const link = editions[i].facebook;
    if (link && !FB_EVENT.test(link)) facebook = link;
  }
  contact.facebook = facebook || (next || last).facebook || '';

  return {
    id: `s${editions[0].id}`,
    name: seriesName(last.title) || last.title,
    city: located.city || '',
    zip: located.zip || '',
    country: located.country || '',
    lat: located.lat,
    lng: located.lng,
    category: last.category || '',
    tag,
    upcoming,
    editions,
    ...contact,
  };
}

// events : rows of the `events` table (overrides already applied).
// today : 'YYYY-MM-DD'. Returns one entry per recurring event.
export function buildSeries(events, today) {
  const sorted = events.slice().sort((a, b) => (a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : a.id - b.id));
  const buckets = {};
  for (const event of sorted) {
    const key = normalizeTitle(event.title);
    const clusters = (buckets[key] ??= []);
    let cluster = clusters.find((c) => sameCluster(c, event));
    if (!cluster) clusters.push((cluster = { ref: event, editions: [] }));
    cluster.editions.push(event);
    if (event.lat != null) cluster.ref = event;
  }
  const series = [];
  for (const key in buckets) {
    for (const cluster of buckets[key]) series.push(describe(cluster.editions, today));
  }
  return series;
}
