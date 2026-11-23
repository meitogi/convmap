const API = 'https://lagendageek.com/wp-json/tribe/events/v1/events';
const PER_PAGE = 50;
const PAUSE_MS = 300;
// Node names itself. A browser must not : a custom header turns the request
// into one the agenda's CORS rules refuse.
const HEADERS = typeof window === 'undefined' ? { headers: { 'user-agent': 'convmap' } } : {};

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ndash: '–', mdash: '—', hellip: '…' };

// The agenda spells a country several ways.
const COUNTRIES = { FR: 'France', BE: 'Belgique', Belgium: 'Belgique', Switzerland: 'Suisse' };

export function decodeEntities(text) {
  if (!text) return '';
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (entity, name) => NAMED[name] ?? entity)
    .trim();
}

const URLS = /https?:\/\/[^\s"'<>)\]]+/gi;
// Facebook paths that are not anyone's page.
const FB_SKIP = { 'l.php': true, sharer: true, 'sharer.php': true, hashtag: true, dialog: true, login: true, plugins: true, tr: true };
// Facebook paths that point at one event or one post, not at a page.
const FB_EVENT = { events: true, e: true, share: true, 'story.php': true, 'photo.php': true, photo: true, 'permalink.php': true };
const IG_SKIP = { p: true, reel: true, reels: true, explore: true, stories: true, tv: true, accounts: true };

// The Facebook and Instagram links found in a list of texts. A Facebook page
// wins over an event link ; tracking parameters are dropped.
function scanSocial(texts, found) {
  for (const text of texts) {
    for (const match of (text || '').match(URLS) || []) {
      let url;
      try {
        url = new URL(match.replace(/&amp;/g, '&').replace(/[.,;]+$/, ''));
      } catch {
        continue;
      }
      const host = url.hostname.toLowerCase();
      const path = url.pathname.replace(/\/+$/, '');
      const first = (path.split('/')[1] || '').toLowerCase();
      if (!first) continue;
      if (host === 'instagram.com' || host === 'www.instagram.com') {
        if (!found.instagram && !IG_SKIP[first]) found.instagram = `https://www.instagram.com/${path.split('/')[1]}/`;
      } else if (host === 'fb.me' || (/(^|\.)(facebook|fb)\.com$/.test(host) && !host.startsWith('l.'))) {
        if (FB_SKIP[first]) continue;
        const event = host === 'fb.me' ? first === 'e' : !!FB_EVENT[first];
        if (found.facebook && (found.facebookIsPage || event)) continue;
        const id = url.searchParams.get('id');
        found.facebook = host === 'fb.me' ? `https://fb.me${path}` : `https://www.facebook.com${path}${first === 'profile.php' && id ? `?id=${id}` : ''}`;
        found.facebookIsPage = !event;
      }
    }
  }
}

// Where the agenda carries social links : its free-form custom fields (their
// labels are unreliable, so every value is read), the event's website, the
// organizer's website. The description is a last resort — it also links to
// other people's pages.
export function socialLinks(raw) {
  const texts = [];
  const custom = raw.custom_fields || {};
  for (const key in custom) {
    const value = custom[key].value;
    if (typeof value === 'string') texts.push(value);
  }
  texts.push(raw.website);
  for (const organizer of raw.organizer || []) texts.push(organizer.website);
  const found = { facebook: '', instagram: '', facebookIsPage: false };
  scanSocial(texts, found);
  if (!found.facebook || !found.instagram) scanSocial([raw.description], found);
  return { facebook: found.facebook, instagram: found.instagram };
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
    country: COUNTRIES[venue.country] || venue.country || '',
    lat: typeof venue.geo_lat === 'number' ? venue.geo_lat : null,
    lng: typeof venue.geo_lng === 'number' ? venue.geo_lng : null,
    category: category ? decodeEntities(category.name) : '',
    url: raw.url || '',
    website: raw.website || '',
    organizer: decodeEntities(organizer.organizer),
    email: organizer.email || '',
    phone: organizer.phone || '',
    ...socialLinks(raw),
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
      response = await fetch(url, HEADERS);
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
