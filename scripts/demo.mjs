// Builds data/demo.db : invented events around Rennes, to show or try the
// page without naming anyone real. Every name, organizer and contact below
// is made up ; only the towns exist. Dates are set from today, so the demo
// always has past editions, announced ones and probable ones.

import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb, upsertAgenda } from '../lib/db.mjs';

const TOWNS = {
  Rennes: [48.117, -1.678, '35000'],
  'Saint-Malo': [48.649, -2.026, '35400'],
  Fougères: [48.352, -1.199, '35300'],
  Redon: [47.651, -2.084, '35600'],
  Vitré: [48.124, -1.209, '35500'],
  Vannes: [47.658, -2.76, '56000'],
  Lorient: [47.748, -3.37, '56100'],
  Pontivy: [48.066, -2.966, '56300'],
  Brest: [48.39, -4.486, '29200'],
  Quimper: [47.996, -4.102, '29000'],
  'Saint-Brieuc': [48.514, -2.765, '22000'],
  Dinan: [48.455, -2.05, '22100'],
  Lannion: [48.732, -3.459, '22300'],
  Nantes: [47.218, -1.553, '44000'],
  Laval: [48.07, -0.77, '53000'],
  Angers: [47.473, -0.554, '49000'],
  'Le Mans': [48.006, 0.199, '72000'],
  Caen: [49.183, -0.371, '14000'],
};

const SHOW = 'Salon / convention / brocante';
const NIGHT = 'Soirée / concert / spectacle';
const EXPO = 'Exposition';

// [name, town, category, offsets] — an offset is a number of months from
// today (negative : past), one per edition. `social` : f, i, or both.
const SERIES = [
  ['Kaelis Con', 'Rennes', SHOW, [-34, -22, -10, 2], 'fi'],
  ['Festival Orbéa', 'Saint-Malo', SHOW, [-29, -17, -5], 'f'],
  ['Salon Tessera', 'Vannes', SHOW, [-26, -14, -2], 'fi'],
  ['Nuit des Dés Pipés', 'Rennes', NIGHT, [1], 'i'],
  ['Pixellune', 'Nantes', SHOW, [-32, -20, -8, 4], 'fi'],
  ['Les Rencontres de Mirval', 'Fougères', SHOW, [-27, -15, -3], ''],
  ['Brocante Otaku du Ponant', 'Brest', SHOW, [-23, -11, 1], 'f'],
  ['Convention Yumeko', 'Lorient', SHOW, [-30, -18, -6], 'fi'],
  ['Festival Draconis', 'Laval', SHOW, [-33, -21, -9, 3], 'f'],
  ['Expo Mécanoïdes', 'Angers', EXPO, [-4], ''],
  ['Salon Rétro-Arcadia', 'Saint-Brieuc', SHOW, [-25, -13, -1], 'i'],
  ['Les Arpenteurs de Brume', 'Redon', SHOW, [-31, -19, -7], 'f'],
  ['Hanami en Scène', 'Dinan', NIGHT, [5], 'fi'],
  ['Convention Sélénite', 'Le Mans', SHOW, [-28, -16, -4, 8], 'fi'],
  ['Jeux & Chimères', 'Vitré', SHOW, [-9], 'f'],
  ['Kraken Play', 'Quimper', SHOW, [-35, -23], ''],
  ['Festival Nébuleuse', 'Caen', SHOW, [-24, -12, 0.5], 'fi'],
  ['Les Veillées Ludiques', 'Pontivy', NIGHT, [-20, -8], ''],
  ['Salon du Grimoire', 'Lannion', SHOW, [-36, -24], 'f'],
  ['Tournoi des Douze Tours', 'Rennes', SHOW, [-14, -2], 'i'],
  ['Cosplay sur les Remparts', 'Saint-Malo', NIGHT, [6], 'fi'],
  ['Marché des Imaginaires', 'Nantes', SHOW, [-21, -9, 3], ''],
];

function dateFrom(months) {
  const date = new Date();
  date.setDate(date.getDate() + Math.round(months * 30.44));
  // Events fall on week-ends : move to the Saturday of that week.
  date.setDate(date.getDate() + ((6 - date.getDay() + 7) % 7));
  return date;
}
const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const rows = [];
SERIES.forEach(([name, town, category, offsets, social], index) => {
  const [lat, lng, zip] = TOWNS[town];
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  offsets.forEach((months, edition) => {
    const start = dateFrom(months);
    const end = new Date(start);
    if (category === SHOW) end.setDate(end.getDate() + 1);
    rows.push({
      source_id: 900000 + index * 10 + edition,
      title: `${name} ${start.getFullYear()}`,
      start_date: iso(start),
      end_date: iso(end),
      venue: `Parc des expositions de ${town}`,
      city: town,
      zip,
      country: 'France',
      lat: lat + (index % 5) * 0.006,
      lng: lng + (index % 3) * 0.009,
      category,
      url: '',
      website: `https://${slug}.example.org/`,
      organizer: `Association ${name}`,
      email: index % 3 ? `contact@${slug}.example.org` : '',
      phone: index % 2 ? `02 00 00 ${String(10 + index).padStart(2, '0')} ${String(20 + index).padStart(2, '0')}` : '',
      facebook: social.includes('f') ? `https://www.facebook.com/${slug}.exemple` : '',
      instagram: social.includes('i') ? `https://www.instagram.com/${slug}.exemple/` : '',
    });
  });
});

const dir = fileURLToPath(new URL('../data/', import.meta.url));
mkdirSync(dir, { recursive: true });
rmSync(`${dir}demo.db`, { force: true });
const db = openDb(`${dir}demo.db`);
const stats = upsertAgenda(db, rows, new Date().toISOString());
console.log(`demo : ${stats.added} invented events in data/demo.db`);
