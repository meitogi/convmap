// The shared manual base, from the command line (wtf convmap manual …).
// Every change is validated, sealed into snapshot/manual.bin, laid into the
// local base and committed ; pushing publishes it.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { manualRows, validate } from '../lib/manual.mjs';
import { normalizeTitle } from '../lib/series.mjs';
import { commitManual, readAgenda, readManual, root, writeManual } from './manual-store.mjs';

const USAGE = `wtf convmap manual <commande> [--no-commit]

La base manuelle partagée : les évènements que L'Agenda Geek n'a pas, et des
liens ajoutés à n'importe quelle édition (évènement Facebook, page d'un
agenda local…). Elle est publiée avec le site pour tous les liens d'accès.

  add           ajouter une édition (et son évènement s'il est nouveau)
  link          ajouter des liens à une édition, de l'agenda ou de la base
  list [texte]  lister la base, ou ce qui contient « texte »
  edit          ouvrir la base en JSON dans l'éditeur, puis la re-sceller
  open          écrire la base en clair dans .tmp/manual.json
  seal [msg]    re-sceller .tmp/manual.json (puis le supprimer), msg en commit

Chaque changement est committé (snapshot/manual.bin seul) ; --no-commit
l'écrit sans committer. Pousser la branche main publie.`;

const args = process.argv.slice(2);
const commit = !args.includes('--no-commit');
const [command, ...rest] = args.filter((arg) => arg !== '--no-commit');
const CLEAR = `${root}.tmp/manual.json`;
const CLEAR_SHOWN = '.tmp/manual.json';

const fold = (text) =>
  (text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

// ─── Prompts ────────────────────────────────────────────────────────────

// Lines are queued as they come : piped answers typed ahead are not lost.
let rl = null;
const lines = [];
let waiting = null;
let ended = false;

function nextLine() {
  if (!rl) {
    rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
    rl.on('line', (line) => (waiting ? (waiting(line), (waiting = null)) : lines.push(line)));
    rl.on('close', () => {
      ended = true;
      if (waiting) waiting(null);
    });
  }
  if (lines.length) return Promise.resolve(lines.shift());
  if (ended) return Promise.resolve(null);
  return new Promise((resolve) => (waiting = resolve));
}

async function ask(question, fallback = '') {
  process.stdout.write(fallback ? `${question} [${fallback}] ` : `${question} `);
  const line = await nextLine();
  if (line === null) throw new Error('\nSaisie interrompue : rien enregistré.');
  if (!process.stdin.isTTY) process.stdout.write(`${line}\n`);
  return line.trim() || fallback;
}

async function yes(question, byDefault) {
  const answer = fold(await ask(`${question} ${byDefault ? '[O/n]' : '[o/N]'}`));
  return answer ? answer.startsWith('o') || answer.startsWith('y') : byDefault;
}

// '2027-05-15' or '15/05/2027' → '2027-05-15' ; null when it is neither.
function parseDate(text) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  return match ? `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}` : null;
}

async function askDate(question, fallback) {
  for (;;) {
    const answer = await ask(question, fallback);
    const date = parseDate(answer);
    if (date) return date;
    console.log('  Une date comme 2027-05-15 ou 15/05/2027.');
  }
}

async function askLinks() {
  console.log("Liens de cette édition : évènement Facebook, page d'un agenda, billetterie… Un par ligne, ligne vide pour finir.");
  const links = [];
  for (;;) {
    const link = await ask('  lien :');
    if (!link) return links;
    if (/^https?:\/\/\S+$/.test(link)) links.push(link);
    else console.log('  Un lien complet, commençant par https://');
  }
}

// ─── What is already known ──────────────────────────────────────────────

// Every edition the page will show : the agenda's and the base's.
function allEditions(agenda, doc) {
  const editions = agenda.events.map((event) => ({ ...event, from: 'agenda' }));
  for (const row of manualRows(doc)) editions.push({ ...row, from: 'base' });
  return editions;
}

// The known places named `city`, one per postcode : Saint-Denis is in 93
// and in 974.
function knownPlaces(agenda, doc, city) {
  const places = {};
  for (const event of allEditions(agenda, doc)) {
    if (fold(event.city) !== fold(city) || event.lat == null) continue;
    places[event.zip || '?'] ??= { city: event.city, zip: event.zip, country: event.country, lat: event.lat, lng: event.lng };
  }
  return Object.values(places);
}

function summary(row) {
  const dates = row.end_date && row.end_date !== row.start_date ? `${row.start_date} → ${row.end_date}` : row.start_date;
  return `${dates}  ${row.title} — ${row.city || '?'}${row.zip ? ` (${row.zip})` : ''}`;
}

