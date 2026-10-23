import { describe, expect, it } from 'vitest';
import { handleWeatherWarnings, toPublicWarnings, type WarningRow } from './weather-warnings';
import type { Env } from './_shared';

const env = { DATABASE_URL: 'postgres://unused' } as Env;
const req = (host: string, qs = '') => new Request(`https://${host}/api/weather-warnings${qs}`);
const row = (id: string, status: string, level: string, from: string, to: string): WarningRow => ({
  url: 'https://www.metoffice.gov.uk/weather/warnings-and-advice/uk-warnings', starts_at: from, ends_at: to,
  raw_data: { warning_id: id, status, level, weather_types: ['WIND'], headline: 'Storm Boelo', what_to_expect: ['Flying debris is likely'], what_should_i_do: 'Stay indoors' },
});
const now = () => new Date('2026-10-24T12:00:00Z');
const rows = [
  row('amber', 'ISSUED', 'amber', '2026-10-24T20:00:00Z', '2026-10-25T21:00:00Z'),
  row('yellow', 'ISSUED', 'yellow', '2026-10-24T11:00:00Z', '2026-10-25T21:00:00Z'),
  row('cancelled', 'CANCELLED', 'amber', '2026-10-24T11:00:00Z', '2026-10-25T21:00:00Z'),
  row('expired', 'EXPIRED', 'yellow', '2026-10-22T11:00:00Z', '2026-10-23T21:00:00Z'),
  row('past', 'ISSUED', 'yellow', '2026-10-22T11:00:00Z', '2026-10-23T21:00:00Z'),
  row('badlevel', 'ISSUED', 'purple', '2026-10-24T11:00:00Z', '2026-10-25T21:00:00Z'),
];

describe('toPublicWarnings', () => {
  it('keeps only ISSUED warnings with a known level that have not ended, amber first', () => {
    expect(toPublicWarnings(rows, now()).map((w) => w.id)).toEqual(['amber', 'yellow']);
  });
  it('carries what the banner needs and the Met Office attribution', () => {
    const w = toPublicWarnings(rows, now())[0];
    expect(w).toMatchObject({ level: 'amber', headline: 'Storm Boelo', whatToExpect: ['Flying debris is likely'], whatShouldIDo: 'Stay indoors', sourceName: 'Met Office' });
    expect(w.sourceUrl).toContain('metoffice.gov.uk');
    expect(w.validFrom).toBe('2026-10-24T20:00:00.000Z');
  });
});

describe('GET /api/weather-warnings', () => {
  it('serves Glasgow warnings from the hostname and ignores ?town=', async () => {
    const seen: string[] = [];
    const r = await handleWeatherWarnings(req('glasgowloop.co.uk', '?town=brookings_sd'), env, { now, loadRows: async (_u, t) => { seen.push(t); return rows; } });
    const j = await r.json() as { town: string; warnings: Array<{ id: string }> };
    expect(seen).toEqual(['glasgow']);
    expect(j.warnings.map((w) => w.id)).toEqual(['amber', 'yellow']);
    expect(r.headers.get('Cache-Control')).toBe('public, max-age=60');
  });
  it('never reads the database for a US town', async () => {
    const r = await handleWeatherWarnings(req('brookingsview.com'), env, { now, loadRows: async () => { throw new Error('must not be called'); } });
    expect(await r.json()).toEqual({ town: 'brookings_sd', warnings: [] });
  });
  it('404s for an unknown host', async () => {
    expect((await handleWeatherWarnings(req('example.org'), env, { now })).status).toBe(404);
  });
});
