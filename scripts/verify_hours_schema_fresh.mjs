#!/usr/bin/env node
/**
 * QA build.hours-schema-fresh (found 2026-11-12): a facility page puts its opening hours in JSON-LD only while its hours were
 * checked within HOURS_STALE_DAYS (lib/place-hours.ts isPastStalenessThreshold, SiteConfig.placeStaleness.hoursDays). The
 * check read places.verified_date as a string while the Neon driver hands over a Date, so stale hours went into the schema
 * on every town. Fails when a page carries openingHoursSpecification and its Source fact has no <time datetime> or a date
 * older than the limit (plus one day, so a page built just before midnight is not failed minutes later).
 *
 * Usage: node scripts/verify_hours_schema_fresh.mjs <dist-dir>   (QA_NOW=<ISO instant> overrides "now" in tests)
 */
import fs from 'node:fs';
import path from 'node:path';

/** Every town uses 45 days (site-config.ts placeStaleness, default 45); place-hours.test.ts fails if that changes. */
export const HOURS_STALE_DAYS = 45;

const distDir = process.argv[2];
if (!distDir) {
  console.error('Usage: node scripts/verify_hours_schema_fresh.mjs <dist-dir>');
  process.exit(2);
}
const now = process.env.QA_NOW ? new Date(process.env.QA_NOW) : new Date();
const dir = path.join(distDir, 'facilities');
const problems = [];
let withSchema = 0;
if (fs.existsSync(dir)) {
  for (const slug of fs.readdirSync(dir)) {
    const file = path.join(dir, slug, 'index.html');
    if (!fs.existsSync(file)) continue;
    const html = fs.readFileSync(file, 'utf8');
    if (!html.includes('"openingHoursSpecification"')) continue;
    withSchema++;
    const m = html.match(/checked <time datetime="(\d{4}-\d{2}-\d{2})"/);
    if (!m) { problems.push(`facilities/${slug}: hours in JSON-LD but no checked <time datetime> on the page`); continue; }
    const ageDays = (now.getTime() - Date.parse(`${m[1]}T00:00:00Z`)) / 86_400_000;
    if (ageDays > HOURS_STALE_DAYS + 1) problems.push(`facilities/${slug}: hours in JSON-LD but checked ${m[1]} (${Math.floor(ageDays)} days, limit ${HOURS_STALE_DAYS})`);
  }
}
for (const p of problems) console.error(`[hours-schema] ${p}`);
console.log(`[hours-schema] ${withSchema} page(s) with hours in JSON-LD: ${problems.length ? 'FAIL' : 'ok'}`);
process.exit(problems.length ? 1 : 0);
