import { describe, expect, it } from 'vitest';
import { handleWeather, toPublicWeather } from './weather';
import type { Env } from './_shared';

const env = { DATABASE_URL: 'postgres://unused' } as Env;
const req = (host: string) => new Request(`https://${host}/api/weather`);
const period = (i: number) => ({ name: `P${i}`, start: `2026-10-28T${String(i).padStart(2, '0')}:00:00Z`, temp: 40 + i, unit: 'F', short: 'Cloudy', wind: '5 mph', is_daytime: i % 2 === 0 });

describe('toPublicWeather', () => {
  it('passes periods and hours through, capped, with the source', () => {
    const w = toPublicWeather('glasgow', { payload: { periods: Array.from({ length: 20 }, (_, i) => period(i)), hourly: Array.from({ length: 30 }, (_, i) => period(i)), issued: '2026-10-28T05:00Z', source: 'Met Office' } });
    expect(w.periods).toHaveLength(14);
    expect(w.hourly).toHaveLength(24);
    expect(w).toMatchObject({ town: 'glasgow', issued: '2026-10-28T05:00Z', source: 'Met Office' });
  });
  it('an NWS snapshot (no source/issued) is labelled National Weather Service and dated by when it was stored', () => {
    const w = toPublicWeather('brookings_sd', { payload: { periods: [period(1)], hourly: [] }, created_at: '2026-10-28T11:00:00Z' });
    expect(w).toMatchObject({ source: 'National Weather Service', issued: '2026-10-28T11:00:00.000Z' });
  });
  it('no snapshot is an honest empty answer, never invented', () => {
    expect(toPublicWeather('brookings_sd', null)).toEqual({ town: 'brookings_sd', periods: [], hourly: [], issued: null, source: null });
  });
});

describe('handleWeather', () => {
  it('answers for the town of the hostname, cacheable for 5 minutes', async () => {
    const res = await handleWeather(req('brookingsview.com'), env, { loadSnapshot: async () => ({ payload: { periods: [period(2)], hourly: [] }, created_at: '2026-10-28T11:00:00Z' }) as any });
    expect(res.headers.get('cache-control')).toContain('max-age=300');
    expect((await res.json() as any).town).toBe('brookings_sd');
  });
  it('unknown host is a 404', async () => {
    expect((await handleWeather(req('example.org'), env)).status).toBe(404);
  });
});
