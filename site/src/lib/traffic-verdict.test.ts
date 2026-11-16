// /traffic/ indexing (owner 2026-11-15): standing towns always indexed, inertia towns noindex only after >= 72 h and >= 3 empty reads,
// no status line anywhere, unknown live state stops the build. Earlier rule: Broomfield AdSense plan F4 (2026-11-11).
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  TRAFFIC_READ_MAX_AGE_HOURS, applyTrafficInertia, trafficIndexingForTown, liveTrafficState, type TrafficState,
} from './traffic-verdict';
import { classifyTrafficIncident } from './traffic';
import { ALL_CONFIGS } from './site-config';
import type { TrafficIncident } from './db';

const BF = ALL_CONFIGS.find((c) => c.townId === 'broomfield_co')!;
const listed = (rows: Partial<TrafficIncident>[]) =>
  rows.filter((r) => classifyTrafficIncident(r as TrafficIncident, 'broomfield_co', BF.trafficCorridors, BF.trafficCorridorMaxMiles) !== null).length;

// Real rows, broomfield_co, traffic_incidents (id) and scrape_runs (id: finished_at), read 2026-11-15.
const INC_4598 = { incident_type: 'lane_closure', severity: 'closure', road: 'I-25S', title: 'Maintenance Operations on I-25S', lat: 39.89934, lon: -104.987948 };
const INC_4648 = { incident_type: 'cdot_incident', severity: 'closure', road: 'US-36W', title: '2 Vehicle Crash on US-36W', lat: 39.905044, lon: -105.083846 };
const READS: { run: number; at: string; rows: Partial<TrafficIncident>[] }[] = [
  { run: 14793, at: '2026-11-13T11:01:33.376Z', rows: [INC_4598] },
  { run: 14833, at: '2026-11-13T23:02:12.683Z', rows: [] },
  { run: 14856, at: '2026-11-14T11:01:36.522Z', rows: [] },
  { run: 14872, at: '2026-11-14T23:01:25.507Z', rows: [] }, // yesterday's empty 23:01 read
  { run: 14912, at: '2026-11-15T11:02:03.105Z', rows: [INC_4648] }, // today's 11:01 read
];
// Empty reads 10-12 Nov (items_found 0, or 1 outside the corridors: run 14709, 14761): 48 h without anything listed.
const EMPTY_STRETCH = ['2026-11-10T23:01:28.092Z', '2026-11-11T11:02:08.652Z', '2026-11-11T23:01:44.214Z', '2026-11-12T11:02:13.371Z', '2026-11-12T23:01:26.398Z'];

function replay(reads: { at: string; count: number }[], wasIndexed: boolean) {
  let indexed = wasIndexed;
  let state: TrafficState | null = null;
  const tags: boolean[] = [];
  for (const r of reads) {
    const i = applyTrafficInertia({ townId: 'broomfield_co', hasIncidents: r.count > 0, readAt: r.at, wasIndexed: indexed, state });
    indexed = i.indexable;
    state = i.state;
    tags.push(indexed);
  }
  return { tags, state };
}

