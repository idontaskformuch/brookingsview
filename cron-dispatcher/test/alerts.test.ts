import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contentHash } from '../src/alerts/hash';
import { newestPerWarning, parseFeed, pointInGeometry, toRecord, fetchMetOffice } from '../src/alerts/metoffice';
import { fetchNws, parseNws } from '../src/alerts/nws';
import { refreshAlerts } from '../src/alerts/refresh';
import { storeNws } from '../src/alerts/store';
import { ALERT_TOWNS } from '../src/alerts/towns';

const cfg = (town: string) => JSON.parse(readFileSync(new URL(`../../configs/${town}.json`, import.meta.url), 'utf8'));

describe('towns mirror the configs', () => {
  for (const t of ALERT_TOWNS) {
    it(t.townId, () => {
      const c = cfg(t.townId);
      if (t.kind === 'nws') expect(t.zones).toEqual(String(c.data_sources.weather_alerts.area).split(',').map((z: string) => z.trim()));
      else expect([t.lat, t.lon]).toEqual([c.coordinates.lat, c.coordinates.lon]);
    });
  }
});

describe('contentHash is the Python db.content_hash', () => {
  it('sha256 of the parts joined with |', async () => {
    expect(await contentHash('nws', 'urn:oid:1')).toBe(createHash('sha256').update('nws|urn:oid:1').digest('hex'));
    expect(await contentHash('a', null, 'b')).toBe(createHash('sha256').update('a||b').digest('hex'));
  });
});

const NWS_BODY = {
  features: [
    { properties: { id: 'urn:oid:A', '@id': 'https://api.weather.gov/alerts/urn:oid:A', event: 'Winter Weather Advisory', onset: '2026-10-28T12:00:00-05:00',
      ends: '2026-10-29T00:00:00-05:00', areaDesc: 'Brookings', severity: 'Minor', headline: 'h', description: 'd', instruction: 'i' } },
    { properties: { event: 'no id is skipped' } },
  ],
};

describe('NWS', () => {
  it('parses like nws_alerts.py: onset/ends, source, hash of "nws|id"', async () => {
    const [r] = await parseNws(NWS_BODY);
    expect(r).toMatchObject({ title: 'Winter Weather Advisory', starts_at: '2026-10-28T12:00:00-05:00', ends_at: '2026-10-29T00:00:00-05:00', source: 'nws_alert' });
    expect(r.content_hash).toBe(createHash('sha256').update('nws|urn:oid:A').digest('hex'));
    expect((await parseNws(NWS_BODY)).length).toBe(1);
  });
  it('asks for all zones in one request and refuses a non-200', async () => {
    let url = '';
    const ok = async (u: any) => { url = String(u); return new Response(JSON.stringify(NWS_BODY), { status: 200 }); };
    await fetchNws(['COZ039', 'COZ040'], ok as typeof fetch);
    expect(url).toBe('https://api.weather.gov/alerts/active?zone=COZ039%2CCOZ040');
    await expect(fetchNws(['X'], (async () => new Response('', { status: 503 })) as typeof fetch)).rejects.toThrow('HTTP 503');
  });
});

