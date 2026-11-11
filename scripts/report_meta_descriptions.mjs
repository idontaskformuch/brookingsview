#!/usr/bin/env node
/**
 * Every meta description of a built town, for reading (owner 2026-11-11: the mid-sentence cut on facility pages should be ruled out
 * for every meta description in the repo, and the whole set read later). Writes a TSV, one row per page: path, indexable, length,
 * flags, description. Exits 1 when an INDEXABLE page has a hard flag (missing, word cut, no sentence end, internal " -- ").
 *
 * Flags: missing, short(<70), long(>160), word-cut (ends in "…"), no-end (no . ! ? at the end), dash (" -- "), dup (same text on
 * another page of this town).
 *
 * Usage: node scripts/report_meta_descriptions.mjs <dist-dir> <out.tsv>
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const [dist, out] = process.argv.slice(2);
if (!dist || !out) { console.error('Usage: node scripts/report_meta_descriptions.mjs <dist-dir> <out.tsv>'); process.exit(2); }

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (name.endsWith('.html')) acc.push(p);
  }
  return acc;
}
const decode = (s) => s.replace(/&#38;/g, '&').replace(/&#39;/g, "'").replace(/&#34;/g, '"').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

const rows = [];
for (const file of walk(dist)) {
  const html = readFileSync(file, 'utf8');
  if (/http-equiv=["']refresh["']/i.test(html)) continue; // redirect stubs
  const rel = relative(dist, file).split(sep).join('/');
  // not pages: search-console verification files and the embedded games (their pages are /play and /burro-bonanza)
  if (/^google[0-9a-f]+\.html$/.test(rel) || rel.startsWith('games/')) continue;
  const path = rel === 'index.html' ? '/' : rel.endsWith('/index.html') ? `/${rel.slice(0, -'index.html'.length)}` : `/${rel}`;
  const m = html.match(/<meta\s+name=["']description["']\s+content=(["'])([\s\S]*?)\1/i);
  const description = m ? decode(m[2]).trim() : null;
  const indexable = !/<meta\s+name=["']robots["']\s+content=["'][^"']*noindex/i.test(html);
  rows.push({ path, indexable, description });
}
const seen = new Map();
for (const r of rows) if (r.description) seen.set(r.description, (seen.get(r.description) ?? 0) + 1);

const HARD = new Set(['missing', 'word-cut', 'no-end', 'dash', 'newline']);
const bad = [];
const lines = ['path\tindexable\tlength\tflags\tdescription'];
for (const r of rows.sort((a, b) => a.path.localeCompare(b.path))) {
  const d = r.description ?? '';
  const flags = [];
  if (!r.description) flags.push('missing');
  else {
    if (d.length < 70) flags.push('short');
    if (d.length > 160) flags.push('long');
    if (/[\r\n]/.test(d)) flags.push('newline');
    if (d.endsWith('…')) flags.push('word-cut');
    else if (!/[.!?]["')]?$/.test(d)) flags.push('no-end');
    if (d.includes(' -- ')) flags.push('dash');
    if (seen.get(d) > 1) flags.push('dup');
  }
  if (r.indexable && flags.some((f) => HARD.has(f))) bad.push(`${r.path} [${flags.join(',')}] ${d}`);
  lines.push([r.path, r.indexable ? 'yes' : 'no', d.length, flags.join(','), d.replace(/\t/g, ' ')].join('\t'));
}
writeFileSync(out, `${lines.join('\n')}\n`, 'utf8');
const indexableCount = rows.filter((r) => r.indexable).length;
console.log(`report_meta_descriptions: ${rows.length} pages (${indexableCount} indexable) -> ${out}`);
if (bad.length) {
  console.error(`report_meta_descriptions: ${bad.length} indexable page(s) with a hard flag:`);
  for (const b of bad.slice(0, 40)) console.error(`  ${b}`);
  process.exit(1);
}
