#!/usr/bin/env node
/**
 * Owner rule 2026-11-11: no page type renders explanatory text between the H1 and the first content block (see scripts/content_first.mjs).
 * Reads the real `dist/` of an `astro build`; exits 1 and lists every offending page.
 *
 * Usage: node scripts/verify_content_first.mjs <dist-dir>
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { findIntroText } from './content_first.mjs';

const dist = process.argv[2];
if (!dist) { console.error('Usage: node scripts/verify_content_first.mjs <dist-dir>'); process.exit(2); }

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
  const found = findIntroText(readFileSync(file, 'utf8'), path);
  if (found.length) bad.push({ path, text: found[0] });
}

if (bad.length) {
  console.error(`verify_content_first: ${bad.length} of ${pages} pages have explanatory text between the H1 and the content:`);
  for (const b of bad.slice(0, 60)) console.error(`  ${b.path}  "${b.text.slice(0, 110)}"`);
  process.exit(1);
}
console.log(`verify_content_first: ok (${pages} pages)`);
