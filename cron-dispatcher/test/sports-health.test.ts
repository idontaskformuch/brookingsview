import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkSportHealth, SPORT_SOURCES, STALE_HOURS } from '../src/sports/health';

const cfg = (town: string) => JSON.parse(readFileSync(new URL(`../../configs/${town}.json`, import.meta.url), 'utf8'));
const NOW = new Date('2026-11-10T00:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();
const sqlWith = (rows: any[]) => (async () => rows) as any;
const one = [{ townId: 'brookings_sd', sourceId: 'internal:sdsu' }];

describe('SPORT_SOURCES mirrors the configs', () => {
  it('lists exactly the sources of every town with sports.enabled', () => {
    const expected: string[] = [];
    for (const t of ['brookings_sd', 'moreno_valley_ca', 'broomfield_co', 'glasgow']) {
      const c = cfg(t);
      if (c.sports?.enabled === true) for (const s of c.sports.sources) expected.push(`${t}/${s.adapter}:${s.program ?? '*'}`);
    }
    expect(SPORT_SOURCES.map((s) => `${s.townId}/${s.sourceId}`).sort()).toEqual(expected.sort());
  });
});

describe('checkSportHealth', () => {
  it('is ok with a success inside 36 h', async () => {
    const r = await checkSportHealth({ sql: sqlWith([{ town_id: 'brookings_sd', source_id: 'internal:sdsu', last_success: hoursAgo(STALE_HOURS - 1) }]), now: NOW, sources: one });
    expect(r).toEqual([{ townId: 'brookings_sd', ok: true }]);
  });
  it('fails after 36 h and names the last success', async () => {
    const [r] = await checkSportHealth({ sql: sqlWith([{ town_id: 'brookings_sd', source_id: 'internal:sdsu', last_success: hoursAgo(STALE_HOURS + 1) }]), now: NOW, sources: one });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('internal:sdsu');
    expect(r.error).toContain(hoursAgo(STALE_HOURS + 1));
  });
  it('fails when the row is missing or has never succeeded (an error does not count as a success)', async () => {
    expect((await checkSportHealth({ sql: sqlWith([]), now: NOW, sources: one }))[0].error).toContain('never succeeded');
    expect((await checkSportHealth({ sql: sqlWith([{ town_id: 'brookings_sd', source_id: 'internal:sdsu', last_success: null }]), now: NOW, sources: one }))[0].ok).toBe(false);
  });
  it('ignores rows of sources that are not listed (a switched-off source never alarms)', async () => {
    const r = await checkSportHealth({ sql: sqlWith([{ town_id: 'glasgow', source_id: 'old:x', last_success: hoursAgo(500) }]), now: NOW, sources: [] });
    expect(r).toEqual([]);
  });
});