async function save(doc, message) {
  await writeManual(doc);
  if (commit) {
    commitManual(message);
    console.log(`Enregistré et committé : « ${message} ». Pousser main pour publier.`);
  } else {
    console.log('Enregistré, sans commit (--no-commit).');
  }
}

// ─── Commands ───────────────────────────────────────────────────────────

async function add() {
  console.log(`Ajouter une édition à la base partagée. Si l'évènement y est déjà, ses
lieu et contacts sont repris ; sinon on les saisit une fois pour toutes.
`);
  const [agenda, doc] = await Promise.all([readAgenda(), readManual()]);
  const title = await ask("Nom de l'évènement (sans l'année) :");
  if (!title) return console.log('Rien ajouté.');
  const key = normalizeTitle(title);

  let series = null;
  for (const candidate of doc.series) {
    if (normalizeTitle(candidate.title) !== key) continue;
    if (await yes(`Nouvelle édition de « ${candidate.title} » (${candidate.city || '?'}) ?`, true)) series = candidate;
    break;
  }

  if (!series) {
    const inAgenda = agenda.events.filter((event) => normalizeTitle(event.title) === key).sort((a, b) => (a.start_date < b.start_date ? 1 : -1));
    if (inAgenda.length) {
      console.log(`Déjà dans L'Agenda Geek : ${inAgenda
        .slice(0, 3)
        .map(summary)
        .join('\n  ')}
Si l'agenda publie l'édition plus tard, elle apparaîtra deux fois. Pour
seulement y ajouter un lien : wtf convmap manual link.`);
      if (!(await yes("L'ajouter quand même ?", false))) return console.log('Rien ajouté.');
    }
    series = await askSeries(agenda, doc, title);
  }

  const start = await askDate('Date de début (2027-05-15 ou 15/05/2027) :');
  const end = await askDate('Date de fin :', start);
  const links = await askLinks();
  const note = await ask('Note pour la base (où la date a été trouvée…), non publiée :');
  const edition = { start_date: start, end_date: end, links };
  if (note) edition.note = note;

  console.log(`\n${summary({ ...series, ...edition, title: series.title })}${links.map((link) => `\n  ${link}`).join('')}`);
  if (!(await yes('Enregistrer ?', true))) return console.log('Rien ajouté.');
  if (!doc.series.includes(series)) doc.series.push(series);
  series.editions.push(edition);
  series.editions.sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
  await save(doc, `Add ${series.title} ${start.slice(0, 4)} to the manual base`);
}

async function askSeries(agenda, doc, title) {
  const series = { title };
  series.city = await ask('Ville :');
  const places = knownPlaces(agenda, doc, series.city);
  let place = null;
  if (places.length) {
    console.log('Déjà connue :');
    places.forEach((p, i) => console.log(`  ${i + 1}. ${p.city} ${p.zip} ${p.country}  (${p.lat}, ${p.lng})`));
    const pick = Number(await ask('Reprendre lequel ? (numéro, Entrée pour aucun)'));
    place = places[pick - 1] || null;
  }
  if (place) {
    Object.assign(series, place);
  } else {
    series.zip = await ask('Code postal (il donne le département, donc le filtre par région) :');
    series.country = await ask('Pays :', 'France');
    console.log('Coordonnées : sans elles, le filtre par rayon ne le trouve pas. Google Maps,');
    console.log('clic droit sur le lieu, puis clic sur les coordonnées pour les copier.');
    for (;;) {
      const answer = await ask('  « lat, lng » (Entrée pour plus tard) :');
      if (!answer) {
        series.lat = series.lng = null;
        break;
      }
      const match = /^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/.exec(answer);
      if (match) {
        series.lat = Number(match[1]);
        series.lng = Number(match[2]);
        break;
      }
      console.log('  Deux nombres, comme 48.1173, -1.6778');
    }
  }
  series.venue = await ask('Lieu (salle, parc des expos…) :');
  series.category = await ask('Catégorie :', 'Salon / convention / brocante');
  series.website = await ask('Site :');
  series.facebook = await ask("Page Facebook de l'évènement (pas d'une édition) :");
  series.instagram = await ask('Instagram :');
  series.organizer = await ask('Organisateur :');
  series.editions = [];
  for (const field in series) if (series[field] === '') delete series[field];
  return series;
}