describe('/traffic/ inertia (Broomfield)', () => {
  it("real reads 13-15 Nov: yesterday's empty 23:01 read followed by today's 11:01 gives no switch", () => {
    expect(READS.map((r) => listed(r.rows))).toEqual([1, 0, 0, 0, 1]);
    const { tags, state } = replay(READS.map((r) => ({ at: r.at, count: listed(r.rows) })), false);
    expect(tags).toEqual([true, true, true, true, true]);
    expect(state).toEqual({ townId: 'broomfield_co', emptySince: null, emptyReads: 0, lastRead: '2026-11-15T11:02:03.105Z' });
  });

  it('the empty 23:01 read alone holds the indexed page, counting one read', () => {
    const i = applyTrafficInertia({ townId: 'broomfield_co', hasIncidents: false, readAt: READS[3].at, wasIndexed: true, state: null });
    expect(i.indexable).toBe(true);
    expect(i.state).toMatchObject({ emptySince: READS[3].at, emptyReads: 1 });
  });

  it('real 48 h empty stretch 10-12 Nov (5 reads) stays indexed; the same last read 24 h later (only finished_at moved) goes noindex', () => {
    expect(replay(EMPTY_STRETCH.map((at) => ({ at, count: 0 })), true).tags).toEqual([true, true, true, true, true]);
    // run 14761 again with only finished_at changed (+24 h 1 min): 72 h after the first empty read (+24 h alone is 2 s short)
    const moved = [...EMPTY_STRETCH, '2026-11-13T23:02:26.398Z'];
    expect(replay(moved.slice(0, -1).concat('2026-11-13T23:01:26.398Z').map((at) => ({ at, count: 0 })), true).tags.at(-1)).toBe(true);
    expect(replay(moved.map((at) => ({ at, count: 0 })), true).tags).toEqual([true, true, true, true, true, false]);
  });

  it('72 h alone is not enough: needs 3 distinct reads; a rebuild of the same read counts once', () => {
    const twoReads = replay([{ at: EMPTY_STRETCH[0], count: 0 }, { at: '2026-11-13T23:01:28.092Z', count: 0 }], true);
    expect(twoReads.tags).toEqual([true, true]);
    const rebuilt = replay([{ at: EMPTY_STRETCH[0], count: 0 }, { at: EMPTY_STRETCH[0], count: 0 }, { at: EMPTY_STRETCH[0], count: 0 }], true);
    expect(rebuilt.state?.emptyReads).toBe(1);
  });

  it('a page that is not indexed enters at the first read with incidents and stays out on an empty one', () => {
    expect(applyTrafficInertia({ townId: 'broomfield_co', hasIncidents: true, readAt: READS[4].at, wasIndexed: false, state: null }).indexable).toBe(true);
    expect(applyTrafficInertia({ townId: 'broomfield_co', hasIncidents: false, readAt: READS[3].at, wasIndexed: false, state: null }).indexable).toBe(false);
  });

  it(`no read within ${TRAFFIC_READ_MAX_AGE_HOURS} h: the tag is kept and nothing is counted`, () => {
    const held: TrafficState = { townId: 'broomfield_co', emptySince: READS[1].at, emptyReads: 2, lastRead: READS[2].at };
    for (const wasIndexed of [true, false]) {
      const i = applyTrafficInertia({ townId: 'broomfield_co', hasIncidents: false, readAt: null, wasIndexed, state: held });
      expect(i.indexable).toBe(wasIndexed);
      expect(i.state).toEqual(held);
    }
  });
});

const live = (tag: string | null, state: unknown, stateStatus = 200): typeof fetch => (async (url: URL | string) => {
  const u = String(url);
  if (u.endsWith('/traffic/')) return tag === null ? new Response('', { status: 503 }) : new Response(`<meta name="robots" content="${tag}">`);
  return new Response(stateStatus === 200 ? JSON.stringify(state) : '', { status: stateStatus });
}) as typeof fetch;
const base = (fetchImpl: typeof fetch, extra: Partial<Parameters<typeof trafficIndexingForTown>[0]> = {}) => ({
  townId: 'broomfield_co', siteUrl: 'https://broomfieldview.com', rule: 'inertia' as const, quiet: false, incidentCount: 0,
  readAt: READS[3].at, fetchImpl, retryMs: 0, dir: mkdtempSync(join(tmpdir(), 'traffic-')), ...extra,
});

describe('trafficIndexingForTown', () => {
  it('unknown live state (robots tag unreadable twice) stops the build instead of switching the tag', async () => {
    await expect(trafficIndexingForTown(base(live(null, null)))).rejects.toThrow(/Build stopped: broomfield_co is not deployed/);
  });

  it('a state file that does not answer 200/404, or belongs to another town, also stops the build', async () => {
    await expect(trafficIndexingForTown(base(live('max-image-preview:large', null, 500)))).rejects.toThrow(/HTTP 500/);
    await expect(trafficIndexingForTown(base(live('max-image-preview:large', { townId: 'glasgow', emptySince: null, emptyReads: 0, lastRead: null }))))
      .rejects.toThrow(/not a state file for broomfield_co/);
  });

  it('404 state (first deploy of the rule) = a fresh count: the indexed page is held, the verdict and state are written', async () => {
    // incidentCount = the rows the page shows (current + earlier, owner 2026-11-15): one earlier row, nothing current
    const o = base(live('max-image-preview:large', null, 404), { incidentCount: 1 });
    expect(await trafficIndexingForTown(o)).toEqual({ indexable: true });
    const v = JSON.parse(readFileSync(join(o.dir!, '.traffic-verdict.json'), 'utf8'));
    expect(v).toEqual({ townId: 'broomfield_co', indexable: true, state: { townId: 'broomfield_co', emptySince: null, emptyReads: 0, lastRead: READS[3].at, indexed: true } });
  });

  it('nothing to show: noindex even while the inertia would hold (an indexed page is never empty, owner 2026-11-15)', async () => {
    const o = base(live('max-image-preview:large', null, 404));
    expect(await trafficIndexingForTown(o)).toEqual({ indexable: false });
    const v = JSON.parse(readFileSync(join(o.dir!, '.traffic-verdict.json'), 'utf8'));
    expect(v.state).toEqual({ townId: 'broomfield_co', emptySince: null, emptyReads: 0, lastRead: READS[3].at, indexed: false });
  });

  it('standing towns are indexed with no live read while the page shows rows; a quiet section is never indexed', async () => {
    const never = (() => { throw new Error('no live read expected'); }) as unknown as typeof fetch;
    expect(await trafficIndexingForTown(base(never, { townId: 'moreno_valley_ca', rule: 'standing', incidentCount: 3 }))).toEqual({ indexable: true });
    expect(await trafficIndexingForTown(base(never, { quiet: true, incidentCount: 2 }))).toEqual({ indexable: false });
  });

  it('liveTrafficState reads the published shape', async () => {
    const s = { townId: 'broomfield_co', emptySince: READS[1].at, emptyReads: 2, lastRead: READS[2].at, indexed: true };
    expect(await liveTrafficState('https://broomfieldview.com', 'broomfield_co', live('x', s))).toEqual({ ok: true, value: s });
  });
});

