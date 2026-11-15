// /traffic/ "Earlier this week" and the index rule on top of it (owner 2026-11-15, second ruling): the page is indexed when it shows at
// least one current or earlier incident; an indexed page is never without rows. Broomfield 10-12 Nov (48 h with nothing current) must
// have content and stay indexed at every read.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TRAFFIC_EARLIER_DAYS, earlierTrafficIncidents } from './traffic-earlier';
import { applyTrafficInertia, trafficIndexingForTown, type TrafficState } from './traffic-verdict';
import { classifyTrafficIncident } from './traffic';
import { ALL_CONFIGS } from './site-config';
import type { TrafficIncident } from './db';

const BF = ALL_CONFIGS.find((c) => c.townId === 'broomfield_co')!;
const opts = (latestReadStart: string | null, now: string) => ({
  latestReadStart, now: new Date(now), townId: 'broomfield_co', corridors: BF.trafficCorridors, corridorMaxMiles: BF.trafficCorridorMaxMiles,
});

// Real rows, broomfield_co, traffic_incidents (id), read 2026-11-15; last_seen_at as stored (each was listed by one read only).
const ROWS: (TrafficIncident & { id: number; created_at: string })[] = [
  { id: 4486, incident_type: 'cdot_incident', severity: 'closure', title: '1 Vehicle Crash on I-25N', road: 'I-25N', description: null, lat: 39.819236, lon: -104.982605, starts_at: '2026-11-07T08:45:47.720Z', ends_at: null, created_at: '2026-11-07T11:01:28.216Z', last_seen_at: '2026-11-07T11:02:08.979Z' },
  { id: 4508, incident_type: 'cdot_incident', severity: 'incident', title: '2 Vehicle Crash on I-25N', road: 'I-25N', description: null, lat: 39.827843, lon: -104.981282, starts_at: '2026-11-07T22:52:46.599Z', ends_at: '2026-11-07T23:00:36.073Z', created_at: '2026-11-07T23:02:03.054Z', last_seen_at: '2026-11-07T23:02:07.926Z' },
  { id: 4537, incident_type: 'cdot_incident', severity: 'injury', title: '2 Vehicle Crash on US-36E', road: 'US-36E', description: null, lat: 39.981848, lon: -105.224575, starts_at: '2026-11-09T21:54:47.158Z', ends_at: null, created_at: '2026-11-09T23:01:35.881Z', last_seen_at: '2026-11-09T23:02:16.217Z' },
  { id: 4538, incident_type: 'lane_closure', severity: 'closure', title: 'Maintenance Operations on I-25N', road: 'I-25N', description: null, lat: 39.83562, lon: -104.983387, starts_at: '2026-11-10T04:12:54.345Z', ends_at: null, created_at: '2026-11-10T11:01:26.060Z', last_seen_at: '2026-11-10T11:01:28.861Z' },
  { id: 4539, incident_type: 'lane_closure', severity: 'closure', title: 'Maintenance Operations on I-25S', road: 'I-25S', description: null, lat: 39.812972, lon: -104.983223, starts_at: '2026-11-10T06:35:11.091Z', ends_at: null, created_at: '2026-11-10T11:01:26.060Z', last_seen_at: '2026-11-10T11:01:28.861Z' },
  { id: 4562, incident_type: 'cdot_incident', severity: 'incident', title: '2 Vehicle Crash on I-70W', road: 'I-70W', description: null, lat: 39.77845, lon: -104.922399, starts_at: '2026-11-11T22:11:59.894Z', ends_at: '2026-11-11T22:50:53.598Z', created_at: '2026-11-11T23:01:42.608Z', last_seen_at: '2026-11-11T23:01:44.180Z' },
  { id: 4576, incident_type: 'cdot_incident', severity: 'closure', title: '1 Vehicle Crash on I-76E', road: 'I-76E', description: null, lat: 39.811306, lon: -104.995538, starts_at: '2026-11-12T20:44:46.274Z', ends_at: null, created_at: '2026-11-12T23:01:24.216Z', last_seen_at: '2026-11-12T23:01:26.365Z' },
  { id: 4598, incident_type: 'lane_closure', severity: 'closure', title: 'Maintenance Operations on I-25S', road: 'I-25S', description: null, lat: 39.89934, lon: -104.987948, starts_at: '2026-11-13T05:45:01.874Z', ends_at: null, created_at: '2026-11-13T11:01:30.356Z', last_seen_at: '2026-11-13T11:01:33.361Z' },
];
// Real reads, scrape_runs (id: started_at, finished_at), broomfield_co traffic, 10-13 Nov.
const READS = [
  { run: 14624, start: '2026-11-10T11:01:26.060Z', end: '2026-11-10T11:01:28.997Z' },
  { run: 14657, start: '2026-11-10T23:01:25.797Z', end: '2026-11-10T23:01:28.092Z' },
  { run: 14693, start: '2026-11-11T11:01:27.567Z', end: '2026-11-11T11:02:08.652Z' },
  { run: 14709, start: '2026-11-11T23:01:42.608Z', end: '2026-11-11T23:01:44.214Z' },
  { run: 14751, start: '2026-11-12T11:01:32.487Z', end: '2026-11-12T11:02:13.371Z' },
  { run: 14761, start: '2026-11-12T23:01:24.216Z', end: '2026-11-12T23:01:26.398Z' },
  { run: 14793, start: '2026-11-13T11:01:30.356Z', end: '2026-11-13T11:01:33.376Z' },
];

