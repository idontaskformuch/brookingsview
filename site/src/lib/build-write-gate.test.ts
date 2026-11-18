// Fas 0.5 (owner 2026-11-18): the site build writes to the live database only when IMAGE_HISTORY_WRITE=1, which only
// the production CI build steps set. Born from the Fas 0 finding that a local build / astro dev / review-shots of a
// page with SectionHero (/today, /tonight, /this-weekend) in a week with no this_week_image_usage row INSERTed into
// the live table. QA: qa/checks.json "build.no-db-write-without-flag".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const queries: string[] = [];
vi.mock('@neondatabase/serverless', () => ({
  neon: () => Object.assign(
    async (strings: TemplateStringsArray) => { queries.push(strings.join('?')); return []; },
    { query: async (text: string) => { queries.push(text); return []; } },
  ),
}));

const WRITE_SQL = /\b(INSERT\s+INTO|UPDATE\s+[a-z_]+\s+SET|DELETE\s+FROM|TRUNCATE|ALTER\s+TABLE|CREATE\s+TABLE|DROP\s+TABLE)\b/;
const writes = () => queries.filter((q) => WRITE_SQL.test(q));

async function loadFor(town: string) {
  vi.resetModules();
  vi.stubEnv('SITE_CITY', town);
  const db = await import('./db');
  const { weekInfoForInstant } = await import('./this-week');
  const { seasonForMonth } = await import('./this-week-images');
  const { thisWeekImagesFor } = await import('../config/this-week-images');
  const { siteConfig } = await import('./site-config');
  return { db, weekInfoForInstant, seasonForMonth, thisWeekImagesFor, tz: siteConfig.timezone };
}

async function resolveAt(town: string, iso: string) {
  const { db, weekInfoForInstant, seasonForMonth, thisWeekImagesFor, tz } = await loadFor(town);
  const week = weekInfoForInstant(new Date(iso), tz);
  return db.resolveThisWeekImage(week.slug, seasonForMonth(week.monday.m), thisWeekImagesFor(town), week.monday, week.sunday);
}

describe('build writes to the live DB only with IMAGE_HISTORY_WRITE=1', () => {
  beforeEach(() => { queries.length = 0; });
  afterEach(() => { vi.unstubAllEnvs(); });

  // Season week (broomfield_co, 2026-w49, no recorded row) and holiday week (Thanksgiving window, 2026-w48).
  for (const [label, town, iso] of [
    ['season week', 'broomfield_co', '2026-12-02T18:00:00Z'],
    ['holiday week', 'brookings_sd', '2026-11-24T18:00:00Z'],
    ['glasgow season week', 'glasgow', '2026-12-09T12:00:00Z'],
  ] as const) {
    it(`${label}: no flag -> same pick, zero writes`, async () => {
      vi.stubEnv('IMAGE_HISTORY_WRITE', '');
      const pick = await resolveAt(town, iso);
      expect(pick.id).toMatch(new RegExp(`^${town}-`));
      expect(queries.length).toBeGreaterThan(0);
      expect(writes()).toEqual([]);
    });

    it(`${label}: IMAGE_HISTORY_WRITE=1 -> exactly one INSERT, same pick`, async () => {
      vi.stubEnv('IMAGE_HISTORY_WRITE', '');
      const readOnly = await resolveAt(town, iso);
      queries.length = 0;
      vi.stubEnv('IMAGE_HISTORY_WRITE', '1');
      const written = await resolveAt(town, iso);
      expect(written.id).toBe(readOnly.id);
      expect(writes()).toHaveLength(1);
      expect(writes()[0]).toMatch(/INSERT INTO this_week_image_usage/);
    });
  }

  it('any value other than "1" does not write', async () => {
    for (const v of ['true', 'yes', '0', ' 1']) {
      queries.length = 0;
      vi.stubEnv('IMAGE_HISTORY_WRITE', v);
      await resolveAt('broomfield_co', '2026-12-02T18:00:00Z');
      expect(writes(), v).toEqual([]);
    }
  });
});

describe('no other write SQL in the site source', () => {
  it('the only write statement is recordThisWeekImageUse in lib/db.ts', () => {
    const root = join(__dirname, '..');
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!/\.(ts|mts|mjs|js|astro)$/.test(name) || /\.test\./.test(name)) continue;
        readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
          if (WRITE_SQL.test(line)) hits.push(`${relative(root, p).replace(/\\/g, '/')}:${i + 1}`);
        });
      }
    };
    walk(root);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatch(/^lib\/db\.ts:/);
    const dbLines = readFileSync(join(root, 'lib', 'db.ts'), 'utf8').split('\n');
    const at = Number(hits[0].split(':')[1]) - 1;
    const fnStart = dbLines.slice(0, at).map((l, i) => [l, i] as const).reverse().find(([l]) => /^(export )?(async )?function /.test(l));
    expect(fnStart?.[0]).toMatch(/async function recordThisWeekImageUse\(/);
    expect(dbLines.slice(fnStart![1], at).join('\n')).toMatch(/if \(!historyWriteEnabled\(\)\) return;/);
  });
});
