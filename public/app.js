import { areaOf, DEPARTMENTS, REGIONS } from './lib/area.mjs';
import { monthLabel, rangeLabel, TAG_LABELS, toCsv, toMarkdown, toText, toTsv } from './lib/export.mjs';
import { distanceKm } from './lib/geo.mjs';
import { parseReleases } from './lib/releases.mjs';
import { buildSeries } from './lib/series.mjs';
import { fromQuery, toQuery } from './lib/share.mjs';
import { copyWith } from './copy.js';
import * as store from './store.js';

const L = window.L;
const $ = (id) => document.getElementById(id);
const STORE = 'convmap';
const TAG_COLORS = { regular: '#1a7f4b', new: '#b25e00', paused: '#8a5cc7', oneoff: '#667085' };
const FORMATS = {
  text: { make: toText, ext: 'txt', mime: 'text/plain', hint: 'À coller tel quel dans un SMS ou un mail.' },
  tsv: { make: toTsv, ext: 'tsv', mime: 'text/tab-separated-values', hint: "Copier, puis coller dans une cellule d'Excel, Numbers ou Sheets : les colonnes se remplissent." },
  md: { make: toMarkdown, ext: 'md', mime: 'text/markdown', hint: 'Un tableau Markdown.' },
  csv: { make: toCsv, ext: 'csv', mime: 'text/csv', hint: "Fichier à télécharger puis ouvrir dans Excel ou Numbers (séparateur point-virgule)." },
};

function pad(number) {
  return String(number).padStart(2, '0');
}
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORE)) || {};
  } catch {
    return {};
  }
}
const saved = loadState();
const state = {
  anchor: saved.anchor || null,
  radius: saved.radius || 100,
  period: saved.period || 'all',
  from: saved.from || '',
  sort: saved.sort || 'date',
  regions: saved.regions || [],
  departments: saved.departments || [],
  checked: saved.checked || {},
};
function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify(state));
  } catch {
    // Private window : the page works, it just forgets.
  }
}

let events = [];
let series = [];
let cities = {};
let extras = {};
let visible = [];
let unlocated = [];

