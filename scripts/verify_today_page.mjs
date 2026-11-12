#!/usr/bin/env node
/**
 * QA build.today-page (Broomfield AdSense plan F3, owner 2026-11-12): for a town with SiteConfig.todayPage, /today/ is written into the
 * HTML. Fails when the page still says "Turn on JavaScript" or does not show the town's date (<time datetime="YYYY-MM-DD">).
 * TODAY_PAGE_TOWNS mirrors site-config.ts by hand; site/src/lib/today-page.test.ts fails if the two disagree.
 *
 * Usage: node scripts/verify_today_page.mjs <dist-dir> <town_id>
 */
import fs from 'node:fs';
import path from 'node:path';

export const TODAY_PAGE_TOWNS = ['broomfield_co'];

const [distDir, townId] = process.argv.slice(2);
if (!distDir || !townId) {
  console.error('Usage: node scripts/verify_today_page.mjs <dist-dir> <town_id>');
  process.exit(2);
}
if (!TODAY_PAGE_TOWNS.includes(townId)) {
  console.log(`[today-page] ${townId}: no todayPage config, skipped`);
  process.exit(0);
}
const file = path.join(distDir, 'today', 'index.html');
if (!fs.existsSync(file)) {
  console.error(`[today-page] ${townId}: ${file} missing`);
  process.exit(1);
}
const html = fs.readFileSync(file, 'utf8');
const problems = [];
if (/Turn on JavaScript/i.test(html)) problems.push('says "Turn on JavaScript"');
if (!/<time datetime="\d{4}-\d{2}-\d{2}"[^>]*>[^<]+<\/time>/.test(html)) problems.push("no visible date (<time datetime=\"YYYY-MM-DD\">)");
for (const p of problems) console.error(`[today-page] ${townId}: /today/ ${p}`);
console.log(`[today-page] ${townId}: ${problems.length ? 'FAIL' : 'ok'}`);
process.exit(problems.length ? 1 : 0);
