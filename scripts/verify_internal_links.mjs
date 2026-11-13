#!/usr/bin/env node
/**
 * QA build.internal-links (Broomfield AdSense plan F18, 2026-11-13): every href that starts with "/" on a built page points to a file
 * in dist/ that is not a redirect stub. Redirect stubs themselves are not checked as sources.
 *
 * Usage: node scripts/verify_internal_links.mjs <dist-dir>
 */
import fs from 'node:fs';
import path from 'node:path';
import { distReader } from '../site/src/lib/nav-prune.mjs';

const [distDir] = process.argv.slice(2);
if (!distDir) {
  console.error('Usage: node scripts/verify_internal_links.mjs <dist-dir>');
  process.exit(2);
}

const readPage = distReader(distDir);
const REFRESH_RE = /<meta\s+http-equiv=["']refresh["']/i;
const HREF_RE = /\shref="(\/(?!\/)[^"#?]*)/g;

const verdicts = new Map();
/** Why a site path is not a valid link target, or null. */
function problem(pathname) {
  if (!verdicts.has(pathname)) {
    let decoded = pathname;
    try { decoded = decodeURI(pathname); } catch { /* keep as written */ }
    const html = readPage(decoded);
    verdicts.set(pathname, html === null ? 'missing' : REFRESH_RE.test(html) ? 'redirect stub' : null);
  }
  return verdicts.get(pathname);
}

const files = fs.readdirSync(distDir, { withFileTypes: true, recursive: true })
  .filter((e) => e.isFile() && e.name.endsWith('.html'))
  .map((e) => path.join(e.parentPath ?? e.path, e.name));

const failures = new Map(); // "target (why)" -> source pages
let checked = 0;
for (const file of files) {
  const html = fs.readFileSync(file, 'utf8');
  if (REFRESH_RE.test(html)) continue;
  checked++;
  const source = '/' + path.relative(distDir, file).split(path.sep).join('/').replace(/index\.html$/, '');
  for (const [, href] of html.matchAll(HREF_RE)) {
    const why = problem(href);
    if (!why) continue;
    const key = `${href} (${why})`;
    if (!failures.has(key)) failures.set(key, new Set());
    failures.get(key).add(source);
  }
}

if (failures.size) {
  for (const [key, sources] of failures) {
    const list = [...sources];
    console.error(`[internal-links] ${key} linked from ${list.length} page(s): ${list.slice(0, 5).join(' ')}${list.length > 5 ? ' ...' : ''}`);
  }
  console.error(`[internal-links] ${failures.size} broken target(s) across ${checked} page(s)`);
  process.exit(1);
}
console.log(`[internal-links] ${checked} page(s): every internal link reaches a built page`);