async function link() {
  console.log(`Ajouter des liens à une édition, de L'Agenda Geek ou de la base partagée :
ils s'affichent à côté de sa date.
`);
  const [agenda, doc] = await Promise.all([readAgenda(), readManual()]);
  const query = fold(await ask('Rechercher (nom ou ville) :'));
  if (!query) return;
  const found = allEditions(agenda, doc)
    .filter((row) => fold(`${row.title} ${row.city}`).includes(query))
    .sort((a, b) => (a.start_date < b.start_date ? 1 : -1))
    .slice(0, 20);
  if (!found.length) return console.log('Aucune édition ne correspond.');
  found.forEach((row, i) => console.log(`  ${String(i + 1).padStart(2)}. ${summary(row)}  [${row.from}]`));
  const row = found[Number(await ask('Laquelle ? (numéro)')) - 1];
  if (!row) return console.log('Rien ajouté.');
  const links = await askLinks();
  if (!links.length) return console.log('Rien ajouté.');

  let target;
  if (row.from === 'agenda') {
    target = doc.agenda_links[row.source_id] ??= [];
  } else {
    // The base's edition with this title and date.
    for (const series of doc.series) {
      for (const edition of series.editions) {
        if ((edition.title || series.title) === row.title && edition.start_date === row.start_date) target = edition.links ??= [];
      }
    }
  }
  for (const link of links) if (!target.includes(link)) target.push(link);
  await save(doc, `Add links to ${row.title} ${row.start_date.slice(0, 4)} in the manual base`);
}

async function list(filter) {
  const doc = await readManual();
  const query = fold(filter);
  const agenda = await readAgenda();
  const titles = {};
  for (const event of agenda.events) titles[event.source_id] = event;
  let shown = 0;
  for (const series of doc.series) {
    if (query && !fold(`${series.title} ${series.city}`).includes(query)) continue;
    shown++;
    console.log(`${series.title} — ${series.city || '?'}${series.zip ? ` (${series.zip})` : ''}`);
    for (const edition of series.editions) {
      const end = edition.end_date && edition.end_date !== edition.start_date ? ` → ${edition.end_date}` : '';
      console.log(`  ${edition.start_date}${end}${(edition.links || []).map((l) => `\n      ${l}`).join('')}`);
    }
  }
  for (const id in doc.agenda_links) {
    const event = titles[id];
    const name = event ? summary(event) : `agenda #${id} (plus dans l'agenda)`;
    if (query && !fold(name).includes(query)) continue;
    shown++;
    console.log(`[agenda] ${name}${doc.agenda_links[id].map((l) => `\n      ${l}`).join('')}`);
  }
  if (!shown) console.log(query ? 'Rien ne correspond.' : 'La base est vide. wtf convmap manual add pour commencer.');
}

async function openClear() {
  if (existsSync(CLEAR)) {
    console.error(`${CLEAR_SHOWN} existe déjà : il contient peut-être des changements pas encore scellés.
wtf convmap manual seal pour les garder, ou supprimer le fichier pour repartir de la base.`);
    process.exit(1);
  }
  mkdirSync(`${root}.tmp`, { recursive: true });
  writeFileSync(CLEAR, `${JSON.stringify(await readManual(), null, 2)}\n`);
  console.log(`Base écrite en clair dans ${CLEAR_SHOWN} (hors git). wtf convmap manual seal une fois fini.`);
}

async function sealClear() {
  if (!existsSync(CLEAR)) {
    console.error(`Pas de ${CLEAR_SHOWN} : wtf convmap manual open d'abord.`);
    process.exit(1);
  }
  let doc;
  try {
    doc = JSON.parse(readFileSync(CLEAR, 'utf8'));
  } catch (error) {
    console.error(`${CLEAR_SHOWN} n'est pas du JSON valide : ${error.message}\nLe fichier est gardé.`);
    process.exit(1);
  }
  const problems = validate(doc);
  if (problems.length) {
    console.error(`${CLEAR_SHOWN} est gardé, à corriger :\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  await save(doc, rest.join(' ') || 'Update the manual base');
  rmSync(CLEAR);
}

async function edit() {
  await openClear();
  const editor = process.env.CONVMAP_EDITOR || 'code --wait';
  console.log(`Ouverture avec ${editor} ; fermer l'onglet pour sceller.`);
  const [program, ...options] = editor.split(' ');
  spawnSync(program, [...options, CLEAR], { stdio: 'inherit' });
  await sealClear();
}

const COMMANDS = { add, link, list: () => list(rest.join(' ')), edit, open: openClear, seal: sealClear };

if (!COMMANDS[command]) {
  console.log(USAGE);
  process.exit(command ? 1 : 0);
}
try {
  await COMMANDS[command]();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  rl?.close();
}