describe('/traffic/ page and config', () => {
  const page = readFileSync(join(__dirname, '../pages/[traffic].astro'), 'utf8');

  it('every town with a traffic source names its rule: Moreno Valley standing, Broomfield inertia', () => {
    for (const c of ALL_CONFIGS) if (c.trafficSource) expect(['standing', 'inertia'], c.townId).toContain(c.trafficSource.indexing);
    expect(ALL_CONFIGS.find((c) => c.townId === 'moreno_valley_ca')!.trafficSource!.indexing).toBe('standing');
    expect(BF.trafficSource!.indexing).toBe('inertia');
  });

  it('no status line or explanation without incidents; hero, filters and source line only with incidents', () => {
    expect(page).not.toContain('traffic-status');
    expect(page).not.toContain('statusLine');
    expect(page).toContain('noindex={!indexing.indexable}');
    // The hero (lib/traffic-hero.ts) replaced the "N reported as of" rule (audit Fas 6a); it is null when nothing is shown.
    expect(page).not.toContain('<SectionRule');
    expect(page).toMatch(/\{hero && \(\s*<section class="answer"/);
    expect(page).toMatch(/\{incidents\.length > 0 && \(\s*<div class="controls">/);
    expect(page).toMatch(/\{siteConfig\.trafficSource && \(shown > 0 \|\| lastListed\.length > 0\) && \(\s*<p class="source">/);
    expect(page).toMatch(/\{siteConfig\.trafficSource && earlier\.length > 0 && \(\s*<section class="earlier"/);
    expect(page).toContain('incidentCount: shown,');
  });

  it('the build publishes the inertia count as /traffic-state.json', () => {
    const cfg = readFileSync(join(__dirname, '../../astro.config.mjs'), 'utf8');
    expect(cfg).toContain("'traffic-state.json'");
  });

  it('list and read time describe the same read: /traffic/ lists what the latest finished ok run saw', () => {
    // 2026-11-11: a build more than 3 h after a read dropped that read's incidents. 2026-11-16 (audit Fas 6a): one scrape_runs row
    // gives the cut, the out-of-date decision and the clock; the list query has no read lookup of its own.
    expect(page).toContain('trafficReadState(siteConfig.trafficSource ? await getTrafficLatestRead() : null, now)');
    expect(page).toContain('await getTrafficIncidentsListedAt(readStart)');
    expect(page).toContain('latestReadStart: readStart,');
    expect(page).not.toContain('getActiveTrafficIncidents(');
    const db = readFileSync(join(__dirname, 'db.ts'), 'utf8');
    const read = db.slice(db.indexOf('export async function getTrafficLatestRead'), db.indexOf('export async function getTrafficIncidentsListedAt'));
    expect(read).toContain("status = 'ok' AND finished_at IS NOT NULL");
    expect(read).toContain('ORDER BY started_at DESC LIMIT 1');
    const list = db.slice(db.indexOf('export async function getTrafficIncidentsListedAt'), db.indexOf('export async function getTrafficIncidentsStartedSince'));
    expect(list).toContain('last_seen_at >= ${readStart}');
    expect(list).not.toContain('scrape_runs');
    expect(list).not.toContain('interval');
    expect(TRAFFIC_READ_MAX_AGE_HOURS).toBe(26);
  });

  it('the source scope notes shown on the page use real punctuation, not " -- "', () => {
    for (const c of ALL_CONFIGS) if (c.trafficSource) expect(c.trafficSource.scopeNote, c.townId).not.toContain('--');
  });
});
