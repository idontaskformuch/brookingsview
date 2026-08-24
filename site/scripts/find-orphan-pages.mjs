#!/usr/bin/env node
/**
 * Orphan-page finder for the built site (SEO Fas 1.5).
 *
 * Walks a real `astro build` output (`dist/`), builds the actual internal
 * link graph from every page's real `<a href="...">` tags (not the sitemap,
 * not getStaticPaths -- what a crawler would actually discover by
 * following links), and reports every generated page that no OTHER page
 * links to. A page can be in the sitemap and still be an orphan: the
 * sitemap tells Google a URL exists, but PageRank/crawl-priority still
 * flows through real links, so an unlinked page is effectively invisible
 * except to a crawler that already has its URL from elsewhere.
 *
 * Deliberately regex-based, no HTML parser dependency -- consistent with
 * how every other verification pass this session has scanned `dist/`
 * (see NEEDS-HUMAN-REVIEW.md's trailing-slash sweeps), and this only needs
 * to find `href="/...")` attributes, not parse a DOM.
 *
 * Usage: node scripts/find-orphan-pages.mjs <dist-dir> [--json]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const distDir = process.argv[2] ?? 'dist';
const asJson = process.argv.includes('--json');

/** Real files copied verbatim from public/ that are pages in the file-
 *  system sense but were never meant to be reached via internal nav (an
 *  arcade game embedded via its own link elsewhere, a legal doc linked
 *  only from the footer's plain-text address, etc.) -- listed explicitly
 *  so the report doesn't cry wolf about known, deliberate cases. Extend
 *  this list only when a real, deliberate exception is confirmed, not to
 *  silence a genuine gap. */
const KNOWN_EXCEPTIONS = new Set([
  '/games/jackrabbit.html',
  '/games/burro-bonanza.html',
]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (entry.endsWith('.html')) out.push(full);
  }
  return out;
}

/** Maps a built file path to the URL path a browser/crawler would request.
 *  `dist/events/index.html` -> `/events/`; `dist/404.html` -> `/404.html`
 *  (kept literal -- it's an error page, not a directory route);
 *  `dist/games/jackrabbit.html` -> `/games/jackrabbit.html` (a real static
 *  file, not a directory-style route). */
function filePathToUrlPath(distDir, filePath) {
  const rel = relative(distDir, filePath).split(sep).join('/');
  if (rel === 'index.html') return '/';
  if (rel.endsWith('/index.html')) return `/${rel.slice(0, -'index.html'.length)}`;
  return `/${rel}`;
}

const HREF_RE = /href="(\/[^"#?]*)"/g;

function extractInternalLinks(html) {
  const links = new Set();
  for (const m of html.matchAll(HREF_RE)) links.add(m[1]);
  return links;
}

const files = walk(distDir);
const pageUrls = new Set(files.map((f) => filePathToUrlPath(distDir, f)));
const linkedFrom = new Map(); // url -> Set of pages linking to it

for (const file of files) {
  const url = filePathToUrlPath(distDir, file);
  const html = readFileSync(file, 'utf-8');
  for (const href of extractInternalLinks(html)) {
    if (href === url) continue; // a page linking to itself doesn't count
    if (!linkedFrom.has(href)) linkedFrom.set(href, new Set());
    linkedFrom.get(href).add(url);
  }
}

const orphans = [...pageUrls]
  .filter((url) => url !== '/') // the homepage is the crawl root, never an orphan by definition
  .filter((url) => !url.startsWith('/404')) // the error page is never meant to be linked
  .filter((url) => !KNOWN_EXCEPTIONS.has(url))
  .filter((url) => !linkedFrom.has(url) || linkedFrom.get(url).size === 0)
  .sort();

if (asJson) {
  console.log(JSON.stringify({ totalPages: pageUrls.size, orphanCount: orphans.length, orphans }, null, 2));
} else {
  console.log(`Scanned ${pageUrls.size} pages under ${distDir}`);
  console.log(`${orphans.length} orphan page(s) (zero internal inbound links):\n`);
  for (const o of orphans) console.log(`  ${o}`);
}
