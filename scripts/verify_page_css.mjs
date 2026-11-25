#!/usr/bin/env node
/**
 * Every built page carries its own CSS (QA build.page-css, 2026-11-25): an Astro build can finish green with no component CSS on any
 * page. It happened when a JS comment stood inside a template expression in components/CookieBanner.astro (`{optIn ? ( /* ... *\/ <p>`):
 * every page of the Glasgow build lost its <style> and /_astro/*.css links and rendered as bare HTML. Fixture:
 * tests/fixtures/qa_page_css_2026-11-25 (the real Glasgow /today/ of the fixed build, and the same page with only those tags removed).
 *
 * A page passes with at least one <style> or one /_astro/*.css stylesheet link. Redirect stubs (<meta http-equiv="refresh">) and files
 * without an <html> element (google<id>.html verification files) are skipped.
 * Usage: node scripts/verify_page_css.mjs <dist-dir>
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const dist = process.argv[2];
if (!dist) { console.error('Usage: node scripts/verify_page_css.mjs <dist-dir>'); process.exit(2); }

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
  const html = readFileSync(file, 'utf8');
  // not a page: redirect stubs, and verification files such as google<id>.html (no <html> element)
  if (/<meta\s+http-equiv="refresh"/i.test(html) || !/<html[\s>]/i.test(html)) continue;
  pages++;
  if (!/<style[\s>]/i.test(html) && !/href="\/_astro\/[^"]+\.css"/.test(html)) {
    bad.push('/' + relative(dist, file).split(sep).join('/').replace(/index\.html$/, ''));
  }
}
if (bad.length) {
  console.error(`FAIL: ${bad.length} of ${pages} pages have no component CSS (no <style>, no /_astro/*.css):\n${bad.slice(0, 20).join('\n')}`);
  process.exit(1);
}
console.log(`OK: all ${pages} pages carry their CSS.`);
