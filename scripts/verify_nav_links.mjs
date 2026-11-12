#!/usr/bin/env node
/**
 * QA build.nav-links (Broomfield AdSense plan F3, 2026-11-12): every link in the main menu ("Sections") and the footer ("All sections",
 * "About this site") goes to a page that is built, is not a redirect stub and does not carry noindex. Runs for the towns in
 * NAV_ONLY_INDEXABLE_TOWNS (site/src/lib/nav-prune.mjs); other towns keep their nav as it was and are skipped.
 *
 * Usage: node scripts/verify_nav_links.mjs <dist-dir> <town_id>
 */
import fs from 'node:fs';
import path from 'node:path';
import { NAV_ONLY_INDEXABLE_TOWNS, distReader } from '../site/src/lib/nav-prune.mjs';

const [distDir, townId] = process.argv.slice(2);
if (!distDir || !townId) {
  console.error('Usage: node scripts/verify_nav_links.mjs <dist-dir> <town_id>');
  process.exit(2);
}
if (!NAV_ONLY_INDEXABLE_TOWNS.has(townId)) {
  console.log(`[nav-links] ${townId}: not in NAV_ONLY_INDEXABLE_TOWNS, skipped`);
  process.exit(0);
}

const NAV_LABELS = ['Sections', 'All sections', 'About this site'];
const readPage = distReader(distDir);
const REFRESH_RE = /<meta\s+http-equiv=["']refresh["']/i;
const NOINDEX_RE = /<meta\s+name="robots"\s+content="noindex/i;

/** Why a site path is not a valid nav target, or null. Unlike nav-prune, a redirect stub is itself a failure here. */
function problem(pathname) {
  const html = readPage(pathname);
  if (html === null) return 'missing';
  if (REFRESH_RE.test(html)) return 'redirect stub';
  if (NOINDEX_RE.test(html)) return 'noindex';
  return null;
}

const files = fs.readdirSync(distDir, { withFileTypes: true, recursive: true })
  .filter((e) => e.isFile() && e.name.endsWith('.html'))
  .map((e) => path.join(e.parentPath ?? e.path, e.name));

const failures = new Map(); // href -> { reason, nav, example page }
const checked = new Set();
for (const file of files) {
  const html = fs.readFileSync(file, 'utf8');
  for (const label of NAV_LABELS) {
    const open = html.indexOf(`aria-label="${label}"`);
    if (open === -1) continue;
    const close = html.indexOf('</nav>', open);
    const region = html.slice(open, close);
    for (const m of region.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)) {
      const href = m[1];
      if (!href.startsWith('/') || href.startsWith('//')) continue;
      const pathname = new URL(href, 'https://site.internal').pathname;
      checked.add(pathname);
      if (failures.has(pathname)) continue;
      const why = problem(pathname);
      if (why) failures.set(pathname, { why, label, page: '/' + path.relative(distDir, file).split(path.sep).join('/') });
    }
  }
}

if (checked.size === 0) {
  console.error(`[nav-links] ${townId}: no menu or footer links found in ${distDir} -- markup changed?`);
  process.exit(1);
}
for (const [href, f] of failures) console.error(`[nav-links] ${townId}: ${href} (${f.why}) in "${f.label}", e.g. on ${f.page}`);
console.log(`[nav-links] ${townId}: ${checked.size} menu/footer target(s), ${failures.size} failing`);
process.exit(failures.size ? 1 : 0);