describe('Met Office', () => {
  const square = { type: 'Polygon', coordinates: [[[-5, 55], [-3, 55], [-3, 57], [-5, 57], [-5, 55]]] };
  it('point in polygon, holes respected', () => {
    expect(pointInGeometry(-4.25, 55.86, square)).toBe(true);
    expect(pointInGeometry(-1, 55.86, square)).toBe(false);
    const holed = { type: 'Polygon', coordinates: [square.coordinates[0], [[-4.5, 55.5], [-4, 55.5], [-4, 56.2], [-4.5, 56.2], [-4.5, 55.5]]] };
    expect(pointInGeometry(-4.25, 55.86, holed)).toBe(false);
    expect(pointInGeometry(-4.25, 55.86, null)).toBe(false);
  });
  const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><link rel="self" href="s"/><link rel="related" href="https://x/issued/1/"/>
    <entry><updated>2026-10-28T10:00:00Z</updated><link rel="alternate" href="https://x/updated/b/"/></entry>
    <entry><updated>2026-10-28T09:00:00Z</updated><link rel="alternate" href="https://x/updated/a/"/></entry></feed>`;
  it('reads the related link and the entries oldest first', () => {
    expect(parseFeed(ATOM)).toEqual({ related: 'https://x/issued/1/', entries: [
      { updated: '2026-10-28T09:00:00Z', href: 'https://x/updated/a/' }, { updated: '2026-10-28T10:00:00Z', href: 'https://x/updated/b/' }] });
  });
  it('keeps the newest version per warning and turns it into a record', async () => {
    const f = (v: string, mod: string, status: string) => ({ properties: { warningId: 'W1', warningVersion: v, modifiedDate: mod, warningStatus: status,
      warningLevel: 'YELLOW', warningHeadline: 'Wind', weatherType: "['Wind']", whatToExpect: "['Some delays']", validFromDate: 'a', validToDate: 'b', affectedAreas: [{ regionName: 'Strathclyde' }] } });
    const best = newestPerWarning([f('1.0', '2026-10-28T09:00:00Z', 'ISSUED'), f('2.0', '2026-10-28T11:00:00Z', 'CANCELLED')]);
    const rec = await toRecord(best.get('W1')!);
    expect(rec.raw_data).toMatchObject({ warning_id: 'W1', status: 'CANCELLED', level: 'yellow', weather_types: ['Wind'], what_to_expect: ['Some delays'], regions: ['Strathclyde'] });
    expect(rec.content_hash).toBe(createHash('sha256').update('met_office_warning|W1').digest('hex'));
  });
  it('stores only the warnings whose polygon contains the point', async () => {
    const feat = (id: string, geometry: any) => ({ geometry, properties: { warningId: id, warningVersion: '1', modifiedDate: 'm', warningStatus: 'ISSUED', warningLevel: 'AMBER', validFromDate: 'a', validToDate: 'b' } });
    const fetcher = (async (u: any) => {
      const url = String(u);
      if (url.endsWith('/feed')) return new Response(`<feed xmlns="http://www.w3.org/2005/Atom"><link rel="related" href="https://x/issued/1/"/></feed>`);
      return new Response(JSON.stringify({ features: [feat('IN', square), feat('OUT', { type: 'Polygon', coordinates: [[[10, 10], [11, 10], [11, 11], [10, 11], [10, 10]]] })] }));
    }) as typeof fetch;
    const recs = await fetchMetOffice(55.86, -4.25, 'key', fetcher);
    expect(recs.map((r) => r.raw_data.warning_id)).toEqual(['IN']);
  });
});

/** A fake neon: records every query, answers from a script. */
function fakeSql(answer: (text: string) => any[] = () => []) {
  const calls: { text: string; values: any[] }[] = [];
  const sql = (async (strings: TemplateStringsArray, ...values: any[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    calls.push({ text, values });
    return answer(text);
  }) as any;
  return { sql, calls };
}

describe('storeNws', () => {
  it('upserts each alert, then ends the ones NWS no longer lists', async () => {
    const records = await parseNws(NWS_BODY);
    const { sql, calls } = fakeSql((t) => (t.startsWith('INSERT') ? [{ id: 1 }] : t.startsWith('UPDATE') ? [{ id: 9 }, { id: 10 }] : []));
    const res = await storeNws(sql, 'brookings_sd', records);
    expect(res).toEqual({ written: 1, ended: 2 });
    expect(calls[0].text).toContain('ON CONFLICT (town_id, content_hash) DO UPDATE');
    expect(calls[1].text).toContain("UPDATE events SET ends_at = now()");
    expect(calls[1].values[1]).toEqual([records[0].content_hash]);
  });
});

describe('refreshAlerts', () => {
  const towns = [{ townId: 'brookings_sd', kind: 'nws' as const, zones: ['SDZ040'] }, { townId: 'glasgow', kind: 'metoffice' as const, lat: 55.86, lon: -4.25 }];
  it('a failing town does not stop the next and writes nothing for itself', async () => {
    const { sql, calls } = fakeSql();
    const fetcher = (async () => new Response('', { status: 500 })) as typeof fetch;
    const res = await refreshAlerts({ DATABASE_URL: 'x', MET_OFFICE_WARNINGS_API_KEY: 'k' }, { sql, fetcher, towns });
    expect(res.map((r) => [r.townId, r.ok])).toEqual([['brookings_sd', false], ['glasgow', false]]);
    expect(calls).toEqual([]);
  });
  it('Glasgow without the Met Office key fails loudly instead of silently', async () => {
    const { sql } = fakeSql();
    const res = await refreshAlerts({ DATABASE_URL: 'x' }, { sql, fetcher: (async () => new Response('{}')) as typeof fetch, towns: [towns[1]] });
    expect(res[0]).toMatchObject({ ok: false });
    expect(res[0].error).toContain('MET_OFFICE_WARNINGS_API_KEY');
  });
  it('an empty NWS answer ends the stored active alerts (all of them were cancelled)', async () => {
    const { sql, calls } = fakeSql((t) => (t.startsWith('UPDATE') ? [{ id: 1 }] : []));
    const fetcher = (async () => new Response(JSON.stringify({ features: [] }), { status: 200 })) as typeof fetch;
    const res = await refreshAlerts({ DATABASE_URL: 'x' }, { sql, fetcher, towns: [towns[0]] });
    expect(res[0]).toEqual({ townId: 'brookings_sd', ok: true, written: 0, ended: 1 });
    expect(calls[0].values[1]).toEqual([]);
  });
});
