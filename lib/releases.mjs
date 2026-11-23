// Reads CHANGELOG.md : a "## 1.2.0 — 2026-11-23" title opens a release, the
// "- " lines under it are what changed. Returns the releases as written,
// newest first : [{ version, date, items }].
export function parseReleases(text) {
  const releases = [];
  let current = null;
  for (const line of text.split('\n')) {
    const title = /^## +(\d+\.\d+\.\d+)(?: +— +(\d{4}-\d{2}-\d{2}))?\s*$/.exec(line);
    if (title) {
      current = { version: title[1], date: title[2] || '', items: [] };
      releases.push(current);
    } else if (current && line.startsWith('- ')) {
      current.items.push(line.slice(2).trim());
    } else if (current && current.items.length && /^\s+\S/.test(line)) {
      // A wrapped line continues the item above it.
      current.items[current.items.length - 1] += ` ${line.trim()}`;
    }
  }
  return releases;
}
