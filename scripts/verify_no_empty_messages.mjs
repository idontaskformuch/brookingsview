#!/usr/bin/env node
/**
 * Owner rule 2026-11-07 (all four towns): no empty-state messages and no explanation boxes on content pages.
 * Reads the real `dist/` of an `astro build` and fails on any page that contains one of the banned phrases:
 * "Nothing scheduled", "No weather alerts", "No wildfires" (and their siblings) or the old explanation box headings
 * ("What this shows", "How to use it" as a box heading). /how-we-gather-this/ is the one page where the per-page
 * explanations now live, so the headings are allowed there.
 *
 * Not an empty message: /traffic/'s "No crashes or closures reported on state highways in or near <town> as of <date, time>" (Broomfield
 * AdSense plan F4, owner-approved 2026-11-11). It states a checked fact with the time of the read, links to the live state map, and the
 * page is noindex while it shows (lib/traffic-verdict.ts). Do not add its wording to EMPTY.
 *
 * Two more checks on the same real build:
 *  - a town without a /traffic/ page (no dist/traffic/index.html: no traffic source) has no link to /traffic/ anywhere (owner 2026-11-07);
 *  - no page mentions a domain on scripts/blocked-domains.json (a hijacked or unsafe domain);
 *  - no "Not confirmed" / "Page lists no year" status text (holiday rows, F9 2026-11-11);
 *  - no "About this page" box is a heading with nothing under it (Broomfield AdSense plan F5, 2026-11-11: /election-results/'s slot held
 *    only an optional notice that Broomfield does not have).
 *
 * Usage: node scripts/verify_no_empty_messages.mjs <dist-dir>
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const dist = process.argv[2];
if (!dist) { console.error('Usage: node scripts/verify_no_empty_messages.mjs <dist-dir>'); process.exit(2); }

const EMPTY = [
  'Nothing scheduled', 'No weather alerts', 'No weather warnings', 'No wildfires', 'No active weather alerts', 'No incidents in',
  'Nothing on the calendar', 'No marquee events', 'Nothing else listed', 'No alerts or traffic incidents', 'No current air-quality reading',
];
// Broomfield AdSense plan F9 (2026-11-11): a holiday row whose notice is not out yet is a plain link to the place's page
// (lib/holiday-view.ts), never a "Not confirmed" status, and no row says its source "lists no year".
const UNCONFIRMED = ['Not confirmed', 'Page lists no year'];
const BOX = ['What this shows', 'How to use it'];
const EXPLAINER_PAGE = '/how-we-gather-this/';
const BLOCKED = JSON.parse(readFileSync(new URL('./blocked-domains.json', import.meta.url), 'utf8')).domains;
const hasTrafficPage = existsSync(join(dist, 'traffic', 'index.html'));
const TRAFFIC_LINK = /href=["']\/traffic\/?["'#?]/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.html')) out.push(p);
  }
  return out;
}

/** The body of components/ui/AboutThisPage.astro (div.ui-about__body) has no visible text. */
function emptyAboutBox(html) {
  const m = html.match(/<section[^>]*data-about-this-page[^>]*>[\s\S]*?<div[^>]*class="ui-about__body[^"]*"[^>]*>([\s\S]*?)<\/section>/);
  return !!m && m[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;|\s+/g, '').length === 0;
}

const bad = [];
let pages = 0;
for (const file of walk(dist)) {
  pages++;
  const url = '/' + relative(dist, file).split(sep).join('/').replace(/index\.html$/, '');
  const html = readFileSync(file, 'utf8');
  for (const phrase of EMPTY) if (html.includes(phrase)) bad.push(`${url}: empty message "${phrase}"`);
  if (!hasTrafficPage && TRAFFIC_LINK.test(html)) bad.push(`${url}: link to /traffic/ but this town has no traffic page`);
  for (const b of BLOCKED) if (html.toLowerCase().includes(b.domain)) bad.push(`${url}: blocked domain ${b.domain} (${b.reason})`);
  if (url !== EXPLAINER_PAGE) for (const phrase of BOX) if (html.includes(phrase)) bad.push(`${url}: explanation box "${phrase}"`);
  for (const phrase of UNCONFIRMED) if (html.includes(phrase)) bad.push(`${url}: status text "${phrase}"`);
  if (emptyAboutBox(html)) bad.push(`${url}: "About this page" heading with no text under it`);
}
if (bad.length) { console.error(bad.join('\n')); console.error(`FAIL: ${bad.length} banned phrase(s) in ${pages} pages`); process.exit(1); }
console.log(`OK: no empty messages or explanation boxes in ${pages} pages.`);
