// The four exports of a selection. Every function takes the same input :
//   items   : [{ series, km }] in list order (km is null without an anchor)
//   options : { today, place, radiusKm, fromMonth, contacts }

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const TAG_LABELS = { regular: 'régulier', new: 'nouveau', paused: 'en pause ?', oneoff: 'ponctuel' };

// 'YYYY-MM' → 'février 2027'
export function monthLabel(month) {
  return `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

function dayLabel(date) {
  const day = Number(date.slice(8, 10));
  return day === 1 ? '1er' : String(day);
}

// 'le 14 novembre 2026', 'du 3 au 5 juillet 2026', 'du 27 février au 1er mars 2026'
export function rangeLabel(start, end) {
  if (!end || end === start) return `le ${dayLabel(start)} ${monthLabel(start)}`;
  if (start.slice(0, 7) === end.slice(0, 7)) return `du ${dayLabel(start)} au ${dayLabel(end)} ${monthLabel(end)}`;
  const first = start.slice(0, 4) === end.slice(0, 4) ? MONTHS[Number(start.slice(5, 7)) - 1] : monthLabel(start);
  return `du ${dayLabel(start)} ${first} au ${dayLabel(end)} ${monthLabel(end)}`;
}

function frenchDate(date) {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
}

function joinAnd(parts) {
  const count = parts.length;
  return count < 2 ? parts.join('') : `${parts.slice(0, count - 1).join(', ')} et ${parts[count - 1]}`;
}

// Distinct 'YYYY-MM' of the editions already over, oldest first.
export function pastMonths(series, today) {
  const months = [];
  for (const edition of series.editions) {
    const month = edition.start_date.slice(0, 7);
    if ((edition.end_date || edition.start_date) < today && !months.includes(month)) months.push(month);
  }
  return months;
}

function pastSentence(months) {
  const first = months[0].slice(5, 7);
  if (months.length > 1 && months.every((m) => m.slice(5, 7) === first)) {
    return `Déjà eu lieu en ${MONTHS[Number(first) - 1]} ${joinAnd(months.map((m) => m.slice(0, 4)))}`;
  }
  return `Déjà eu lieu en ${joinAnd(months.map(monthLabel))}`;
}

function title(options) {
  const { place, radiusKm, fromMonth } = options;
  let text = 'Évènements';
  if (place) text += ` autour de ${place} (${radiusKm} km)`;
  if (fromMonth) text += `, à partir de ${monthLabel(fromMonth)}`;
  return text;
}

function contactParts(series) {
  return [series.organizer, series.email, series.phone].filter(Boolean);
}

// Plain text, no markup : readable as pasted in an SMS or a mail.
export function toText(items, options) {
  const { today, contacts } = options;
  const blocks = [title(options)];
  for (const { series, km } of items) {
    const { upcoming, city, website } = series;
    const where = [city, km == null ? '' : `à ${Math.round(km)} km`].filter(Boolean).join(', ');
    const lines = [where ? `${series.name} — ${where}` : series.name];
    if (!upcoming) lines.push('Pas de prochaine édition annoncée');
    else if (upcoming.announced) lines.push(`Prochaine édition : ${rangeLabel(upcoming.event.start_date, upcoming.event.end_date)}`);
    else lines.push(`Prochaine édition : pas encore annoncée, probablement ${monthLabel(upcoming.month)}`);
    const months = pastMonths(series, today);
    if (months.length) lines.push(pastSentence(months));
    if (website) lines.push(website);
    const contact = contacts ? contactParts(series) : [];
    if (contact.length) lines.push(`Contact : ${contact.join(' — ')}`);
    blocks.push(lines.join('\n'));
  }
  return `${blocks.join('\n\n')}\n`;
}

const COLUMNS = ['Évènement', 'Ville', 'Distance km', 'Prochaine édition', 'Annoncée', 'Éditions passées', 'Tag', 'Site'];
const CONTACT_COLUMNS = ['Organisateur', 'Email', 'Téléphone'];

// Header row + one row per series, as arrays of strings.
export function toRows(items, options) {
  const { today, contacts } = options;
  const rows = [contacts ? COLUMNS.concat(CONTACT_COLUMNS) : COLUMNS];
  for (const { series, km } of items) {
    const upcoming = series.upcoming;
    let next = '';
    let announced = '';
    if (upcoming && upcoming.announced) {
      next = frenchDate(upcoming.event.start_date);
      announced = 'oui';
    } else if (upcoming) {
      next = monthLabel(upcoming.month);
      announced = 'probable';
    }
    const past = pastMonths(series, today)
      .map((m) => `${m.slice(5, 7)}/${m.slice(0, 4)}`)
      .join(', ');
    const row = [series.name, series.city, km == null ? '' : String(Math.round(km)), next, announced, past, TAG_LABELS[series.tag], series.website];
    if (contacts) row.push(series.organizer, series.email, series.phone);
    rows.push(row);
  }
  return rows;
}

// Tab-separated : pasted into Excel / Numbers / Sheets, it fills the cells.
export function toTsv(items, options) {
  return `${toRows(items, options)
    .map((row) => row.map((cell) => cell.replace(/[\t\r\n]+/g, ' ')).join('\t'))
    .join('\n')}\n`;
}

// ';' and a BOM : opens in a French Excel with its accents and its columns.
export function toCsv(items, options) {
  const quote = (cell) => (/[";\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);
  return `\uFEFF${toRows(items, options)
    .map((row) => row.map(quote).join(';'))
    .join('\r\n')}\r\n`;
}

export function toMarkdown(items, options) {
  const rows = toRows(items, options).map((row) => `| ${row.map((cell) => cell.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ')).join(' | ')} |`);
  rows.splice(1, 0, `|${' --- |'.repeat(toRows([], options)[0].length)}`);
  return `# ${title(options)}\n\n${rows.join('\n')}\n`;
}
