#!/usr/bin/env node
/**
 * QA build.this-week-meeting-day (2026-11-12): on every /this-week/<week>/ page, a meeting row's day tile must be the day its
 * title names. Meeting titles end in the date publish.py wrote from the source ("City Council Regular Meeting — Tue, Nov 10, 2026",
 * Glasgow "— Tue 10 Nov 2026"); the row's data-day-key and its tile ("Wed Nov 11") must agree with it. Live 2026-11-12 they did
 * not: lib/this-week.ts read Broomfield's/Moreno's meeting instants as UTC dates, so every evening meeting sat a day late.
 *
 * Usage: node scripts/verify_this_week_days.mjs <dist-dir>
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = process.argv[2];
if (!dist) { console.error('Usage: node scripts/verify_this_week_days.mjs <dist-dir>'); process.exit(2); }

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const pad = (n) => String(n).padStart(2, '0');

/** "YYYY-MM-DD" of the date a meeting title ends with, or null when the title does not end in one. */
function titleDate(title) {
  const t = decode(title).trim();
  let m = t.match(/[—-]\s*(?:[A-Za-z]{3}),?\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s+(\d{4})$/); // US: Tue, Nov 10, 2026
  if (m) {
    const mo = MONTHS.indexOf(m[1].toLowerCase());
    return mo < 0 ? null : `${m[3]}-${pad(mo + 1)}-${pad(Number(m[2]))}`;
  }
  m = t.match(/[—-]\s*(?:[A-Za-z]{3}),?\s+(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})$/); // GB: Tue 10 Nov 2026
  if (m) {
    const mo = MONTHS.indexOf(m[2].toLowerCase());
    return mo < 0 ? null : `${m[3]}-${pad(mo + 1)}-${pad(Number(m[1]))}`;
  }
  return null;
}

/** The day a tile label names ("Wed Nov 11" / "Wed 11 Nov"), as { weekday 0-6, month 1-12, day }, or null. */
function tileParts(label) {
  const words = label.toLowerCase().split(/[\s,·]+/).filter(Boolean);
  const weekday = WEEKDAYS.findIndex((w) => words.some((x) => x.startsWith(w)));
  const month = MONTHS.findIndex((mo) => words.some((x) => x.startsWith(mo)));
  const day = Number(words.find((x) => /^\d{1,2}$/.test(x)));
  return weekday < 0 || month < 0 || !day ? null : { weekday, month: month + 1, day };
}

/** Problems on one built page's HTML. */
function meetingDayProblems(html) {
  const out = [];
  for (const row of html.matchAll(/<li\b[^>]*\bdata-day-key="(\d{4}-\d{2}-\d{2})"[^>]*>([\s\S]*?)<\/li>/g)) {
    const [, key, body] = row;
    const title = body.match(/class="pl__title"[^>]*>([\s\S]*?)<\/span>/)?.[1]?.replace(/<[^>]+>/g, '');
    const named = title ? titleDate(title) : null;
    if (!named) continue;
    if (key !== named) { out.push(`"${decode(title)}" is listed under day ${key}`); continue; }
    const label = body.match(/class="tile__sr"[^>]*>([^<]*)</)?.[1];
    if (!label) continue;
    const [y, mo, d] = named.split('-').map(Number);
    const want = { weekday: new Date(Date.UTC(y, mo - 1, d)).getUTCDay(), month: mo, day: d };
    const got = tileParts(label);
    if (!got || got.weekday !== want.weekday || got.month !== want.month || got.day !== want.day) {
      out.push(`"${decode(title)}" has the tile "${label}"`);
    }
  }
  return out;
}

const root = join(dist, 'this-week');
const problems = [];
if (existsSync(root)) {
  for (const week of readdirSync(root, { withFileTypes: true })) {
    if (!week.isDirectory()) continue;
    const file = join(root, week.name, 'index.html');
    if (!existsSync(file)) continue;
    for (const p of meetingDayProblems(readFileSync(file, 'utf8'))) problems.push(`/this-week/${week.name}/: ${p}`);
  }
}
if (problems.length) {
  console.error(`verify_this_week_days: ${problems.length} meeting row(s) on the wrong day:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log('verify_this_week_days: ok');
