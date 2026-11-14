#!/usr/bin/env node
/**
 * Owner 2026-11-14 (.claude/specs/glasgow-christmas-2026.md): a day-by-day holiday page (components/HolidaySeasonPage.astro, marked
 * data-holiday-season) never shows a day or an event that has passed, and every fact on it has a source link. Reads the real `dist/`:
 *  - a day section or day chip (data-hp-day="YYYY-MM-DD") before today fails;
 *  - an event row (data-pop-row) whose end (or start) date is before today fails;
 *  - a card or row (li.tc-card, li.pl__li) without data-hp-item, or a data-hp-item without an http(s) data-source, fails.
 * "Today" is the town's date (Europe/London unless --tz), or --today YYYY-MM-DD.
 *
 * Usage: node scripts/verify_holiday_season.mjs <dist-dir> [--today YYYY-MM-DD] [--tz Area/City]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const args = process.argv.slice(2);
const dist = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--today' && args[args.indexOf(a) - 1] !== '--tz');
if (!dist) { console.error('Usage: node scripts/verify_holiday_season.mjs <dist-dir> [--today YYYY-MM-DD] [--tz Area/City]'); process.exit(2); }
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const tz = opt('--tz') ?? 'Europe/London';
const today = opt('--today') ?? new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) { console.error(`--today: not a date: ${today}`); process.exit(2); }

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.html')) out.push(p);
  }
  return out;
}

const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

export function checkSeasonPage(html, url, day) {
  const bad = [];
  for (const [tag] of html.matchAll(/<[a-z]+\b[^>]*\sdata-hp-day="[^"]*"[^>]*>/g)) {
    const d = attr(tag, 'data-hp-day');
    if (d < day) bad.push(`${url}: shows the passed day ${d}`);
  }
  for (const [tag] of html.matchAll(/<li\b[^>]*\sdata-pop-row\b[^>]*>/g)) {
    const when = (attr(tag, 'data-end') || attr(tag, 'data-start') || '').slice(0, 10);
    if (when && when < day) bad.push(`${url}: shows an event that ended ${when}`);
  }
  for (const [tag] of html.matchAll(/<li\b[^>]*class="[^"]*\b(?:tc-card|pl__li)\b[^"]*"[^>]*>/g)) {
    if (!/\sdata-hp-item\b/.test(tag)) bad.push(`${url}: a card without a source (${tag.slice(0, 80)})`);
  }
  for (const [tag] of html.matchAll(/<[a-z]+\b[^>]*\sdata-hp-item\b[^>]*>/g)) {
    if (!/^https?:\/\//.test(attr(tag, 'data-source') ?? '')) bad.push(`${url}: an item without a source link (${tag.slice(0, 80)})`);
  }
  return bad;
}

const bad = [];
let pages = 0;
for (const file of walk(dist)) {
  const html = readFileSync(file, 'utf8');
  if (!html.includes('data-holiday-season=')) continue;
  pages++;
  bad.push(...checkSeasonPage(html, '/' + relative(dist, file).split(sep).join('/').replace(/index\.html$/, ''), today));
}
if (bad.length) { console.error(bad.join('\n')); console.error(`FAIL: ${bad.length} problem(s) on ${pages} season page(s), today ${today}`); process.exit(1); }
console.log(`OK: ${pages} season page(s), no passed day or event and every item has a source (today ${today}).`);
