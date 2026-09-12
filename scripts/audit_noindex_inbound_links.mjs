#!/usr/bin/env node
/**
 * Render-window handoff, Phase 0a (blocking): "how many currently-noindex
 * pages are internally linked from at least one INDEXABLE page." This is
 * the number that decides how risky dropping old pages from the build is
 * -- a hub page linking into hundreds of soon-to-be-unbuilt parcel pages
 * is a real quality problem the handoff wants surfaced before anything
 * else changes.
 *
 * Reuses the metadata audit's own noindex/indexable classification
 * (reports/metadata-audit-<town_id>.csv, from scripts/audit_page_metadata.mjs)
 * rather than re-deriving it a third time -- run that script against the
 * SAME dist/ first. Same "read the real built output" convention as
 * verify_sitemap_noindex_disjoint.mjs and audit_page_metadata.mjs.
 *
 * Usage: node scripts/audit_noindex_inbound_links.mjs <dist-dir> <town_id>
 * Writes reports/noindex-inbound-links-<town_id>.csv: noindex route,
 * linking route, link context (nav/breadcrumb/related-content/in-prose).
 */
import { readFileSync, writeFileSync, mkdirSync, globSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const distDir = process.argv[2];
const townId = process.argv[3];
if (!distDir || !townId) {
  console.error('Usage: node scripts/audit_noindex_inbound_links.mjs <dist-dir> <town_id>');
  process.exit(2);
}

const auditCsvPath = `reports/metadata-audit-${townId}.csv`;
let auditCsv;
try {
  auditCsv = readFileSync(auditCsvPath, 'utf-8');
} catch {
  console.error(`No ${auditCsvPath} found -- run scripts/audit_page_metadata.mjs against this SAME dist/ first.`);
  process.exit(2);
}

// Minimal CSV parse -- only 'route' (col 0) and 'isNoindex' (col 2) are
// needed here, and neither ever contains a comma/quote in practice (routes
// are URL paths; isNoindex is a bare true/false), so a full CSV parser
// isn't warranted for this one read.
const [header, ...dataLines] = auditCsv.trim().split('\n');
const columns = header.split(',');
const routeIdx = columns.indexOf('route');
const noindexIdx = columns.indexOf('isNoindex');

const noindexRoutes = new Set();
const indexableRoutes = new Set();
for (const line of dataLines) {
  const cells = line.split(',');
  const route = cells[routeIdx];
  const isNoindex = cells[noindexIdx] === 'true';
  (isNoindex ? noindexRoutes : indexableRoutes).add(route);
}

// --- link context detection --------------------------------------------

/** Named <nav> regions this codebase already uses, keyed by their own
 *  aria-label -- see Breadcrumbs.astro, RelatedStories.astro,
 *  RelatedContent.astro, BaseLayout.astro's own site/footer nav. Anything
 *  else is "in-prose" (a plain contextual link inside body content). */
const NAV_CONTEXT_BY_ARIA_LABEL = {
  'Breadcrumb': 'breadcrumb',
  'More to read': 'related-content module',
  'You might also like': 'related-content module',
  'Sections': 'nav',
  'All sections': 'nav',
  'About this site': 'nav',
};

function findNavRegions(html) {
  const regions = [];
  const navOpenRe = /<nav\b[^>]*aria-label="([^"]*)"[^>]*>/g;
  let match;
  while ((match = navOpenRe.exec(html))) {
    const start = match.index;
    const closeIdx = html.indexOf('</nav>', navOpenRe.lastIndex);
    if (closeIdx === -1) continue;
    const context = NAV_CONTEXT_BY_ARIA_LABEL[match[1]] ?? 'nav';
    regions.push({ start, end: closeIdx, context });
  }
  return regions;
}

function contextForOffset(offset, navRegions) {
  for (const region of navRegions) {
    if (offset >= region.start && offset <= region.end) return region.context;
  }
  return 'in-prose';
}

/** Resolves an <a href="..."> value to a same-site pathname, or null for
 *  anything that isn't an internal page link (mailto:, tel:, #anchor,
 *  external domains, asset files). */
function resolveInternalPathname(href, siteOrigin) {
  if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return null;
  try {
    const url = href.startsWith('http') ? new URL(href) : new URL(href, siteOrigin);
    if (url.origin !== siteOrigin) return null;
    return url.pathname;
  } catch {
    return null;
  }
}

// --- walk every INDEXABLE page's HTML -----------------------------------

const files = globSync(join(distDir, '**', 'index.html').split(sep).join('/'));
// A fixed placeholder origin -- only used to resolve relative hrefs against
// a base; the SCHEME+HOST are discarded immediately by resolveInternalPathname,
// so this never needs to be the town's real domain.
const SITE_ORIGIN = 'https://site.internal';

// noindexRoute -> [{ linkingRoute, context }]
const inbound = new Map();

for (const file of files) {
  const rel = relative(distDir, file).split(sep).join('/');
  const route = '/' + rel.replace(/index\.html$/, '');
  const normalizedRoute = route === '/index.html' ? '/' : route;
  if (!indexableRoutes.has(normalizedRoute)) continue; // only indexable SOURCES matter here

  const html = readFileSync(file, 'utf-8');
  const navRegions = findNavRegions(html);
  const linkRe = /<a\b[^>]*\shref="([^"]*)"/g;
  let match;
  while ((match = linkRe.exec(html))) {
    const targetPathname = resolveInternalPathname(match[1], SITE_ORIGIN);
    if (!targetPathname || !noindexRoutes.has(targetPathname)) continue;
    const context = contextForOffset(match.index, navRegions);
    if (!inbound.has(targetPathname)) inbound.set(targetPathname, []);
    inbound.get(targetPathname).push({ linkingRoute: normalizedRoute, context });
  }
}

// --- CSV output ----------------------------------------------------------

function csvEscape(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const lines = ['noindexRoute,linkingRoute,context'];
for (const [noindexRoute, links] of inbound) {
  for (const { linkingRoute, context } of links) {
    lines.push([noindexRoute, linkingRoute, context].map(csvEscape).join(','));
  }
}

mkdirSync('reports', { recursive: true });
const outPath = `reports/noindex-inbound-links-${townId}.csv`;
writeFileSync(outPath, lines.join('\n') + '\n', 'utf-8');

console.log(
  `[${townId}] ${inbound.size} noindex route(s) are linked from at least one indexable page ` +
  `(${lines.length - 1} total link(s)) -- wrote ${outPath}`,
);
