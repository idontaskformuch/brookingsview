#!/usr/bin/env node
// Review fixtures: what GET /api/weather will answer once the cron-dispatcher Worker has written payloads with the Phase 2 fields.
//   node scripts/make-weather-fullpayload-fixtures.mjs <out-dir>
// Reads each town's stored forecast (read-only SELECT), rebases the hourly points to the current hour, and ADDS the new optional fields with
// plausible SYNTHETIC values (pop, feels, gust, uv, precip_mm, fetched_at). Used only for screenshots (scripts/review-shots.mjs --api-fixture);
// nothing is written anywhere but the output directory.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(resolve(root, 'site/package.json'));
const { neon } = req('@neondatabase/serverless');
const env = Object.fromEntries(readFileSync(resolve(root, 'site/.env'), 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')]));
const sql = neon(process.env.DATABASE_URL || env.DATABASE_URL);
const out = resolve(process.argv[2] || '.');
mkdirSync(out, { recursive: true });

const now = Date.now();
const hourFloor = Math.floor(now / 3_600_000) * 3_600_000;
const POP_HOURLY = [5, 5, 10, 10, 20, 35, 55, 80, 90, 85, 60, 30, 15, 10, 10, 5, 5, 10, 10, 15, 20, 10, 5, 5];
const POP_PERIOD = [10, 60, 85, 30, 0, 15, 70, 40, 20, 5, 10, 25, 55, 35];

for (const town of ['broomfield_co', 'brookings_sd', 'moreno_valley_ca', 'glasgow']) {
  const rows = await sql`SELECT payload FROM weather_snapshots WHERE town_id = ${town} ORDER BY observed_for DESC LIMIT 1`;
  const p = rows[0]?.payload;
  if (!p) { console.log(`${town}: no stored forecast, skipped`); continue; }
  const celsius = (p.hourly?.[0]?.unit ?? p.periods?.[0]?.unit) === 'C';
  const hourly = (p.hourly ?? []).map((h, i) => ({
    ...h, start: new Date(hourFloor + i * 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    pop: POP_HOURLY[i % 24], feels: Math.round((h.temp ?? 0) - (celsius ? 3 : 5)), gust: 14 + (i % 6) * 4, uv: h.is_daytime ? 2 : 0,
    ...(celsius ? { precip_mm: POP_HOURLY[i % 24] >= 50 ? 0.4 : 0 } : {}),
  }));
  const periods = (p.periods ?? []).map((q, i) => ({
    ...q, pop: POP_PERIOD[i % 14], gust: 18 + (i % 5) * 5, ...(q.is_daytime ? { uv: celsius ? 1 : 4 } : {}), feels: Math.round((q.temp ?? 0) - (celsius ? 2 : 4)),
  }));
  const body = { town, periods, hourly, issued: p.issued ?? null, source: p.source ?? 'National Weather Service', fetched_at: new Date(now - 7 * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z') };
  writeFileSync(resolve(out, `${town}.json`), JSON.stringify(body, null, 1));
  console.log(`${town}: ${periods.length} periods, ${hourly.length} hours`);
}
