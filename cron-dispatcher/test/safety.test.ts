import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseAirNow } from '../src/safety/airnow';
import { refreshSafety } from '../src/safety/refresh';
import { storeNotices } from '../src/safety/store';
import { SAFETY_TOWNS } from '../src/safety/towns';
import { fetchFires, parseWfigs } from '../src/safety/wfigs';

const NOW = new Date('2026-10-29T20:00:00Z');
const moreno = SAFETY_TOWNS[0];
const cfg = (town: string) => JSON.parse(readFileSync(new URL(`../../configs/${town}.json`, import.meta.url), 'utf8'));

describe('safety towns mirror the configs', () => {
  for (const t of SAFETY_TOWNS) {
    it(t.townId, () => {
      expect([t.lat, t.lon]).toEqual([cfg(t.townId).coordinates.lat, cfg(t.townId).coordinates.lon]);
      expect(t.radiusMiles).toBe(25); // owner 2026-10-29
    });
  }
});

const fire = (over: Record<string, unknown> = {}, geo = { x: -117.1, y: 33.9 }) => ({
  attributes: { IncidentName: ' Sage  Fire ', IncidentTypeCategory: 'WF', IncidentSize: 120, PercentContained: 15, POOState: 'US-CA', POOCounty: 'Riverside',
    FireDiscoveryDateTime: NOW.getTime() - 86_400_000, ModifiedOnDateTime_dt: NOW.getTime() - 3_600_000, FireOutDateTime: null, IrwinID: '{ABC-1}', ...over },
  geometry: geo,
});

describe('parseWfigs', () => {
  it('keeps official fields only, cleans the id, computes the distance', () => {
    const [f] = parseWfigs({ features: [fire()] }, moreno, NOW);
    expect(f).toMatchObject({ externalId: 'abc-1', title: 'Sage Fire', raw: { acres: 120, percentContained: 15, county: 'Riverside', source: 'NIFC WFIGS' } });
    expect(f.raw.distanceMiles).toBeGreaterThan(5);
    expect(f.raw.distanceMiles).toBeLessThan(15);
  });
  it('drops prescribed burns, fires marked out, stale updates, far fires and rows without id or place', () => {
    const body = { features: [
      fire({ IncidentTypeCategory: 'RX' }), fire({ FireOutDateTime: NOW.getTime() - 1000 }),
      fire({ ModifiedOnDateTime_dt: NOW.getTime() - 4 * 86_400_000 }), fire({}, { x: -118.5, y: 34.5 }),
      fire({ IrwinID: null }), { attributes: fire().attributes },
    ] };
    expect(parseWfigs(body, moreno, NOW)).toEqual([]);
  });
  it('fails closed on a malformed body', () => {
    expect(() => parseWfigs({ nope: 1 }, moreno, NOW)).toThrow('no features');
  });
  it('fetchFires refuses a non-200 and an ArcGIS error body', async () => {
    await expect(fetchFires(moreno, NOW, (async () => new Response('', { status: 503 })) as typeof fetch)).rejects.toThrow('HTTP 503');
    await expect(fetchFires(moreno, NOW, (async () => new Response(JSON.stringify({ error: { code: 400 } }), { status: 200 })) as typeof fetch)).rejects.toThrow('WFIGS');
  });
  it('asks only for wildfires inside the radius', async () => {
    let url = '';
    await fetchFires(moreno, NOW, (async (u: any) => { url = decodeURIComponent(String(u)); return new Response(JSON.stringify({ features: [] }), { status: 200 }); }) as typeof fetch);
    expect(url).toContain("IncidentTypeCategory='WF'");
    expect(url).toContain('distance=25');
  });
});

const air = (aqi: number, name: string, hour = 11) => ({ DateObserved: '2026-10-29', HourObserved: hour, LocalTimeZone: 'PDT', ReportingArea: 'Riverside', ParameterName: name, AQI: aqi, Category: { Number: aqi > 100 ? 3 : 2, Name: aqi > 100 ? 'Unhealthy for Sensitive Groups' : 'Moderate' } });

describe('parseAirNow', () => {
  it('uses the highest parameter and dates the reading in UTC', () => {
    const n = parseAirNow([air(62, 'PM2.5'), air(88, 'O3')], NOW)!;
    expect(n.raw).toMatchObject({ aqi: 88, parameter: 'O3', category: 'Moderate', source: 'AirNow' });
    expect(n.observedAt).toBe('2026-10-29T18:00:00.000Z');
  });
  it('shows nothing for old, undatable or empty readings', () => {
    expect(parseAirNow([air(50, 'O3', 3)], NOW)).toBeNull();
    expect(parseAirNow([{ ...air(50, 'O3'), LocalTimeZone: 'XYZ' }], NOW)).toBeNull();
    expect(parseAirNow([], NOW)).toBeNull();
    expect(() => parseAirNow({}, NOW)).toThrow();
  });
});

describe('refreshSafety', () => {
  const ok = (async () => new Response(JSON.stringify({ features: [fire()] }), { status: 200 })) as typeof fetch;
  const fakeSql = () => { const calls: string[] = []; const sql: any = async (s: TemplateStringsArray) => { calls.push(s.join('?')); return []; }; return { sql, calls }; };
  it('runs fires without a key and reports air as skipped', async () => {
    const { sql } = fakeSql();
    const r = await refreshSafety({}, { sql, now: NOW, fetcher: ok, towns: [moreno] });
    expect(r).toMatchObject([{ part: 'fire', ok: true, written: 1 }, { part: 'air', ok: true, skipped: 'AIRNOW_API_KEY not set' }]);
  });
  it('a failed fetch writes and ends nothing; the key never reaches the error text', async () => {
    const { sql, calls } = fakeSql();
    const r = await refreshSafety({ AIRNOW_API_KEY: 'SECRETKEY' }, { sql, now: NOW, fetcher: (async (u: any) => { throw new Error(String(u).includes('airnow') ? `down ${u}` : 'down'); }) as typeof fetch, towns: [moreno] });
    expect(r.every((x) => !x.ok)).toBe(true);
    expect(JSON.stringify(r)).not.toContain('SECRETKEY');
    expect(calls).toEqual([]);
  });
  it('storeNotices ends rows the source no longer lists', async () => {
    const { sql, calls } = fakeSql();
    await storeNotices(sql, 'moreno_valley_ca', 'fire', []);
    expect(calls.join('\n')).toContain('SET ended_at = now()');
  });
});
