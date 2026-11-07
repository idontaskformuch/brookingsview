#!/usr/bin/env node
/**
 * Owner rule 2026-11-07 (all four towns): no empty-state messages and no explanation boxes on content pages.
 * Reads the real `dist/` of an `astro build` and fails on any page that contains one of the banned phrases:
 * "Nothing scheduled", "No weather alerts", "No wildfires" (and their siblings) or the old explanation box headings
 * ("What this shows", "How to use it" as a box heading). /how-we-gather-this/ is the one page where the per-page
 * explanations now live, so the headings are allowed there.
 *
 * Usage: node scripts/verify_no_empty_messages.mjs <dist-dir>
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const dist = process.argv[2];
if (!dist) { console.error('Usage: node scripts/verify_no_empty_messages.mjs <dist-dir>'); process.exit(2); }

const EMPTY = [
  'Nothing scheduled', 'No weather alerts', 'No weather warnings', 'No wildfires', 'No active weather alerts', 'No incidents in',
  'Nothing on the calendar', 'No marquee events', 'Nothing else listed', 'No alerts or traffic incidents', 'No current air-quality reading',
];
const BOX = ['What this shows', 'How to use it'];
const EXPLAINER_PAGE = '/how-we-gather-this/';

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.html')) out.push(p);
  }
  return out;
}

const bad = [];
let pages = 0;
for (const file of walk(dist)) {
  pages++;
  const url = '/' + relative(dist, file).split(sep).join('/').replace(/index\.html$/, '');
  const html = readFileSync(file, 'utf8');
  for (const phrase of EMPTY) if (html.includes(phrase)) bad.push(`${url}: empty message "${phrase}"`);
  if (url !== EXPLAINER_PAGE) for (const phrase of BOX) if (html.includes(phrase)) bad.push(`${url}: explanation box "${phrase}"`);
}
if (bad.length) { console.error(bad.join('\n')); console.error(`FAIL: ${bad.length} banned phrase(s) in ${pages} pages`); process.exit(1); }
console.log(`OK: no empty messages or explanation boxes in ${pages} pages.`);
