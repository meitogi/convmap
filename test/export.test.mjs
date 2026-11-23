import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rangeLabel, toCsv, toMarkdown, toText, toTsv } from '../lib/export.mjs';
import { buildSeries } from '../lib/series.mjs';
import { fixtureEvents, TODAY } from './helpers.mjs';

const series = buildSeries(fixtureEvents(), TODAY);
const item = (name, km) => ({ series: series.find((s) => s.name === name), km });
const items = [
  item('Geek Days Rennes', 11.6),
  item('Japan Tours Festival', 204.2),
  item('Roazhon Japan', 0.7),
  item('Bravo les Rôlistes : Aventures en Eternium', 4.3),
];
const options = { today: TODAY, place: 'Rennes', radiusKm: 150, fromMonth: '2026-11', contacts: false };
const BRAVO_SITE = 'https://www.helloasso.com/associations/bravo-les-rolistes/evenements/bravo-les-rolistes-actualplay-sur-scene-1er-novembre-2026';
const ROAZHON_ORGANIZER = 'Association Culturelle des Étudiants du Centre Franco-Japonais de Management (ACECFJM)';

test('rangeLabel', () => {
  assert.equal(rangeLabel('2026-11-14', '2026-11-14'), 'le 14 novembre 2026');
  assert.equal(rangeLabel('2026-11-01', ''), 'le 1er novembre 2026');
  assert.equal(rangeLabel('2026-07-03', '2026-07-05'), 'du 3 au 5 juillet 2026');
  assert.equal(rangeLabel('2026-02-27', '2026-03-01'), 'du 27 février au 1er mars 2026');
  assert.equal(rangeLabel('2026-12-31', '2027-01-02'), 'du 31 décembre 2026 au 2 janvier 2027');
});

test('text for an SMS or a mail, without organizer contacts', () => {
  assert.equal(
    toText(items, options),
    `Évènements autour de Rennes (150 km), à partir de novembre 2026

Geek Days Rennes — Bruz, à 12 km
Prochaine édition : pas encore annoncée, probablement février 2027
Déjà eu lieu en février 2024, 2025 et 2026
https://www.geek-days.com/rennes/

Japan Tours Festival — Tours, à 204 km
Prochaine édition : du 2 au 4 juillet 2027
Déjà eu lieu en juin 2024, juin 2025 et juillet 2026
http://www.japantoursfestival.com/

Roazhon Japan — Rennes, à 1 km
Pas de prochaine édition annoncée
Déjà eu lieu en mars 2024 et 2025
https://roazhonjapan.fr/

Bravo les Rôlistes : Aventures en Eternium — Cesson-Sévigné, à 4 km
Pas de prochaine édition annoncée
Déjà eu lieu en octobre 2026 et novembre 2026
${BRAVO_SITE}
Instagram : https://www.instagram.com/bravolesrolistes/
`,
  );
});

test('text with contacts, and with no anchor', () => {
  const text = toText([{ series: items[3].series, km: null }], { today: TODAY, contacts: true });
  assert.equal(
    text,
    `Évènements

Bravo les Rôlistes : Aventures en Eternium — Cesson-Sévigné
Pas de prochaine édition annoncée
Déjà eu lieu en octobre 2026 et novembre 2026
${BRAVO_SITE}
Instagram : https://www.instagram.com/bravolesrolistes/
Contact : Bravo les Rôlistes — contact130051@example.org — 01 23 45 67 89
`,
  );
});

test('tab-separated text fills a spreadsheet', () => {
  assert.equal(
    toTsv(items.slice(0, 3), options),
    [
      'Évènement\tVille\tDistance km\tProchaine édition\tAnnoncée\tÉditions passées\tTag\tSite\tFacebook\tInstagram',
      'Geek Days Rennes\tBruz\t12\tfévrier 2027\tprobable\t02/2024, 02/2025, 02/2026\trégulier\thttps://www.geek-days.com/rennes/\t\t',
      'Japan Tours Festival\tTours\t204\t02/07/2027\toui\t06/2024, 06/2025, 07/2026\trégulier\thttp://www.japantoursfestival.com/\t\t',
      'Roazhon Japan\tRennes\t1\t\t\t03/2024, 03/2025\ten pause ?\thttps://roazhonjapan.fr/\t\t',
      '',
    ].join('\n'),
  );
});

test('contacts are extra columns, only on request', () => {
  const without = toTsv([items[2]], options);
  assert.ok(!without.includes('example.org') && !without.includes('ACECFJM'));
  assert.equal(
    toTsv([items[2]], { ...options, contacts: true }),
    'Évènement\tVille\tDistance km\tProchaine édition\tAnnoncée\tÉditions passées\tTag\tSite\tFacebook\tInstagram\tOrganisateur\tEmail\tTéléphone\n' +
      `Roazhon Japan\tRennes\t1\t\t\t03/2024, 03/2025\ten pause ?\thttps://roazhonjapan.fr/\t\t\t${ROAZHON_ORGANIZER}\tcontact64067@example.org\t\n`,
  );
});

test('csv : BOM, semicolons, CRLF, quoting', () => {
  const tricky = { series: { ...items[0].series, name: 'Salon "A" ; B', city: 'Bruz\tx' }, km: 11.6 };
  assert.equal(
    toCsv([tricky], options),
    '\uFEFFÉvènement;Ville;Distance km;Prochaine édition;Annoncée;Éditions passées;Tag;Site;Facebook;Instagram\r\n' +
      '"Salon ""A"" ; B";Bruz\tx;12;février 2027;probable;02/2024, 02/2025, 02/2026;régulier;https://www.geek-days.com/rennes/;;\r\n',
  );
  assert.equal(toTsv([tricky], options).split('\n')[1].split('\t').length, 10);
});

test('markdown table', () => {
  const tricky = { series: { ...items[1].series, name: 'A | B' }, km: null };
  assert.equal(
    toMarkdown([tricky], { today: TODAY }),
    `# Évènements

| Évènement | Ville | Distance km | Prochaine édition | Annoncée | Éditions passées | Tag | Site | Facebook | Instagram |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A \\| B | Tours |  | 02/07/2027 | oui | 06/2024, 06/2025, 07/2026 | régulier | http://www.japantoursfestival.com/ |  |  |
`,
  );
});

test('social links : their own lines, and no repeat of a website that is one', () => {
  const ludigeek = series.find((s) => s.name === 'Ludigeek Festival');
  assert.equal(
    toText([{ series: ludigeek, km: null }], { today: TODAY, areas: ['Hauts-de-France', 'Nord (59)'] }),
    `Évènements — Hauts-de-France, Nord (59)

Ludigeek Festival — Halluin
Prochaine édition : pas encore annoncée, probablement novembre 2027
Déjà eu lieu en novembre 2022, 2024 et 2026
Facebook : https://www.facebook.com/Ludigeek
`,
  );
  const asobi = series.find((s) => s.name === 'ASOBI');
  const text = toText([{ series: asobi, km: null }], { today: TODAY });
  assert.ok(text.includes('\nhttps://maps.app.goo.gl/K7HzN79gM5WcBDA56\nFacebook : https://www.facebook.com/profile.php?id=100090873729078\nInstagram : https://www.instagram.com/asobi_evenement/\n'), text);
  assert.ok(toTsv([{ series: asobi, km: null }], { today: TODAY }).endsWith('\thttps://www.facebook.com/profile.php?id=100090873729078\thttps://www.instagram.com/asobi_evenement/\n'));
});
