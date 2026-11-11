#!/usr/bin/env node
/**
 * Broomfield AdSense plan F6 (2026-11-11): no working note (NEEDS-HUMAN-REVIEW, a .md file name, TODO, PENDING, FIXME) in the
 * visible text, <title> or meta description of any built page (see scripts/internal_notes.mjs).
 * Reads the real `dist/` of an `astro build`; exits 1 and lists every offending page.
 *
 * Usage: node scripts/verify_no_internal_notes.mjs <dist-dir>
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { findInternalNotes } from './internal_notes.mjs';

const dist = process.argv[2];
if (!dist) { console.error('Usage: node scripts/verify_no_internal_notes.mjs <dist-dir>'); process.exit(2); }

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
  const rel = relative(dist, file).split(sep).join('/');
  const path = rel === 'index.html' ? '/' : rel.endsWith('/index.html') ? `/${rel.slice(0, -'index.html'.length)}` : `/${rel}`;
  pages += 1;
  for (const f of findInternalNotes(readFileSync(file, 'utf8'))) bad.push({ path, ...f });
}

if (bad.length) {
  console.error(`verify_no_internal_notes: ${bad.length} internal note(s) in ${pages} pages:`);
  for (const b of bad.slice(0, 60)) console.error(`  ${b.path}  [${b.where}] ${b.name}: "${b.text.slice(0, 140)}"`);
  process.exit(1);
}
console.log(`verify_no_internal_notes: ok (${pages} pages)`);
