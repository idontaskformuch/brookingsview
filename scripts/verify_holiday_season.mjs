#!/usr/bin/env node
/**
 * Owner 2026-11-14 (.claude/specs/glasgow-christmas-2026.md): a day-by-day holiday page (components/HolidaySeasonPage.astro, marked
 * data-holiday-season) never shows a day or an event that has passed, and every fact on it has a source link. Reads the real `dist/`:
 *  - a day section or day chip (data-hp-day="YYYY-MM-DD") before today fails;
 *  - an event row (data-pop-row) whose end (or start) date is before today fails;
 *  - a card or row (li.tc-card, li.pl__li) without data-hp-item, or a data-hp-item without an http(s) data-source, fails;
 *  - a day section without a card fails (owner 2026-11-14: no card, no section; Mon 4 Jan was built empty);
 *  - the same card (title and value) with different status pills on different days fails (owner 2026-11-14: one fact, one marking);
 *  - the same title at the same venue (data-hp-venue, else the row's place) twice in one day section or twice in the season list fails (owner 2026-11-15:
 *    several performances are one series card).
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
  for (const [, tag, body] of html.matchAll(/(<section\b[^>]*class="hs-day\b[^"]*"[^>]*>)([\s\S]*?)<\/section>/g)) {
    if (!/<li\b[^>]*class="[^"]*\b(?:tc-card|pl__li)\b/.test(body)) bad.push(`${url}: the day ${attr(tag, 'data-hp-day')} has no card`);
  }
  // The same card (place and value) carries the same status pill on every day it is shown.
  const text = (body, cls) => body.match(new RegExp(`class="${cls}\\b[^"]*"[^>]*>([^<]*)<`))?.[1].trim() ?? '';
  const pills = new Map();
  for (const [, body] of html.matchAll(/<li\b[^>]*class="tc-card\b[^"]*"[^>]*>([\s\S]*?)<\/li>/g)) {
    const key = `${text(body, 'tc-title')} · ${text(body, 'tc-time')}`;
    pills.set(key, new Set([...(pills.get(key) ?? []), text(body, 'ui-pill')]));
  }
  for (const [key, set] of pills) if (set.size > 1) bad.push(`${url}: "${key}" is marked ${[...set].map((p) => `"${p}"`).join(' and ')} on different days`);
  // One title at one venue is one card per day section and one row in the season list (owner 2026-11-15: a series, not a row per
  // performance). Title and venue case and spacing aside.
  const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const groups = [
    ...[...html.matchAll(/(<section\b[^>]*class="hs-day\b[^"]*"[^>]*>)([\s\S]*?)<\/section>/g)].map(([, tag, body]) => [`the day ${attr(tag, 'data-hp-day')}`, body]),
    ...[...html.matchAll(/<section\b[^>]*aria-label="Events"[^>]*>([\s\S]*?)<\/section>/g)].map(([, body]) => ['the season list', body]),
  ];
  for (const [where, body] of groups) {
    const seen = new Set();
    for (const [, tag, row] of body.matchAll(/(<li\b[^>]*class="[^"]*\bpl__li\b[^"]*"[^>]*>)([\s\S]*?)<\/li>/g)) {
      // Pages built before 2026-11-15 have no data-hp-venue: the place is then the last part of the row's "time · place" line.
      const venue = attr(tag, 'data-hp-venue') ?? text(row, 'pl__meta').split(' · ').pop();
      const title = text(row, 'pl__title');
      const key = `${norm(title)}|${norm(venue)}`;
      if (seen.has(key)) bad.push(`${url}: "${title}" at ${venue} is listed more than once in ${where}`);
      seen.add(key);
    }
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
console.log(`OK: ${pages} season page(s), no passed or empty day, no passed event, every item has a source and one marking, one card per title and venue (today ${today}).`);
