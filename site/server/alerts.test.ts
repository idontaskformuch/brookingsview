import { describe, expect, it } from 'vitest';
import { handleAlerts, toPublicAlerts, type AlertDbRow } from './alerts';
import type { Env } from './_shared';

const env = { DATABASE_URL: 'postgres://unused' } as Env;
const now = () => new Date('2026-10-28T18:00:00Z');
const row = (id: number, over: Partial<AlertDbRow> = {}): AlertDbRow => ({
  id, title: 'Winter Weather Advisory', starts_at: '2026-10-28T12:00:00Z', ends_at: '2026-10-29T06:00:00Z', source: 'nws_alert',
  url: 'https://api.weather.gov/alerts/x', created_at: '2026-10-28T11:50:00Z',
  raw_data: { headline: 'Winter Weather Advisory issued', description: 'Snow   likely.\nBlowing snow.', instruction: 'Slow down.', severity: 'Minor' }, ...over,
});

describe('toPublicAlerts', () => {
  it('keeps what is in force, with the official text squeezed to one line', () => {
    const [a] = toPublicAlerts([row(1)], now(), 'America/Chicago');
    expect(a).toMatchObject({ id: 1, source: 'nws_alert', event: 'Winter Weather Advisory', description: 'Snow likely. Blowing snow.', instruction: 'Slow down.', severity: 'Minor' });
    expect(a.endsAt).toBe('2026-10-29T06:00:00.000Z');
    expect(a.firstSeen).toBe('2026-10-28T11:50:00.000Z');
  });
  it('drops an alert that ended (a cancelled one is ended now by the cron)', () => {
    expect(toPublicAlerts([row(2, { ends_at: '2026-10-28T17:59:00Z' })], now(), 'America/Chicago')).toEqual([]);
  });
  it('drops CivicPlus re-posts of NWS weather products, like every other alert surface', () => {
    expect(toPublicAlerts([row(3, { source: 'county_alert', ends_at: null, raw_data: { category: 'Hazardous Weather Alerts' } })], now(), 'America/Chicago')).toEqual([]);
  });
});

describe('handleAlerts', () => {
  const req = (host: string) => new Request(`https://${host}/api/alerts`);
  it('answers for a US town from the database rows', async () => {
    const res = await handleAlerts(req('brookingsview.com'), env, { now, loadRows: async () => [row(1)] });
    const body = await res.json() as { town: string; alerts: { id: number }[] };
    expect(res.headers.get('cache-control')).toContain('max-age=60');
    expect(body.town).toBe('brookings_sd');
    expect(body.alerts.map((a) => a.id)).toEqual([1]);
  });
  it('Glasgow has its own endpoint: empty list and no database read here', async () => {
    const res = await handleAlerts(req('glasgowloop.co.uk'), env, { now, loadRows: async () => { throw new Error('must not read'); } });
    expect(await res.json()).toEqual({ town: 'glasgow', alerts: [] });
  });
  it('unknown host is a 404', async () => {
    expect((await handleAlerts(req('example.org'), env, { now })).status).toBe(404);
  });
});
