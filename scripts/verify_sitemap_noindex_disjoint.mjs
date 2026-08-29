#!/usr/bin/env node
/**
 * Real, build-verifiable proof for AdSense "low value content" remediation
 * Phase A5: no URL that carries <meta name="robots" content="noindex...">
 * may also appear in the generated sitemap. A unit test can only assert
 * that the two DECISION FUNCTIONS agree in isolation -- this instead reads
 * the actual `dist/` output of a real `astro build` and checks the real
 * files, since the sitemap is built in astro.config.mjs (a duplicated
 * mirror of the noindex logic that lives in the page components -- see
 * that file's own "Mirrors lib/noindex.ts" comments) and a mirror can
 * always drift from what it mirrors.
 *
 * Usage: node scripts/verify_sitemap_noindex_disjoint.mjs <dist-dir>
 * Exits 1 and prints every offending URL if any sitemap entry's own built
 * page carries noindex. Exits 0 (silently) if the sets are disjoint.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const distDir = process.argv[2];
if (!distDir) {
  console.error('Usage: node scripts/verify_sitemap_noindex_disjoint.mjs <dist-dir>');
  process.exit(2);
}

const sitemapPath = join(distDir, 'sitemap-0.xml');
if (!existsSync(sitemapPath)) {
  console.error(`No sitemap found at ${sitemapPath} -- did the build run @astrojs/sitemap?`);
  process.exit(2);
}

const sitemapXml = readFileSync(sitemapPath, 'utf-8');
const urls = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

const offenders = [];
for (const url of urls) {
  const pathname = new URL(url).pathname;
  const htmlPath = join(distDir, pathname, 'index.html');
  if (!existsSync(htmlPath)) {
    // A sitemap URL with no corresponding built file is a separate, worse
    // problem (Phase G: "confirm no page in the sitemap returns a 404") --
    // flagged here too since we're already walking every URL.
    offenders.push(`${pathname} -- NOT FOUND on disk (would 404)`);
    continue;
  }
  const html = readFileSync(htmlPath, 'utf-8');
  if (/<meta\s+name="robots"\s+content="noindex/i.test(html)) {
    offenders.push(`${pathname} -- carries noindex but is listed in the sitemap`);
  }
}

if (offenders.length > 0) {
  console.error(`FAILED: ${offenders.length} sitemap/noindex contradiction(s):`);
  for (const o of offenders) console.error(`  - ${o}`);
  process.exit(1);
}

console.log(`OK: all ${urls.length} sitemap URLs are indexable and present on disk.`);
