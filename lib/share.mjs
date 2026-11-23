// A search as the query string of the page's address, so that a search can
// be shared as a link. The search is the same object a saved search holds :
//   { anchor: { lat, lng, label } | null, radius, period, from, sort,
//     regions, departments, tag, category, search }
// Whatever is left at its default is left out of the address.

const PERIODS = ['all', 'upcoming', 'announced', 'past'];
const TAGS = ['regular', 'new', 'paused', 'oneoff'];
export const DEFAULTS = { anchor: null, radius: 100, period: 'all', from: '', sort: 'date', regions: [], departments: [], tag: '', category: '', search: '' };

export function toQuery(params) {
  const query = new URLSearchParams();
  const { anchor, regions, departments } = params;
  if (anchor) {
    query.set('lieu', anchor.label);
    // Five decimals : about a metre, and a readable address.
    query.set('lat', String(Math.round(anchor.lat * 1e5) / 1e5));
    query.set('lng', String(Math.round(anchor.lng * 1e5) / 1e5));
    query.set('rayon', String(params.radius));
  }
  if (params.period !== 'all') query.set('periode', params.period);
  if (params.from && (params.period === 'upcoming' || params.period === 'announced')) query.set('depuis', params.from);
  if (regions.length) query.set('regions', regions.join(','));
  if (departments.length) query.set('deps', departments.join(','));
  if (params.tag) query.set('tag', params.tag);
  if (params.category) query.set('cat', params.category);
  if (params.search.trim()) query.set('q', params.search.trim());
  if (anchor && params.sort === 'distance') query.set('tri', 'distance');
  return query.toString();
}

function list(text) {
  return text ? text.split(',').map((part) => part.trim()).filter(Boolean) : [];
}

// The search an address carries, or null when it carries none. A value that
// makes no sense is dropped, not trusted : the address is typed by anyone.
export function fromQuery(queryString) {
  const query = new URLSearchParams(queryString);
  let known = false;
  for (const name of ['lieu', 'lat', 'lng', 'rayon', 'periode', 'depuis', 'regions', 'deps', 'tag', 'cat', 'q', 'tri']) {
    if (query.has(name)) known = true;
  }
  if (!known) return null;

  const params = { ...DEFAULTS, regions: list(query.get('regions')), departments: list(query.get('deps')) };
  const lat = Number(query.get('lat'));
  const lng = Number(query.get('lng'));
  const label = (query.get('lieu') || '').trim();
  if (query.has('lat') && query.has('lng') && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
    params.anchor = { lat, lng, label: label || 'ce point' };
  } else if (label) {
    // A place given by name only : the page looks its town up.
    params.anchor = { lat: null, lng: null, label };
  }
  const radius = Math.round(Number(query.get('rayon')));
  if (radius >= 1 && radius <= 1000) params.radius = radius;
  if (PERIODS.includes(query.get('periode'))) params.period = query.get('periode');
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(query.get('depuis') || '')) params.from = query.get('depuis');
  if (TAGS.includes(query.get('tag'))) params.tag = query.get('tag');
  params.category = (query.get('cat') || '').trim();
  params.search = (query.get('q') || '').trim();
  if (query.get('tri') === 'distance') params.sort = 'distance';
  return params;
}
