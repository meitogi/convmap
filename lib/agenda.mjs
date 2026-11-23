const API = 'https://lagendageek.com/wp-json/tribe/events/v1/events';
const PER_PAGE = 50;
const PAUSE_MS = 300;

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ndash: '–', mdash: '—', hellip: '…' };

export function decodeEntities(text) {
  if (!text) return '';
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (entity, name) => NAMED[name] ?? entity)
    .trim();
}

// One event of the agenda's REST API → one row of the `events` table.
export function mapEvent(raw) {
  // The API answers `venue: []` when an event has no venue.
  const venue = Array.isArray(raw.venue) ? {} : raw.venue || {};
  const organizer = (raw.organizer || [])[0] || {};
  const category = (raw.categories || [])[0];
  return {
    source_id: raw.id,
    title: decodeEntities(raw.title),
    start_date: raw.start_date.slice(0, 10),
    end_date: (raw.end_date || raw.start_date).slice(0, 10),
    venue: decodeEntities(venue.venue),
    city: decodeEntities(venue.city),
    zip: venue.zip || '',
    lat: typeof venue.geo_lat === 'number' ? venue.geo_lat : null,
    lng: typeof venue.geo_lng === 'number' ? venue.geo_lng : null,
    category: category ? decodeEntities(category.name) : '',
    url: raw.url || '',
    website: raw.website || '',
    organizer: decodeEntities(organizer.organizer),
    email: organizer.email || '',
    phone: organizer.phone || '',
  };
}

// Every event the agenda publishes, past and future. Throws on the first
// failed page : a partial list must never reach the upsert, it would mark
// the missing events as gone.
export async function fetchAgenda(onPage) {
  const rows = [];
  let pages = 1;
  for (let page = 1; page <= pages; page++) {
    const url = `${API}?per_page=${PER_PAGE}&page=${page}&start_date=2015-01-01&end_date=2040-12-31`;
    // The site is on shared hosting and answers an occasional 503 : a page
    // gets three tries before the whole fetch is given up.
    let response;
    for (let attempt = 1; ; attempt++) {
      response = await fetch(url, { headers: { 'user-agent': 'agenda-geek (local tool)' } });
      if (response.ok) break;
      if (response.status < 500 || attempt === 3) throw new Error(`agenda page ${page} : HTTP ${response.status}`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 3000));
    }
    const body = await response.json();
    pages = body.total_pages;
    for (const raw of body.events) rows.push(mapEvent(raw));
    if (onPage) onPage(page, pages);
    if (page < pages) await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
  }
  if (!rows.length) throw new Error('agenda returned no event');
  return rows;
}