// Accent- and case-insensitive form, for city lookup and text search.
function fold(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function el(tag, props, ...children) {
  const node = document.createElement(tag);
  if (props) Object.assign(node, props);
  for (const child of children) if (child != null && child !== '') node.append(child);
  return node;
}

// Only http(s) becomes a link : these URLs come from someone else's site.
function link(url, text) {
  if (!/^https?:\/\//i.test(url)) return text;
  return el('a', { href: url, target: '_blank', rel: 'noopener' }, text);
}

function showStatus(text) {
  const status = $('status');
  status.hidden = !text;
  status.textContent = text;
}

// ─── Theme ──────────────────────────────────────────────────────────────

// The button shows where a click leads : a moon in the light theme, a sun
// in the dark one.
const THEME_ICONS = {
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  sun: '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>',
};

function showTheme() {
  const dark = document.documentElement.dataset.theme === 'dark';
  const button = $('theme');
  const label = dark ? 'Passer au thème clair' : 'Passer au thème sombre';
  button.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${THEME_ICONS[dark ? 'sun' : 'moon']}</svg>`;
  button.title = label;
  button.ariaLabel = label;
}
$('theme').addEventListener('click', () => {
  const root = document.documentElement;
  const theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  root.dataset.theme = theme;
  try {
    localStorage.setItem('convmap-theme', theme);
  } catch {
    // Private window : the choice lasts for this visit.
  }
  showTheme();
});
showTheme();

// ─── Small screens : the list or the map, one at a time ─────────────────

const SMALL = matchMedia('(max-width: 860px)');

function setView(view) {
  document.body.dataset.view = view;
  for (const button of document.querySelectorAll('.views button')) button.ariaPressed = String(button.dataset.view === view);
  if (view !== 'map') return;
  // The map was hidden : it has to measure itself again before it can frame
  // the search.
  map.invalidateSize();
  if (state.anchor) drawZone();
  else fitVisible();
}

document.querySelector('.views').addEventListener('click', (event) => {
  const view = event.target.dataset.view;
  if (view) setView(view);
});

$('filters-toggle').addEventListener('click', () => {
  const open = document.body.classList.toggle('filters-open');
  $('filters-toggle').ariaExpanded = String(open);
});

// ─── Map ────────────────────────────────────────────────────────────────

const map = L.map('map', { preferCanvas: true }).setView([46.6, 2.4], 6);
map.attributionControl.setPrefix(false);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(map);
const zone = L.layerGroup().addTo(map);
const markers = L.layerGroup().addTo(map);
// The ring around the event last picked in the list.
const picked = L.layerGroup().addTo(map);
const markerOf = {};

function drawZone() {
  zone.clearLayers();
  const anchor = state.anchor;
  if (!anchor) return;
  const center = [anchor.lat, anchor.lng];
  const circle = L.circle(center, { radius: state.radius * 1000, color: '#1f5fd1', weight: 1.5, fillOpacity: 0.05, interactive: false }).addTo(zone);
  L.circleMarker(center, { radius: 4, color: '#1f5fd1', fillOpacity: 1, interactive: false }).addTo(zone);
  map.fitBounds(circle.getBounds(), { padding: [10, 10] });
}

function drawMarkers() {
  markers.clearLayers();
  picked.clearLayers();
  for (const id in markerOf) delete markerOf[id];
  for (const { series: s } of visible) {
    if (s.lat == null) continue;
    const id = s.id;
    markerOf[id] = L.circleMarker([s.lat, s.lng], { radius: 7, color: '#fff', weight: 1.5, fillColor: TAG_COLORS[s.tag], fillOpacity: 1 })
      .bindTooltip(`${s.name} — ${s.city}`)
      .on('click', (event) => {
        L.DomEvent.stopPropagation(event);
        if (SMALL.matches) showMapCard(id);
        else focusRow(id);
      })
      .addTo(markers);
  }
}

// On a small screen the list is not beside the map : the event that was
// touched shows in a card over the map, with everything its row has.
function showMapCard(id) {
  const item = visible.find((candidate) => candidate.series.id === id);
  const card = $('map-card');
  card.hidden = !item;
  if (!item) return;
  const entry = row(item);
  entry.removeAttribute('id');
  const inList = el('button', { type: 'button' }, 'Voir dans la liste');
  inList.dataset.focus = id;
  const close = el('button', { type: 'button' }, 'Fermer');
  close.dataset.close = 'card';
  card.replaceChildren(entry, el('div', { className: 'actions' }, inList, close));
}

// A click on a row shows its event on the map : centred, ringed, named. On a
// small screen the map takes the place of the list, with the event's card
// over it, as when its point is touched.
function showOnMap(id) {
  const marker = markerOf[id];
  if (!marker) return;
  const position = marker.getLatLng();
  const small = SMALL.matches;
  if (small) setView('map');
  map.setView(position, Math.max(map.getZoom(), 11));
  picked.clearLayers();
  L.circleMarker(position, { radius: 13, color: '#1f5fd1', weight: 3, fill: false, interactive: false }).addTo(picked);
  // Its row stays outlined, so that the list says which point is ringed.
  for (const row of document.querySelectorAll('.row.picked')) row.classList.remove('picked');
  $(`row-${id}`)?.classList.add('picked');
  if (small) showMapCard(id);
  else marker.openTooltip();
}

function focusRow(id) {
  const node = $(`row-${id}`);
  if (!node) return;
  setView('list');
  node.scrollIntoView({ block: 'center', behavior: 'smooth' });
  node.classList.add('flash');
  setTimeout(() => node.classList.remove('flash'), 1800);
}

function nearestCity(lat, lng) {
  let best = '';
  let bestKm = Infinity;
  for (const key in cities) {
    const city = cities[key];
    const km = distanceKm(lat, lng, city.lat, city.lng);
    if (km < bestKm) {
      bestKm = km;
      best = city.name;
    }
  }
  return best;
}

function setAnchor(anchor) {
  state.anchor = anchor;
  $('place').value = anchor ? anchor.label : '';
  syncSort();
  save();
  showStatus('');
  drawZone();
  render();
}

// A click on the map sets the place only after "Sur la carte" : the
// map can then be dragged and clicked without moving the search.
let picking = false;

function setPicking(on) {
  picking = on;
  const button = $('pick-place');
  button.ariaPressed = String(on);
  button.textContent = on ? 'Annuler' : 'Sur la carte';
  showStatus(on ? 'Clique un point sur la carte pour en faire le lieu de la recherche (Échap pour annuler).' : '');
  $('map').classList.toggle('picking', on);
  // On a small screen the map is its own view : go there to pick, come back
  // to the list once done.
  if (!SMALL.matches) return;
  // The unfolded filters would leave the map a thin strip : fold them.
  if (on) {
    document.body.classList.remove('filters-open');
    $('filters-toggle').ariaExpanded = 'false';
  }
  setView(on ? 'map' : 'list');
}

$('pick-place').addEventListener('click', () => setPicking(!picking));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && picking) setPicking(false);
});

map.on('click', (event) => {
  $('map-card').hidden = true;
  if (!picking) return;
  setPicking(false);
  const { lat, lng } = event.latlng;
  setAnchor({ lat, lng, label: nearestCity(lat, lng) || 'ce point' });
});

// ─── Data ───────────────────────────────────────────────────────────────

function sortKey(s) {
  const upcoming = s.upcoming;
  if (!upcoming) return '';
  // A probable month sorts after the announced dates of that month.
  return upcoming.announced ? upcoming.event.start_date : `${upcoming.month}-32`;
}

async function load() {
  const body = await store.listEvents();
  events = body.events;
  series = buildSeries(events, today);

  cities = {};
  extras = {};
  const categories = [];
  for (const event of events) {
    const { city, lat, category } = event;
    if (city && lat != null) cities[fold(city)] ??= { name: city, lat, lng: event.lng };
    if (category && !categories.includes(category)) categories.push(category);
  }
  const regionCounts = {};
  const departmentCounts = {};
  for (const s of series) {
    const area = areaOf(s.zip, s.country);
    if (area) {
      const { region, department } = area;
      regionCounts[region] = (regionCounts[region] || 0) + 1;
      if (department) departmentCounts[department] = (departmentCounts[department] || 0) + 1;
    }
    extras[s.id] = {
      area,
      haystack: fold(`${s.name} ${s.city} ${s.organizer}`),
      sort: sortKey(s),
      last: s.editions[s.editions.length - 1].start_date,
    };
  }

  // French regions first, then the countries the agenda also covers.
  const regionOptions = [];
  for (const region in regionCounts) regionOptions.push({ value: region, label: region, count: regionCounts[region] });
  regionOptions.sort((a, b) => !!REGIONS[b.value] - !!REGIONS[a.value] || a.label.localeCompare(b.label, 'fr'));
  fillMulti('regions', regionOptions);
  const departmentOptions = [];
  for (const code in departmentCounts) departmentOptions.push({ value: code, label: `${code} — ${DEPARTMENTS[code].name}`, count: departmentCounts[code] });
  departmentOptions.sort((a, b) => (a.value < b.value ? -1 : 1));
  fillMulti('departments', departmentOptions);

  const names = [];
  for (const key in cities) names.push(cities[key].name);
  names.sort((a, b) => a.localeCompare(b, 'fr'));
  $('cities').replaceChildren(...names.map((name) => el('option', { value: name })));

  const select = $('category');
  const chosen = select.value;
  select.replaceChildren(el('option', { value: '' }, 'Toutes'), ...categories.sort().map((c) => el('option', { value: c }, c)));
  select.value = chosen;

  const fetchedAt = body.fetchedAt;
  $('fetched').textContent = fetchedAt ? `Agenda lu le ${new Date(fetchedAt).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}` : '';
  if (body.locked === 'revoked') showStatus("Ce lien d'accès n'est plus valide. Demande un nouveau lien à la personne qui te l'a partagé.");
  else if (body.locked) showStatus("Cette page s'ouvre avec son lien d'accès, qui contient la clé des données. Demande-le à la personne qui te l'a partagé.");
  else if (!events.length) showStatus("Aucun évènement en base. Dans le dossier du projet, lance « npm run update » pour les récupérer (2 à 3 minutes), puis recharge la page.");
  if (shared) applyShared();
  else render();
}

// By next edition : announced or probable first, then the most recent past.
function compare(a, b) {
  const ea = extras[a.series.id];
  const eb = extras[b.series.id];
  const sa = ea.sort;
  const sb = eb.sort;
  if (sa && sb) return sa < sb ? -1 : sa > sb ? 1 : 0;
  if (sa || sb) return sa ? -1 : 1;
  return ea.last < eb.last ? 1 : ea.last > eb.last ? -1 : 0;
}

function activeFrom() {
  const period = state.period;
  return period === 'upcoming' || period === 'announced' ? state.from : '';
}

function compute() {
  const { anchor, radius, period, regions, departments } = state;
  const inArea = regions.length + departments.length > 0;
  const from = activeFrom();
  const tag = $('tag').value;
  const category = $('category').value;
  const words = fold($('search').value);
  visible = [];
  unlocated = [];
  for (const s of series) {
    const upcoming = s.upcoming;
    if (tag && s.tag !== tag) continue;
    if (category && s.category !== category) continue;
    if (period === 'upcoming' && !upcoming) continue;
    if (period === 'announced' && !(upcoming && upcoming.announced)) continue;
    if (period === 'past' && upcoming) continue;
    if (from && upcoming.month < from) continue;
    const extra = extras[s.id];
    if (words && !extra.haystack.includes(words)) continue;
    if (inArea) {
      const area = extra.area;
      if (!area || !(regions.includes(area.region) || departments.includes(area.department))) continue;
    }
    if (!anchor) {
      visible.push({ series: s, km: null });
    } else if (s.lat == null) {
      unlocated.push({ series: s, km: null });
    } else {
      const km = distanceKm(anchor.lat, anchor.lng, s.lat, s.lng);
      if (km <= radius) visible.push({ series: s, km });
    }
  }
  // Proximity needs an anchor ; without one the list falls back to dates.
  visible.sort(anchor && state.sort === 'distance' ? (a, b) => a.km - b.km || compare(a, b) : compare);
  unlocated.sort(compare);
}

// ─── List ───────────────────────────────────────────────────────────────

// Monochrome line icons (Feather, MIT), drawn in the text colour.
const ICONS = {
  mail: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
  phone:
    '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  facebook: '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>',
  instagram: '<rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>',
  caret: '<polyline points="6 9 12 15 18 9"/>',
};

function icon(name, size) {
  const holder = el('span', { className: 'icon' });
  holder.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  return holder;
}

function iconLink(name, label, url) {
  return el('a', { className: 'icon-button', href: url, target: '_blank', rel: 'noopener', title: label, ariaLabel: label }, icon(name, 16));
}

// An icon with a small arrow : it opens the value itself, a link that acts
// on it (send a mail, call) and a button that copies it.
function contactMenu(name, label, value, href, action) {
  const copy = el('button', { type: 'button' }, 'Copier');
  copy.dataset.copy = value;
  return el(
    'details',
    { className: 'pop contact-menu' },
    el('summary', { className: 'icon-button', title: label, ariaLabel: label }, icon(name, 16), icon('caret', 11)),
    el('div', { className: 'pop-panel' }, el('div', { className: 'value' }, value), el('div', { className: 'pop-actions' }, el('a', { className: 'button', href }, action), copy)),
  );
}

// What each tag means, said to whoever hovers it or touches it.
const TAG_HELP = {
  regular: "Régulier : des éditions sur au moins deux années, et la dernière a moins de 18 mois ou la suivante est annoncée.",
  new: "Nouveau : une seule année connue, à venir ou datant de moins d'un an.",
  paused: "En pause ? Des éditions sur au moins deux années, mais plus rien depuis 18 mois et rien d'annoncé.",
  oneoff: "Ponctuel : une seule année connue, il y a plus d'un an, et rien d'annoncé depuis.",
};

// The tag of a row. Hovering shows its meaning ; so does a click or a touch,
// since a phone has no hover.
function tagBadge(tag) {
  const help = TAG_HELP[tag];
  return el('details', { className: 'pop tag-pop' }, el('summary', { className: `tag ${tag}`, title: help }, TAG_LABELS[tag]), el('div', { className: 'pop-panel' }, help));
}

// An edition's own link, named after its site : "facebook", "974.agendaculturel.fr"…
function linkLabel(url) {
  const host = url.replace(/^https?:\/\/(www\.|m\.)?/i, '').replace(/[/?#].*$/, '').toLowerCase();
  if (/(^|\.)(facebook\.com|fb\.me)$/.test(host)) return 'facebook';
  if (/(^|\.)instagram\.com$/.test(host)) return 'instagram';
  return host;
}

// An edition from the shared base says so in a small "i", which explains
// itself on hover, or on a click or a touch as a tag does.
const SHARED_HELP = "Ajoutée à la main dans la base partagée de Conv'Map : L'Agenda Geek ne la liste pas.";
function sharedInfo() {
  return el('details', { className: 'pop tag-pop info-pop' }, el('summary', { className: 'info', title: SHARED_HELP, ariaLabel: SHARED_HELP }, 'i'), el('div', { className: 'pop-panel' }, SHARED_HELP));
}

function editionLine(edition) {
  const flags = [];
  if (edition.source === 'manual') flags.push('ajouté à la main');
  else if (edition.overridden.length) flags.push('corrigé');
  if (edition.gone_at) flags.push("retiré de l'agenda");
  const button = el('button', { type: 'button' }, 'Modifier');
  button.dataset.event = edition.id;
  return el(
    'li',
    null,
    rangeLabel(edition.start_date, edition.end_date).replace(/^(le|du) /, ''),
    edition.url ? ' · ' : '',
    edition.url ? link(edition.url, 'fiche agenda geek') : '',
    ...(edition.links ? edition.links.split('\n') : []).flatMap((url) => [' · ', link(url, linkLabel(url))]),
    edition.origin === 'shared' ? sharedInfo() : '',
    flags.length ? el('span', { className: 'flag' }, flags.join(', ')) : '',
    button,
    edition.note ? el('div', { className: 'muted' }, edition.note) : '',
  );
}

function row({ series: s, km }) {
  const { id, upcoming, editions, website, email } = s;
  const area = extras[id].area;
  const box = el('input', { type: 'checkbox', checked: !!state.checked[id], title: 'Cocher pour exporter' });
  box.dataset.series = id;

  let next;
  if (!upcoming) next = el('div', { className: 'line' }, "Pas de prochaine édition annoncée");
  else if (upcoming.announced) next = el('div', { className: 'line next' }, `Prochaine : ${rangeLabel(upcoming.event.start_date, upcoming.event.end_date)}`);
  else next = el('div', { className: 'line next probable' }, `Probable : ${monthLabel(upcoming.month)} (non annoncé)`);

  const contact = [];
  // A website that is itself a social link is shown once, as that link.
  const social = (s.facebook || s.instagram) && /facebook\.com|fb\.me|instagram\.com/i.test(website);
  if (website && !social) contact.push(link(website, website.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/.*$/, '')));
  if (s.organizer) contact.push(s.organizer);
  // The website and the organizer are one run of text ; the icons sit beside
  // it, centred on its line.
  const contactLine = el('div', { className: 'line contact' });
  if (contact.length) {
    const text = el('span', { className: 'contact-text' });
    contact.forEach((part, index) => text.append(index ? ' · ' : '', part));
    contactLine.append(text);
  }
  const icons = el('span', { className: 'icons' });
  if (email) icons.append(contactMenu('mail', 'E-mail', email, `mailto:${email}`, 'Envoyer un mail'));
  if (s.phone) icons.append(contactMenu('phone', 'Téléphone', s.phone, `tel:${s.phone.replace(/[^\d+]/g, '')}`, 'Appeler'));
  if (/^https?:\/\//i.test(s.facebook)) icons.append(iconLink('facebook', 'Facebook', s.facebook));
  if (/^https?:\/\//i.test(s.instagram)) icons.append(iconLink('instagram', 'Instagram', s.instagram));
  if (icons.childElementCount) {
    contact.push(icons);
    contactLine.append(icons);
  }

  const count = editions.length;
  const years = [];
  for (const edition of editions) {
    const year = edition.start_date.slice(0, 4);
    if (!years.includes(year)) years.push(year);
  }

  const entry = el(
    'article',
    { className: s.lat == null ? 'row' : 'row located', id: `row-${id}` },
    box,
    el(
      'div',
      { className: 'body' },
      el('div', { className: 'name' }, s.name, tagBadge(s.tag)),
      el('div', { className: 'line' }, [area && area.department ? `${s.city} (${area.department})` : s.city, km == null ? '' : `${Math.round(km)} km`, s.category].filter(Boolean).join(' · ')),
      next,
      contact.length ? contactLine : '',
      el('details', null, el('summary', null, `${count} édition${count > 1 ? 's' : ''} : ${years.join(', ')}`), el('ul', null, ...editions.map(editionLine))),
    ),
  );
  entry.dataset.series = id;
  return entry;
}

function checkedCount(items) {
  const checked = state.checked;
  let count = 0;
  for (const item of items) if (checked[item.series.id]) count++;
  return count;
}

function updateCount() {
  const total = visible.length;
  const count = checkedCount(visible) + checkedCount(unlocated);
  $('count').textContent = `${total} évènement${total > 1 ? 's' : ''}${count ? ` · ${count} coché${count > 1 ? 's' : ''}` : ''}`;
}

// The small-screen button that unfolds the filters says how many are set.
function updateFiltersToggle() {
  const { anchor, period, regions, departments } = state;
  let active = 0;
  for (const set of [anchor, period !== 'all', activeFrom(), regions.length, departments.length, $('tag').value, $('category').value, $('search').value.trim()]) {
    if (set) active++;
  }
  $('filters-toggle').textContent = active ? `Lieu et filtres (${active})` : 'Lieu et filtres';
}

function render() {
  compute();
  $('list').replaceChildren(...visible.map(row));
  const block = $('unlocated');
  const lost = unlocated.length;
  block.hidden = !lost;
  if (lost) {
    block.firstElementChild.textContent = `${lost} évènement${lost > 1 ? 's' : ''} sans coordonnées (hors rayon, à corriger via « Modifier »)`;
    $('unlocated-list').replaceChildren(...unlocated.map(row));
  }
  updateCount();
  updateFiltersToggle();
  syncUrl();
  drawMarkers();
  $('map-card').hidden = true;
}

// Rows live in the list and, on a small screen, in the card over the map.
const mainArea = document.querySelector('main');

mainArea.addEventListener('change', (event) => {
  const id = event.target.dataset.series;
  if (!id) return;
  const checked = event.target.checked;
  if (checked) state.checked[id] = true;
  else delete state.checked[id];
  // The same series may be shown twice : keep both boxes in step.
  for (const box of mainArea.querySelectorAll('input[data-series]')) if (box.dataset.series === id) box.checked = checked;
  save();
  updateCount();
});

mainArea.addEventListener('click', (event) => {
  const target = event.target;
  const button = target.closest('button');
  if (!button) {
    // A click on a row, but not on one of its links, boxes or menus, nor
    // the end of a text selection.
    const entry = target.closest('.row.located');
    if (entry && !target.closest('a, input, label, summary, .pop-panel, #map-card') && !String(getSelection())) showOnMap(entry.dataset.series);
    return;
  }
  const { event: id, copy, focus, close } = button.dataset;
  if (id) openEdit(events.find((e) => e.id === Number(id)));
  else if (copy) copyWith(button, copy);
  else if (focus) focusRow(focus);
  if (focus || close) $('map-card').hidden = true;
});

function checkVisible(value) {
  for (const { series: s } of visible) {
    if (value) state.checked[s.id] = true;
    else delete state.checked[s.id];
  }
  save();
  render();
}
$('check-all').addEventListener('click', () => checkVisible(true));
$('check-none').addEventListener('click', () => checkVisible(false));

// ─── Filters ────────────────────────────────────────────────────────────

const MULTI_EMPTY = { regions: 'Toutes', departments: 'Tous' };

// The names of the selected regions and departments, for a title.
function areaLabels() {
  return state.regions.concat(state.departments.map((code) => (DEPARTMENTS[code] ? `${DEPARTMENTS[code].name} (${code})` : code)));
}

function multiSummary(id) {
  const selected = state[id];
  const count = selected.length;
  let text = MULTI_EMPTY[id];
  if (count > 2) text = `${count} sélectionnés`;
  else if (count) text = (id === 'regions' ? selected : areaLabels().slice(state.regions.length)).join(', ');
  $(id).firstElementChild.textContent = text;
}

// options : [{ value, label, count }] — count is the number of series there.
function fillMulti(id, options) {
  const selected = state[id];
  const clear = el('button', { type: 'button' }, 'Tout décocher');
  clear.dataset.clear = id;
  const search = el('input', { type: 'search', placeholder: 'Filtrer la liste', ariaLabel: 'Filtrer la liste' });
  $(id).lastElementChild.replaceChildren(
    el('div', { className: 'multi-head' }, search, clear),
    ...options.map(({ value, label, count }) => {
      const option = el('label', null, el('input', { type: 'checkbox', value, checked: selected.includes(value) }), label, el('span', null, String(count)));
      option.dataset.text = plain(label);
      return option;
    }),
  );
  multiSummary(id);
}

// Letters and digits only : "ille et vilaine" finds "Ille-et-Vilaine".
function plain(text) {
  return fold(text).replace(/[^a-z0-9]+/g, ' ').trim();
}

// Typing in a list's own search field narrows its checkboxes ; what is
// checked stays checked, shown or not.
function filterMulti(id, text) {
  const words = plain(text);
  for (const option of $(id).querySelectorAll('label')) option.hidden = !option.dataset.text.includes(words);
}

function syncMulti(id) {
  const selected = state[id];
  for (const box of $(id).querySelectorAll('input[type=checkbox]')) box.checked = selected.includes(box.value);
  multiSummary(id);
}

// With no anchor, the map follows what the list shows.
function fitVisible() {
  if (state.anchor) return;
  const points = [];
  for (const { series: s } of visible) if (s.lat != null) points.push([s.lat, s.lng]);
  if (points.length) map.fitBounds(points, { padding: [20, 20], maxZoom: 11 });
}

function areaChanged(id) {
  save();
  multiSummary(id);
  render();
  fitVisible();
}

for (const id of ['regions', 'departments']) {
  $(id).addEventListener('input', (event) => {
    if (event.target.type === 'search') filterMulti(id, event.target.value);
  });
  // Opening a list puts the cursor in its search field.
  $(id).addEventListener('toggle', () => {
    if ($(id).open) $(id).querySelector('input[type=search]').focus();
  });
  $(id).addEventListener('change', (event) => {
    if (event.target.type !== 'checkbox') return;
    const values = [];
    for (const box of $(id).querySelectorAll('input:checked')) values.push(box.value);
    state[id] = values;
    areaChanged(id);
  });
  $(id).addEventListener('click', (event) => {
    if (event.target.dataset.clear !== id) return;
    state[id] = [];
    syncMulti(id);
    areaChanged(id);
  });
}
// A click anywhere else closes an open list.
document.addEventListener('click', (event) => {
  for (const open of document.querySelectorAll('.multi[open], .pop[open]')) if (!open.contains(event.target)) open.open = false;
});

function syncFilters() {
  const radius = state.radius;
  $('radius').value = radius;
  $('radius-km').value = radius;
  $('period').value = state.period;
  showFrom();
  $('place').value = state.anchor ? state.anchor.label : '';
  syncSort();
}

function syncSort() {
  const anchor = state.anchor;
  const sort = $('sort');
  sort.lastElementChild.disabled = !anchor;
  sort.value = anchor ? state.sort : 'date';
}

$('sort').addEventListener('change', (event) => {
  state.sort = event.target.value;
  save();
  render();
});

$('filters').addEventListener('submit', (event) => event.preventDefault());
// The slider and the number under it set the same radius ; the number may
// go beyond the slider's range.
function setRadius(event) {
  const radius = Math.round(Number(event.target.value));
  if (radius >= 1 && radius <= 1000) state.radius = radius;
  save();
  syncFilters();
  drawZone();
  render();
}
$('radius').addEventListener('input', setRadius);
$('radius-km').addEventListener('change', setRadius);
// "À partir de" is a list of months rather than a month field : browsers do
// not agree on what a month field looks like, and some show a bare text box.
const FROM_MONTHS = 24;

function showFrom() {
  const from = state.from;
  const months = [];
  for (let i = 0; i < FROM_MONTHS; i++) {
    const total = now.getFullYear() * 12 + now.getMonth() + i;
    months.push(`${Math.floor(total / 12)}-${pad((total % 12) + 1)}`);
  }
  // A month from a saved search or a link may lie outside the list.
  if (from && !months.includes(from)) months.unshift(from);
  $('from').replaceChildren(el('option', { value: '' }, 'Peu importe'), ...months.map((month) => el('option', { value: month }, monthLabel(month))));
  $('from').value = from;
}

$('period').addEventListener('change', (event) => {
  const period = event.target.value;
  state.period = period;
  // "From" only means something for what is to come.
  if (period !== 'upcoming' && period !== 'announced') state.from = '';
  save();
  syncFilters();
  render();
});
$('from').addEventListener('change', (event) => {
  state.from = event.target.value;
  // Choosing a month is asking for what is to come : the period follows.
  if (state.from && state.period !== 'upcoming' && state.period !== 'announced') state.period = 'upcoming';
  save();
  syncFilters();
  render();
});
for (const id of ['tag', 'category', 'search']) $(id).addEventListener('input', render);

$('place').addEventListener('change', (event) => {
  const text = event.target.value;
  if (!text.trim()) return setAnchor(null);
  const city = cities[fold(text)];
  if (!city) return showStatus(`« ${text} » n'est pas une ville connue de l'agenda. Choisis-en une dans la liste, ou utilise « Sur la carte ».`);
  setAnchor({ lat: city.lat, lng: city.lng, label: city.name });
});
$('clear-place').addEventListener('click', () => setAnchor(null));

// ─── A search as one object : saved, or shared as a link ───────────────

function currentParams() {
  return {
    anchor: state.anchor,
    radius: state.radius,
    period: state.period,
    from: state.from,
    sort: state.sort,
    regions: state.regions,
    departments: state.departments,
    tag: $('tag').value,
    category: $('category').value,
    search: $('search').value,
  };
}

function applyParams(params) {
  state.anchor = params.anchor || null;
  state.radius = params.radius || 100;
  state.period = params.period || 'all';
  state.from = params.from || '';
  state.sort = params.sort || 'date';
  state.regions = params.regions || [];
  state.departments = params.departments || [];
  syncMulti('regions');
  syncMulti('departments');
  $('tag').value = params.tag || '';
  $('category').value = params.category || '';
  $('search').value = params.search || '';
  save();
  syncFilters();
  drawZone();
  render();
  fitVisible();
}

// The search the address carried when the page opened, applied once the
// events are there ; then the address follows the filters, so that it can be
// copied at any time.
let shared = fromQuery(location.search);

function applyShared() {
  const params = shared;
  shared = null;
  const anchor = params.anchor;
  if (anchor && anchor.lat == null) {
    // The link names a town without its position.
    const city = cities[fold(anchor.label)];
    params.anchor = city ? { lat: city.lat, lng: city.lng, label: city.name } : null;
    if (!city) showStatus(`Le lien cite « ${anchor.label} », qui n'est pas une ville connue de l'agenda : la recherche est faite sans lieu.`);
  }
  applyParams(params);
}

function shareLink() {
  const query = toQuery(currentParams());
  return `${location.origin}${location.pathname}${query ? `?${query}` : ''}`;
}

function syncUrl() {
  if (shared) return;
  history.replaceState(null, '', `${shareLink()}${location.hash}`);
}

$('share').addEventListener('click', (event) => copyWith(event.currentTarget, shareLink()));

// ─── Saved searches ─────────────────────────────────────────────────────

let searches = [];

function showSearches(list, selected) {
  searches = list;
  const select = $('searches');
  select.replaceChildren(
    el('option', { value: '' }, list.length ? 'Recherches enregistrées…' : 'Aucune recherche enregistrée'),
    ...list.map((search) => el('option', { value: search.name }, search.name)),
  );
  select.value = selected || '';
  $('search-delete').disabled = !select.value;
}

$('searches').addEventListener('change', (event) => {
  const name = event.target.value;
  const found = searches.find((search) => search.name === name);
  $('search-delete').disabled = !found;
  if (!found) return;
  $('search-name').value = name;
  showStatus('');
  applyParams(found.params);
});

$('search-save').addEventListener('click', async () => {
  const name = $('search-name').value.trim();
  if (!name) return showStatus('Donne un nom à la recherche avant de l\'enregistrer.');
  showSearches(await store.saveSearch(name, currentParams()), name);
  showStatus(`Recherche « ${name} » enregistrée.`);
});

$('search-delete').addEventListener('click', async () => {
  const name = $('searches').value;
  showSearches(await store.deleteSearch(name));
  $('search-name').value = '';
  showStatus(`Recherche « ${name} » supprimée.`);
});

// ─── Export ─────────────────────────────────────────────────────────────

function exportItems() {
  const checked = state.checked;
  const picked = visible.concat(unlocated).filter((item) => checked[item.series.id]);
  return picked.length ? picked : visible;
}

function exportOutput() {
  const anchor = state.anchor;
  const format = FORMATS[document.querySelector('input[name=format]:checked').value];
  const output = format.make(exportItems(), {
    today,
    place: anchor ? anchor.label : '',
    radiusKm: state.radius,
    areas: areaLabels(),
    fromMonth: activeFrom(),
    contacts: $('export-contacts').checked,
  });
  return { format, output };
}

function refreshExport() {
  const { format, output } = exportOutput();
  // The BOM is for the downloaded file only.
  $('export-text').value = output.replace(/^\uFEFF/, '');
  $('export-hint').textContent = format.hint;
}

$('export').addEventListener('click', () => {
  const picked = checkedCount(visible) + checkedCount(unlocated);
  const total = visible.length;
  $('export-count').textContent = picked ? `— ${picked} coché${picked > 1 ? 's' : ''}` : `— rien de coché : les ${total} affichés`;
  refreshExport();
  $('export-dialog').showModal();
});
$('export-dialog').addEventListener('change', refreshExport);

$('export-copy').addEventListener('click', (event) => copyWith(event.currentTarget, $('export-text').value));

$('export-download').addEventListener('click', () => {
  const { format, output } = exportOutput();
  const anchor = state.anchor;
  const place = anchor ? `-${fold(anchor.label).replace(/[^a-z0-9]+/g, '-')}` : '';
  const url = URL.createObjectURL(new Blob([output], { type: `${format.mime};charset=utf-8` }));
  el('a', { href: url, download: `evenements${place}.${format.ext}` }).click();
  URL.revokeObjectURL(url);
});

// ─── Add / edit ─────────────────────────────────────────────────────────

const form = $('edit-form');
const fields = form.elements;
let editing = null;

function openEdit(event) {
  editing = event || null;
  const manual = !event || event.source === 'manual';
  $('edit-title').textContent = event ? 'Modifier un évènement' : 'Ajouter un évènement';
  $('edit-hint').textContent = manual
    ? "Un évènement ajouté à la main n'est jamais touché par une mise à jour de l'agenda."
    : `Cet évènement vient ${event.origin === 'shared' ? 'de la base partagée' : "de l'agenda"} : ce que tu changes ici reste prioritaire sur les prochaines mises à jour.`;
  $('edit-delete').hidden = !(event && manual);
  $('edit-error').hidden = true;
  form.reset();
  if (event) {
    for (const field of fields) {
      const name = field.name;
      if (name) field.value = event[name] ?? '';
    }
  }
  $('edit-dialog').showModal();
}

$('add').addEventListener('click', () => openEdit(null));
$('edit-cancel').addEventListener('click', () => $('edit-dialog').close());

// A known city fills in the coordinates the radius filter needs.
fields.city.addEventListener('change', () => {
  const city = cities[fold(fields.city.value)];
  if (city && !fields.lat.value && !fields.lng.value) {
    fields.lat.value = city.lat;
    fields.lng.value = city.lng;
  }
});

// saving : the store's promise for an add, an edit or a removal.
async function sendEdit(saving) {
  try {
    await saving;
  } catch (failure) {
    const error = $('edit-error');
    error.hidden = false;
    error.textContent = failure.message;
    return;
  }
  $('edit-dialog').close();
  load();
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const body = {};
  for (const field of fields) if (field.name) body[field.name] = field.value;
  if (editing) sendEdit(store.updateEvent(editing.id, body));
  else sendEdit(store.createEvent(body));
});

$('edit-delete').addEventListener('click', () => {
  if (confirm(`Supprimer « ${editing.title} » ?`)) sendEdit(store.deleteEvent(editing.id));
});

// ─── Version and release notes ──────────────────────────────────────────

// Any dialog closes on a click beside it, as on Escape. The dialog's own
// padding is the dialog too : only a press and a release both outside its
// box count, so that a text selection dragged out of a field closes nothing.
function outside(dialog, event) {
  const box = dialog.getBoundingClientRect();
  return event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom);
}
for (const dialog of document.querySelectorAll('dialog')) {
  let pressedOutside = false;
  dialog.addEventListener('pointerdown', (event) => {
    pressedOutside = outside(dialog, event);
  });
  dialog.addEventListener('click', (event) => {
    if (pressedOutside && outside(dialog, event)) dialog.close();
    pressedOutside = false;
  });
}

// The footer shows the latest version of CHANGELOG.md ; a click lists them all.
fetch('CHANGELOG.md', { cache: 'no-cache' })
  .then((response) => (response.ok ? response.text() : ''))
  .then((text) => {
    const releases = parseReleases(text);
    if (!releases.length) return;
    const button = $('version');
    button.textContent = `v${releases[0].version}`;
    button.hidden = false;
    $('releases').replaceChildren(
      ...releases.map(({ version, date, items }) =>
        el(
          'section',
          null,
          el('h3', null, `Version ${version}`),
          date ? el('div', { className: 'release-date' }, rangeLabel(date, date).replace(/^le /, '')) : '',
          el('ul', null, ...items.map((item) => el('li', null, item))),
        ),
      ),
    );
    button.addEventListener('click', () => $('releases-dialog').showModal());
  })
  .catch(() => {
    // No release notes : the footer simply shows no version.
  });

syncFilters();
drawZone();
load();
store.listSearches().then(showSearches);
