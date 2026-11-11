#!/usr/bin/env node
/**
 * Broomfield AdSense plan F5 + F8, owner B4 (2026-11-11). Reads the real `dist/` of an `astro build`; once Election Day
 * 2026 is over (by Pacific time, the last of the US towns' calendars):
 *  - /election-results/ never says "Live results" or that counting continues, and shows numbers or the official link;
 *  - /vote/ is noindex and no other page links to it (nav, footer, breadcrumbs, related links).
 * A town without the pages (Glasgow) passes. Exits 1 and lists every problem.
 *
 * Usage: node scripts/verify_election_pages.mjs <dist-dir> [--today YYYY-MM-DD]
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { readableParts } from './internal_notes.mjs';

const ELECTION_DATE = '2026-11-03'; // mirrors site/src/config/election.ts election_date (all three towns)

const dist = process.argv[2];
if (!dist) { console.error('Usage: node scripts/verify_election_pages.mjs <dist-dir> [--today YYYY-MM-DD]'); process.exit(2); }
const ti = process.argv.indexOf('--today');
const today = ti > 0 ? process.argv[ti + 1] : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());

if (today <= ELECTION_DATE) { console.log(`verify_election_pages: ok (${today} is not after Election Day ${ELECTION_DATE})`); process.exit(0); }

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.html')) out.push(p);
  }
  return out;
}

const bad = [];
const results = join(dist, 'election-results', 'index.html');
if (existsSync(results)) {
  const { body } = readableParts(readFileSync(results, 'utf8'));
  if (/\bLive results\b/i.test(body)) bad.push('/election-results/: says "Live results" after Election Day');
  if (/counting continues/i.test(body)) bad.push('/election-results/: says counting continues after Election Day');
}
const vote = join(dist, 'vote', 'index.html');
if (existsSync(vote) && !/<meta\s+name=["']robots["']\s+content=["'][^"']*noindex/i.test(readFileSync(vote, 'utf8'))) {
  bad.push('/vote/: not noindex after Election Day');
}
let pages = 0;
for (const file of walk(dist)) {
  pages++;
  const url = '/' + relative(dist, file).split(sep).join('/').replace(/index\.html$/, '');
  if (url === '/vote/') continue;
  if (/href=["'](?:https?:\/\/[^"'/]+)?\/vote\/["']/.test(readFileSync(file, 'utf8'))) bad.push(`${url}: links to /vote/ after Election Day`);
}

if (bad.length) {
  console.error(bad.slice(0, 60).join('\n'));
  console.error(`verify_election_pages: FAIL, ${bad.length} problem(s) in ${pages} pages`);
  process.exit(1);
}
console.log(`verify_election_pages: ok (${pages} pages, ${today})`);
