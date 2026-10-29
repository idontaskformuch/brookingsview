import { describe, expect, it } from 'vitest';
import { handleSafety, toPublicSafety, type NoticeRow } from './safety';
import { hasCrimeWord } from '../src/lib/safety-filter';
import type { Env } from './_shared';

const env = { DATABASE_URL: 'postgres://unused' } as Env;
const req = (host: string) => new Request(`https://${host}/api/safety`);
const NOW = new Date('2026-10-29T20:00:00Z');
const fireRow = (title: string, over: Partial<NoticeRow> = {}, raw: Record<string, unknown> = {}): NoticeRow => ({
  kind: 'fire', title, url: 'https://data-nifc.opendata.arcgis.com/x', observed_at: '2026-10-29T18:00:00Z', last_seen: '2026-10-29T19:50:00Z',
  raw_data: { acres: 120, percentContained: 15, county: 'Riverside', distanceMiles: 9.4, ...raw }, ...over,
});
const airRow = (over: Partial<NoticeRow> = {}, raw: Record<string, unknown> = {}): NoticeRow => ({
  kind: 'air', title: 'Air quality: Riverside', url: 'https://www.airnow.gov/', observed_at: '2026-10-29T18:00:00Z', last_seen: '2026-10-29T19:50:00Z',
  raw_data: { aqi: 88, category: 'Moderate', parameter: 'O3', reportingArea: 'Riverside', observedLocal: '2026-10-29 11:00 PDT', ...raw }, ...over,
});

describe('toPublicSafety', () => {
  it('nearest fire first, official fields only, NIFC credited', () => {
    const { fires } = toPublicSafety([fireRow('Far Fire', {}, { distanceMiles: 20 }), fireRow('Near Fire')], NOW);
    expect(fires.map((f) => f.name)).toEqual(['Near Fire', 'Far Fire']);
    expect(fires[0]).toMatchObject({ acres: 120, percentContained: 15, county: 'Riverside', sourceName: 'NIFC' });
  });
  it('fails closed: unconfirmed for 60 min or stale air is not shown', () => {
    const { fires, air } = toPublicSafety([fireRow('Old Poll', { last_seen: '2026-10-29T18:30:00Z' }), airRow({ observed_at: '2026-10-29T15:00:00Z' })], NOW);
    expect(fires).toEqual([]);
    expect(air).toBeNull();
  });
  it('air carries the number, EPA category, time, preliminary flag and airnow.gov', () => {
    expect(toPublicSafety([airRow()], NOW).air).toMatchObject({ aqi: 88, category: 'Moderate', preliminary: true, sourceUrl: 'https://www.airnow.gov/', observedLocal: '2026-10-29 11:00 PDT' });
  });
  it('holds back a notice with a crime word and counts it', () => {
    const r = toPublicSafety([fireRow('Missing Link Fire'), fireRow('Sage Fire')], NOW);
    expect(r.fires.map((f) => f.name)).toEqual(['Sage Fire']);
    expect(r.held).toBe(1);
  });
});

describe('hasCrimeWord', () => {
  it('matches whole words only', () => {
    expect(hasCrimeWord('Arrested man')).toBe(true);
    expect(hasCrimeWord('Courtland Fire')).toBe(false);
    expect(hasCrimeWord('Sage Fire')).toBe(false);
  });
});

describe('GET /api/safety', () => {
  it('Moreno: fires, air, and the Genasys evacuation link with the lag note', async () => {
    const j = await (await handleSafety(req('morenovalleyview.com'), env, { now: () => NOW, loadRows: async () => [fireRow('Sage Fire'), airRow()] })).json() as any;
    expect(j).toMatchObject({ town: 'moreno_valley_ca', available: true, held: 0 });
    expect(j.evacuation.links[0].url).toContain('protect.genasys.com');
    expect(j.evacuation.note).toContain('lag');
  });
  it('Broomfield: links to EmergencyStatus and LookoutAlert, never fetches broomfield.org', async () => {
    const j = await (await handleSafety(req('broomfieldview.com'), env, { now: () => NOW, loadRows: async () => [] })).json() as any;
    expect(j.evacuation.links.map((l: any) => l.url)).toEqual(['https://www.broomfield.org/EmergencyStatus', 'https://www.broomfield.org/LookoutAlert']);
  });
  it('Brookings and Glasgow: no block and no database read', async () => {
    for (const host of ['brookingsview.com', 'glasgowloop.co.uk']) {
      const j = await (await handleSafety(req(host), env, { loadRows: async () => { throw new Error('must not be called'); } })).json() as any;
      expect(j).toMatchObject({ available: false, fires: [], air: null });
    }
  });
  it('a database error (missing table) gives available:false and no fires', async () => {
    const j = await (await handleSafety(req('morenovalleyview.com'), env, { now: () => NOW, loadRows: async () => { throw new Error('relation does not exist'); } })).json() as any;
    expect(j).toMatchObject({ available: false, fires: [], air: null });
  });
  it('404s for an unknown host', async () => {
    expect((await handleSafety(req('example.org'), env)).status).toBe(404);
  });
});
