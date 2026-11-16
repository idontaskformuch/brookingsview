#!/usr/bin/env node
/**
 * Audit Fas 1 (2026-11-16, P4-2 / 01-built-pages.md 5.2): every redirect stub a town's build writes to dist/ (Astro's
 * meta-refresh file for a page that does Astro.redirect('/')) must have an entry in the Worker's STATIC_GATE_REDIRECTS
 * or GONE_SECTIONS_BY_TOWN (site/server/_shared.ts). Without one the Worker serves the stub as a 200 meta refresh.
 * Glasgow had no entries at all; Brookings /safety/, Moreno /open-late/ and three more were missing elsewhere.
 * Exits 1 and lists the paths that would be served as 200.
 *
 * Usage: node scripts/verify_stub_redirects.mjs <dist-dir> <town_id>   (town_id defaults to $SITE_CITY)
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { resolveStaticGateRedirect, isGoneSection } from '../site/server/_shared.ts';

const dist = process.argv[2];
const town = process.argv[3] ?? process.env.SITE_CITY;
if (!dist || !town) { console.error('Usage: node scripts/verify_stub_redirects.mjs <dist-dir> <town_id>'); process.exit(2); }

const STUB = /<meta http-equiv="refresh" content="\d+;url=\/">/;

function* indexFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* indexFiles(p);
    else if (entry.name === 'index.html') yield p;
  }
}

const unserved = [];
let stubs = 0;
for (const file of indexFiles(dist)) {
  if (!STUB.test(readFileSync(file, 'utf8'))) continue;
  stubs += 1;
  const dir = relative(dist, file).split(sep).slice(0, -1).join('/');
  const path = dir ? `/${dir}/` : '/';
  if (!resolveStaticGateRedirect(path, town) && !isGoneSection(path, town)) unserved.push(path);
}
if (unserved.length) {
  console.error(`verify_stub_redirects: ${town} has redirect stubs the Worker would serve as 200: ${unserved.sort().join(', ')}`);
  process.exit(1);
}
console.log(`verify_stub_redirects: ok (${town}, ${stubs} stubs)`);
