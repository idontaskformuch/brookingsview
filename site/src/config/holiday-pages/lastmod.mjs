// Sitemap lastmod of the holiday pages. Plain .mjs on purpose: astro.config.mjs runs before Vite's module graph
// exists, so it cannot import TypeScript (same constraint as lib/status-tokens.mjs).
//
// The date is the day a row's value, status or source last changed (data-updated.json, kept by hand next to the
// page data). A recheck that confirms the same thing leaves it alone, and the build never writes it: with no
// argument but a town, the result is identical on every build.
import fs from 'node:fs';

const FILE = new URL('./data-updated.json', import.meta.url);

/** { slug: { townId: 'YYYY-MM-DD' } } */
export function readDataUpdated() {
  return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}

/** Map of pathname -> 'YYYY-MM-DD' for one town: each of its holiday pages, and /holidays/ (the newest of them). */
export function holidayLastmodEntries(townId) {
  const entries = new Map();
  let newest = '';
  for (const [slug, towns] of Object.entries(readDataUpdated())) {
    const date = towns[townId];
    if (!date) continue;
    entries.set(`/${slug}/`, date);
    if (date > newest) newest = date;
  }
  if (newest) entries.set('/holidays/', newest);
  return entries;
}
