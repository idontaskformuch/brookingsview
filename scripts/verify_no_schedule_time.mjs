#!/usr/bin/env node
/**
 * AgendaLink gives a meeting two times: `scheduleIso` (a correct UTC instant, checked against broomfield.org's own calendar) and
 * `scheduleTime` (a display string with its own one-hour error: "7:00 PM" for a 6 p.m. meeting). A meeting's date and time come
 * from scheduleIso only (scrapers/parsers/agendalink_v1.py). Investigation 2026-11-12: Broomfield story 3447 carried the wrong
 * 7 PM from scheduleTime. This fails the deploy if any code reads the field: `.scheduleTime`, `["scheduleTime"]`,
 * `.get("scheduleTime")` or a quoted key anywhere in scrapers/, ai_pipeline/, scripts/ or site/src/. Prose (comments that name the
 * field without quotes) is allowed; tests and this file are not scanned. A line that names the field in order to REMOVE it
 * (ai_pipeline/publish.py, so the model never sees it) carries the marker `verify_no_schedule_time: strip` and is allowed.
 *
 * Usage: node scripts/verify_no_schedule_time.mjs [repo-root]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.argv[2] ?? join(fileURLToPath(new URL('.', import.meta.url)), '..');
const DIRS = ['scrapers', 'ai_pipeline', 'scripts', join('site', 'src')];
const EXT = /\.(py|ts|mts|mjs|js|astro|sql)$/;
const SKIP_DIR = new Set(['node_modules', '__pycache__', 'dist', '.astro']);
const SELF = 'verify_no_schedule_time.mjs';
const STRIP_MARK = 'verify_no_schedule_time: strip';
// A read in code: property access or a quoted key (dict lookup, .get(), destructuring with quotes, SQL ->> 'scheduleTime').
const READ = /\.scheduleTime\b|["']scheduleTime["']/;

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (SKIP_DIR.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXT.test(name) && name !== SELF && !/\.test\.|^test_/.test(name)) out.push(p);
  }
  return out;
}

const hits = [];
for (const d of DIRS) {
  for (const file of walk(join(root, d))) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (READ.test(line) && !line.includes(STRIP_MARK)) hits.push(`${relative(root, file).split(sep).join('/')}:${i + 1}: ${line.trim()}`);
    });
  }
}
if (hits.length) {
  console.error(`verify_no_schedule_time: AgendaLink scheduleTime is read (meeting date and time come from scheduleIso only):\n  ${hits.join('\n  ')}`);
  process.exit(1);
}
console.log('verify_no_schedule_time: ok');
