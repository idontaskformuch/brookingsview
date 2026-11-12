#!/usr/bin/env node
/**
 * QA build.description-day (2026-11-12): the day a /s/ or /whats-on/ page's meta description names must be the day its own date
 * line shows (/s/ .story__when, /whats-on/ .lede__when). A description that names a day on a page whose date line has none fails
 * too: Glasgow's series pages said "Regular · Sat 10:30am" while the description fixed one date ("Saturday 14 Nov 2026"), which
 * goes stale after a week (two of them already named a past Wednesday).
 *
 * A description day is weekday + date + year, as the builders and meeting titles write it: "Sun 15 Nov 2026", "Sunday 15 Nov 2026"
 * (en-GB), "Tue, Nov 10, 2026", "Thursday, November 26, 2026" (en-US). The last one in the description is the page's day; one
 * that is the headline's own text is not checked (a meeting title's day is checked against /this-week/ by verify_this_week_days).
 *
 * Usage: node scripts/verify_description_days.mjs <dist-dir>
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = process.argv[2];
if (!dist) { console.error('Usage: node scripts/verify_description_days.mjs <dist-dir>'); process.exit(2); }

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const WD = '(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\\.?';
const MO = '(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?';
const GB_DAY = new RegExp(`\\b${WD},?\\s+(\\d{1,2})\\s+${MO}\\s+(\\d{4})\\b`, 'g');
const US_DAY = new RegExp(`\\b${WD},?\\s+${MO}\\s+(\\d{1,2}),\\s+(\\d{4})\\b`, 'g');
const decode = (s) => s.replace(/&#34;|&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&middot;/g, '·').replace(/&amp;/g, '&');

/** The last day the description names, as { weekday 0-6, month 1-12, day, text }, or null. */
export function descriptionDay(text) {
  const found = [];
  for (const m of text.matchAll(GB_DAY)) found.push({ at: m.index, wd: m[1], d: m[2], mo: m[3], text: m[0] });
  for (const m of text.matchAll(US_DAY)) found.push({ at: m.index, wd: m[1], mo: m[2], d: m[3], text: m[0] });
  if (!found.length) return null;
  const last = found.sort((a, b) => a.at - b.at).at(-1);
  return {
    weekday: WEEKDAYS.indexOf(last.wd.toLowerCase()), month: MONTHS.indexOf(last.mo.toLowerCase()) + 1,
    day: Number(last.d), text: last.text,
  };
}

/** The day a date line shows ("Sun 15 November at 7pm", "Tue, June 23", "Thursday, November 26, 2026 · 7:30 PM"), or null when it
 *  names no date ("Regular · Sat 10:30am"). */
export function lineDay(line) {
  const words = line.toLowerCase().split(/[\s,·]+/).filter(Boolean);
  const weekday = WEEKDAYS.findIndex((w) => words.some((x) => x.startsWith(w)));
  const month = MONTHS.findIndex((mo) => words.some((x) => x.startsWith(mo)));
  const day = Number(words.find((x) => /^\d{1,2}$/.test(x)));
  return month < 0 || !day ? null : { weekday, month: month + 1, day };
}

/** The problem with one built page, or null. */
export function pageProblem(html) {
  const desc = html.match(/<meta name="description" content="([^"]*)"/)?.[1];
  if (!desc) return null;
  const named = descriptionDay(decode(desc));
  if (!named) return null;
  // A day copied from the headline is the page's own text: brookings /s/alert-25598/ "Heat Advisory ... from 12:00 PM Saturday
  // July 25, 2026 - ..." names the advisory's window, its date line the time it was posted (Fri, July 24 at 11:40 AM).
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1];
  if (h1 && decode(h1.replace(/<[^>]+>/g, '')).includes(named.text)) return null;
  const line = html.match(/class="(?:story__when|lede__when) data"[^>]*>([\s\S]*?)<\/p>/)?.[1];
  const lineText = line ? decode(line.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim() : '';
  const shown = lineText ? lineDay(lineText) : null;
  if (!shown) return `the description names "${named.text}", the page shows no date${lineText ? ` ("${lineText}")` : ''}`;
  if (shown.month !== named.month || shown.day !== named.day || (shown.weekday >= 0 && shown.weekday !== named.weekday)) {
    return `the description names "${named.text}", the page shows "${lineText}"`;
  }
  return null;
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/').replace(/^(?=[A-Za-z]:)/, '/')}`) {
  const problems = [];
  let checked = 0;
  for (const section of ['s', 'whats-on']) {
    const root = join(dist, section);
    if (!existsSync(root)) continue;
    for (const page of readdirSync(root, { withFileTypes: true })) {
      if (!page.isDirectory()) continue;
      const file = join(root, page.name, 'index.html');
      if (!existsSync(file)) continue;
      checked += 1;
      const p = pageProblem(readFileSync(file, 'utf8'));
      if (p) problems.push(`/${section}/${page.name}/: ${p}`);
    }
  }
  if (problems.length) {
    console.error(`verify_description_days: ${problems.length} of ${checked} page(s) whose description day is not the page's day:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`verify_description_days: ${checked} /s/ + /whats-on/ pages, description day = page day`);
}