/** The table as the build after `read` saw it: rows first seen by then (each row's single read is its last_seen_at). */
function atRead(read: (typeof READS)[number]) {
  const now = Date.parse(read.end);
  const rows = ROWS.filter((r) => Date.parse(r.created_at) <= now);
  const current = rows.filter((r) => Date.parse(r.last_seen_at) >= Date.parse(read.start) && (r.ends_at === null || Date.parse(r.ends_at) >= now)
    && classifyTrafficIncident(r, 'broomfield_co', BF.trafficCorridors, BF.trafficCorridorMaxMiles) !== null);
  const earlier = earlierTrafficIncidents(rows, opts(read.start, read.end));
  return { current: current.map((r) => (r as { id: number }).id), earlier: earlier.map((r) => (r as unknown as { id: number }).id), earlierRows: earlier };
}

describe('/traffic/ Earlier this week (Broomfield real reads)', () => {
  it('10-12 Nov (48 h with nothing current): every read has rows under the heading', () => {
    const seen = READS.map(atRead);
    expect(seen.map((s) => s.current.length)).toEqual([2, 0, 0, 0, 0, 0, 1]);
    for (const [k, s] of seen.entries()) expect(s.current.length + s.earlier.length, String(READS[k].run)).toBeGreaterThan(0);
    // 10 Nov 23:01: the two maintenance closures read at 11:01 have ended, newest first
    expect(seen[1].earlier.slice(0, 2)).toEqual([4539, 4538]);
    // An incident the latest read lists is never in the earlier group, and an earlier one is never current
    for (const s of seen) expect(s.earlier.filter((id) => s.current.includes(id))).toEqual([]);
  });

  it('the index rule on top: indexed through the whole stretch, the inertia never holds an empty page', () => {
    let indexed = true;
    let state: TrafficState | null = null;
    for (const read of READS) {
      const s = atRead(read);
      const shown = s.current.length + s.earlier.length;
      const i = applyTrafficInertia({ townId: 'broomfield_co', hasIncidents: shown > 0, readAt: read.end, wasIndexed: indexed, state });
      expect(i.indexable, String(read.run)).toBe(true);
      expect(i.state.emptyReads).toBe(0);
      indexed = i.indexable;
      state = i.state;
    }
  });

  it('a cleared incident still listed by the latest read is earlier (4562: ends_at 22:50, read 23:01); one without ends_at is not', () => {
    const s = atRead(READS[3]);
    const r4562 = earlierTrafficIncidents(ROWS.filter((r) => r.id === 4562), opts(READS[3].start, READS[3].end));
    const r4598 = earlierTrafficIncidents(ROWS.filter((r) => r.id === 4598), opts(READS[6].start, READS[6].end));
    expect(r4598).toEqual([]);
    // 4562 is outside Broomfield's corridors (I-70): cleared, but never listed in either group
    expect(r4562).toEqual([]);
    expect(s.earlier).not.toContain(4562);
  });

  it(`only the last ${TRAFFIC_EARLIER_DAYS} days, dated by the source's start time (else first seen), newest first`, () => {
    const at = '2026-11-14T11:01:36.522Z';
    const e = earlierTrafficIncidents(ROWS, opts('2026-11-14T11:01:33.685Z', at));
    expect(e.every((r) => Date.parse(r.at) >= Date.parse(at) - TRAFFIC_EARLIER_DAYS * 86_400_000)).toBe(true);
    expect(e.map((r) => r.at)).toEqual([...e.map((r) => r.at)].sort().reverse());
    expect(e.find((r) => (r as unknown as { id: number }).id === 4598)?.at).toBe('2026-11-13T05:45:01.874Z');
    const noStart = earlierTrafficIncidents([{ ...ROWS[7], starts_at: null }], opts('2026-11-14T11:01:33.685Z', at));
    expect(noStart[0]?.at).toBe(ROWS[7].created_at);
  });

  it('a stale latest read: what it still lists is not shown as ended', () => {
    // 4598 (only field changed: none) seen by read 14793; no newer read -> not earlier, even with an empty current list
    expect(earlierTrafficIncidents([ROWS[7]], opts(READS[6].start, '2026-11-14T20:00:00.000Z'))).toEqual([]);
  });
});

describe('trafficIndexingForTown: an indexed page is never empty', () => {
  const live = (tag: string, state: unknown): typeof fetch => (async (url: URL | string) =>
    String(url).endsWith('/traffic/') ? new Response(`<meta name="robots" content="${tag}">`)
      : state === null ? new Response('', { status: 404 }) : new Response(JSON.stringify(state))) as typeof fetch;
  const base = { townId: 'broomfield_co', siteUrl: 'https://broomfieldview.com', rule: 'inertia' as const, quiet: false, retryMs: 0 };

  it('inertia would hold the indexed page, but nothing is shown: noindex', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'traffic-'));
    const held = { townId: 'broomfield_co', emptySince: READS[1].end, emptyReads: 1, lastRead: READS[1].end };
    expect(await trafficIndexingForTown({ ...base, incidentCount: 0, readAt: READS[2].end, fetchImpl: live('max-image-preview:large', held), dir }))
      .toEqual({ indexable: false });
  });

  it('only earlier rows: indexed, and a not-indexed page enters on them', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'traffic-'));
    expect(await trafficIndexingForTown({ ...base, incidentCount: 2, readAt: READS[1].end, fetchImpl: live('noindex,follow', null), dir }))
      .toEqual({ indexable: true });
  });

  it('a standing town with nothing to show is not indexed', async () => {
    const never = (() => { throw new Error('no live read expected'); }) as unknown as typeof fetch;
    expect(await trafficIndexingForTown({ ...base, rule: 'standing', townId: 'moreno_valley_ca', incidentCount: 0, readAt: null, fetchImpl: never }))
      .toEqual({ indexable: false });
  });
});
