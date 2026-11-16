import { describe, expect, it } from 'vitest';
import {
  LISTED_UNTIL_MIN_HOURS, ROAD_MIN_ROWS, dedupeTrafficIncidents, listedUntil, mostAffectedRoad, sentenceCase, trafficCause, trafficHero,
  trafficReadClock, withoutCurrent,
} from './traffic-hero';
import { earlierTrafficIncidents } from './traffic-earlier';
import type { TrafficIncident } from './db';

/** Real traffic_incidents rows (SELECT 2026-11-16), copied verbatim; the id is in the comment. */
const MV = {
  // #4448 and #4449: two different closures on the same stretch, same title/road/position, no start (Caltrans gives none).
  r4448: { incident_type: 'lane_closure', title: 'Westbound 60 Lane Closure', description: 'From  Near Gilman Springs Rd to Theodore St / 1 of 3 general purpose lanes closed Due to K-rail Installation / No estimated time for reopening of closure.', road: 'Westbound 60', severity: 'closure', lat: 33.945621, lon: -117.056661, starts_at: null, ends_at: null, last_seen_at: '2026-11-16 11:25:00.681678+00:00', created_at: '2026-11-05 23:01:50.776274+00:00' },
  r4449: { incident_type: 'lane_closure', title: 'Westbound 60 Lane Closure', description: 'From  Near Gilman Springs Rd to Theodore St / 1 of 3 general purpose lanes closed Due to Slide Removal / Expected to end at 6:01pm Dec 30, 2026', road: 'Westbound 60', severity: 'closure', lat: 33.945621, lon: -117.056661, starts_at: null, ends_at: '2026-12-31 02:01:00+00:00', last_seen_at: '2026-11-16 11:25:00.682531+00:00', created_at: '2026-11-05 23:01:50.776274+00:00' },
  r4565: { incident_type: 'chp_incident', title: '1182-Trfc Collision-No Inj', description: 'Nov 11 2026  3:01PM Sr60 W / Day St / ', road: null, severity: 'injury', lat: 33.942639, lon: -117.278783, starts_at: null, ends_at: null, last_seen_at: '2026-11-11 23:02:34.436900+00:00', created_at: '2026-11-11 23:01:29.006728+00:00' },
  r4590: { incident_type: 'lane_closure', title: 'Southbound 215 Lane Closure', description: 'From  Cooley Dr to Washington Ave / Right Shoulder closed Due to Guardrail Repair / Expected to end at 3:59pm Nov 12, 2026', road: 'Southbound 215', severity: 'closure', lat: 34.050588, lon: -117.303524, starts_at: null, ends_at: '2026-11-12 23:59:00+00:00', last_seen_at: '2026-11-12 23:01:39.490834+00:00', created_at: '2026-11-12 23:01:27.114142+00:00' },
  r4618: { incident_type: 'lane_closure', title: 'Eastbound 60 Off Ramp Lane Closure', description: 'From  Near Nason St to Near Nason St / 1 of 4 general purpose lanes closed Due to Guardrail Repair / Expected to end at 8:30am Nov 13, 2026', road: 'Eastbound 60', severity: 'closure', lat: 33.939154, lon: -117.197932, starts_at: null, ends_at: '2026-11-13 16:30:00+00:00', last_seen_at: '2026-11-13 11:02:27.758479+00:00', created_at: '2026-11-13 11:01:48.960862+00:00' },
  // #4622: description cut after the first log entry (the full CHP log is ~1,900 characters; no "Due to" field in it either way).
  r4622: { incident_type: 'chp_incident', title: '1179-Trfc Collision-1141 Enrt', description: 'Nov 12 2026 10:29PM Sr60 E / Nason St Ofr / Nov 13 2026 12:34AM [44] 74-23 // ADV UNMANNED CLOSURE ADV CT DIV TO L 014', road: null, severity: 'closure', lat: 33.939152, lon: -117.195849, starts_at: null, ends_at: null, last_seen_at: '2026-11-13 11:02:27.781514+00:00', created_at: '2026-11-13 11:01:48.960862+00:00' },
  r4638: { incident_type: 'chp_incident', title: '1125-Traffic Hazard', description: 'Nov 14 2026  2:58PM Sr60 E / World Logistics Center Wlc Ofr / Nov 14 2026  2:58PM [1] WHI NISS ROG OVER FOG LINE - WILL ADVS', road: null, severity: 'incident', lat: 33.939184, lon: -117.142211, starts_at: null, ends_at: null, last_seen_at: '2026-11-14 23:01:55.267627+00:00', created_at: '2026-11-14 23:01:29.600095+00:00' },
} satisfies Record<string, TrafficIncident>;
const BF = {
  r4537: { incident_type: 'cdot_incident', title: '2 Vehicle Crash on US-36E', description: 'Between CO 157/Foothills Parkway and Cherryvale Road (near Boulder) at Mile Point 39.8. The right lane is closed due to a crash. Comment: Crash US 36 Eastbound at Cherryvale Right 2 Lanes Blocked, All Traffic Keep Left. Delays Expected', road: 'US-36E', severity: 'injury', lat: 39.981848, lon: -105.224575, starts_at: '2026-11-09 21:54:47.158000+00:00', ends_at: null, last_seen_at: '2026-11-09 23:02:16.217309+00:00', created_at: '2026-11-09 23:01:35.881126+00:00' },
  r4538: { incident_type: 'lane_closure', title: 'Maintenance Operations on I-25N', description: 'Between US 36 and Exit 219: 84th Avenue (Welby) at Mile Point 217.5. Three left lanes are closed due to road maintenance operations.', road: 'I-25N', severity: 'closure', lat: 39.83562, lon: -104.983387, starts_at: '2026-11-10 04:12:54.345000+00:00', ends_at: null, last_seen_at: '2026-11-10 11:01:28.861591+00:00', created_at: '2026-11-10 11:01:26.060762+00:00' },
  r4539: { incident_type: 'lane_closure', title: 'Maintenance Operations on I-25S', description: 'Between I-76 (North Washington) and CO 26/Alameda Avenue (Denver) from Mile Point 216 to Mile Point 209. The right shoulder is closed due to road maintenance operations.', road: 'I-25S', severity: 'closure', lat: 39.812972, lon: -104.983223, starts_at: '2026-11-10 06:35:11.091000+00:00', ends_at: null, last_seen_at: '2026-11-10 11:01:28.861646+00:00', created_at: '2026-11-10 11:01:26.060762+00:00' },
  r4598: { incident_type: 'lane_closure', title: 'Maintenance Operations on I-25S', description: 'Between CO 128/120th Avenue (Northglenn) and US 36 (Welby) from Mile Point 222 to Mile Point 218. Two left lanes are closed due to road maintenance operations.', road: 'I-25S', severity: 'closure', lat: 39.89934, lon: -104.987948, starts_at: '2026-11-13 05:45:01.874000+00:00', ends_at: null, last_seen_at: '2026-11-13 11:01:33.361118+00:00', created_at: '2026-11-13 11:01:30.356958+00:00' },
  r4648: { incident_type: 'cdot_incident', title: '2 Vehicle Crash on US-36W', description: 'Between Church Ranch Road and CO 128/120th Avenue (Broomfield) at Mile Point 49. The right lane is closed due to a crash.', road: 'US-36W', severity: 'closure', lat: 39.905044, lon: -105.083846, starts_at: '2026-11-15 10:56:09.576000+00:00', ends_at: null, last_seen_at: '2026-11-15 11:02:03.051743+00:00', created_at: '2026-11-15 11:01:20.341219+00:00' },
} satisfies Record<string, TrafficIncident>;

const MV_CORRIDORS = [{ label: 'I-215', numbers: ['215'] }, { label: 'SR-60', numbers: ['60'] }];
const BF_CORRIDORS = [{ label: 'I-25', numbers: ['25'] }, { label: 'US-36', numbers: ['36'] }, { label: 'US-287', numbers: ['287'] }];
const NOW = new Date('2026-11-16T11:40:00Z');
// scrape_runs.finished_at of the latest ok traffic read, 2026-11-16.
const MV_READ = '2026-11-16 11:25:00.759806+00:00';
const BF_READ = '2026-11-16 11:02:11.615020+00:00';
const MV_TZ = 'America/Los_Angeles';
const BF_TZ = 'America/Denver';

describe('duplicates (display only)', () => {
  it('#4448 and #4449 have no start, so they are never merged', () => {
    expect(dedupeTrafficIncidents([MV.r4448, MV.r4449])).toHaveLength(2);
  });
  it('a real row and its copy with the same start and position become one row with the latest ends_at', () => {
    // #4538 twice; the copy differs only in ends_at.
    const copy = { ...BF.r4538, ends_at: '2026-11-11 00:00:00+00:00' };
    const out = dedupeTrafficIncidents([BF.r4538, copy]);
    expect(out).toHaveLength(1);
    expect(out[0].ends_at).toBe('2026-11-11 00:00:00+00:00');
  });
  it('no merge when only the position differs (#4598 with lat changed)', () => {
    expect(dedupeTrafficIncidents([BF.r4598, { ...BF.r4598, lat: 39.9 }])).toHaveLength(2);
  });
  it('no merge without a position (#4538 with lat null)', () => {
    expect(dedupeTrafficIncidents([BF.r4538, { ...BF.r4538, lat: null }])).toHaveLength(2);
  });
  it('different real rows on the same road stay apart (#4539, #4598: same title, different start)', () => {
    expect(dedupeTrafficIncidents([BF.r4539, BF.r4598])).toHaveLength(2);
  });
  it('an earlier row equal to a current one is dropped (#4648 in both lists)', () => {
    expect(withoutCurrent([BF.r4648, BF.r4598], [BF.r4648])).toEqual([BF.r4598]);
  });
});

describe('cause from the source', () => {
  it('reads the structured "Due to ... /" field', () => {
    expect(trafficCause(MV.r4448.description)).toBe('K-rail installation');
    expect(trafficCause(MV.r4449.description)).toBe('slide removal');
    expect(sentenceCase(trafficCause(MV.r4448.description)!)).toBe('K-rail installation');
    expect(sentenceCase(trafficCause(MV.r4449.description)!)).toBe('Slide removal');
  });
  it('null for descriptions without the field (CHP, CDOT)', () => {
    expect(trafficCause(MV.r4565.description)).toBeNull();
    expect(trafficCause(BF.r4648.description)).toBeNull();
    expect(trafficCause(null)).toBeNull();
  });
});

describe('read time', () => {
  it('is finished_at floored to the minute, with the zone', () => {
    expect(trafficReadClock(MV_READ, NOW, MV_TZ, 'en-US')).toBe('3:25 AM PST');
    expect(trafficReadClock(BF_READ, NOW, BF_TZ, 'en-US')).toBe('4:02 AM MST');
    // 11:25:59 stays 3:25 (floor, never rounded up)
    expect(trafficReadClock('2026-11-16T11:25:59.900Z', NOW, MV_TZ, 'en-US')).toBe('3:25 AM PST');
  });
  it('a read from an earlier local day carries the weekday', () => {
    expect(trafficReadClock('2026-11-15 23:01:40+00:00', new Date('2026-11-16T09:00:00Z'), MV_TZ, 'en-US')).toBe('Sun 3:01 PM PST');
  });
});

const hero = (current: TrafficIncident[], earlierCount: number, o: { read?: string | null; stale?: boolean; tz?: string; city?: string } = {}) => trafficHero({
  current, earlierCount, readAt: o.read === undefined ? MV_READ : o.read, readIsStale: o.stale ?? false, now: NOW,
  tz: o.tz ?? MV_TZ, locale: 'en-US', scope: 'state highways', cityName: o.city ?? 'Moreno Valley',
});

describe('hero', () => {
  it('Moreno 16 Nov: 2 closures', () => {
    expect(hero([MV.r4448, MV.r4449], 5)).toEqual({ value: '2', sub: '2 closures on state highways in and near Moreno Valley', meta: 'As of 3:25 AM PST' });
  });
  it('closures and incidents are named only when > 0', () => {
    expect(hero([MV.r4448, MV.r4565, MV.r4638], 0)!.sub).toBe('1 closure, 2 incidents on state highways in and near Moreno Valley');
    expect(hero([MV.r4638], 0)!.sub).toBe('1 incident on state highways in and near Moreno Valley');
  });
  it('Broomfield 16 Nov: none listed, 5 earlier', () => {
    expect(hero([], 5, { read: BF_READ, tz: BF_TZ, city: 'Broomfield' }))
      .toEqual({ value: 'None listed', sub: 'on state highways in and near Broomfield', meta: 'As of 4:02 AM MST · 5 earlier this week' });
  });
  it('no hero without a read, with a stale read, or with nothing on the page', () => {
    expect(hero([MV.r4448], 0, { read: null })).toBeNull();
    expect(hero([], 5, { stale: true })).toBeNull();
    expect(hero([], 0)).toBeNull();
  });
});

describe('most affected road', () => {
  it(`threshold is ${ROAD_MIN_ROWS} rows`, () => expect(ROAD_MIN_ROWS).toBe(2));
  it('Moreno 16 Nov: SR-60, 3 of 7 (rows without a road count only in the total)', () => {
    const rows = [MV.r4448, MV.r4449, MV.r4565, MV.r4590, MV.r4618, MV.r4622, MV.r4638];
    expect(mostAffectedRoad(rows, MV_CORRIDORS)).toBe('Most affected road: SR-60, 3 of 7 listed');
  });
  it('Broomfield 16 Nov: I-25, 3 of 5', () => {
    expect(mostAffectedRoad([BF.r4537, BF.r4538, BF.r4539, BF.r4598, BF.r4648], BF_CORRIDORS)).toBe('Most affected road: I-25, 3 of 5 listed');
  });
  it('hidden on a tie (I-25 2, US-36 2) and below the threshold', () => {
    expect(mostAffectedRoad([BF.r4537, BF.r4538, BF.r4539, BF.r4648], BF_CORRIDORS)).toBeNull();
    expect(mostAffectedRoad([BF.r4538, BF.r4648], BF_CORRIDORS)).toBeNull();
    expect(mostAffectedRoad([MV.r4565, MV.r4622], MV_CORRIDORS)).toBeNull();
  });
});

describe('listed until', () => {
  it(`threshold is ${LISTED_UNTIL_MIN_HOURS} h`, () => expect(LISTED_UNTIL_MIN_HOURS).toBe(48));
  it('Moreno 16 Nov: #4449 with its cause', () => {
    expect(listedUntil([MV.r4448, MV.r4449], NOW, MV_TZ, 'en-US')).toBe('Westbound 60 slide removal listed until Wed, Dec 30');
  });
  it('without a cause the title stands in (#4449 with the description removed)', () => {
    expect(listedUntil([{ ...MV.r4449, description: null }], NOW, MV_TZ, 'en-US')).toBe('Westbound 60 lane closure listed until Wed, Dec 30');
  });
  it('hidden when no end is at least 48 h ahead (#4449 seen on 29 Dec)', () => {
    expect(listedUntil([MV.r4449], new Date('2026-12-29T12:00:00Z'), MV_TZ, 'en-US')).toBeNull();
    expect(listedUntil([MV.r4448], NOW, MV_TZ, 'en-US')).toBeNull();
    expect(listedUntil([BF.r4538], NOW, BF_TZ, 'en-US')).toBeNull();
  });
  it('the year is shown when the end is in another year (#4449 with ends_at moved to 2027)', () => {
    expect(listedUntil([{ ...MV.r4449, ends_at: '2027-01-08 02:01:00+00:00' }], NOW, MV_TZ, 'en-US')).toBe('Westbound 60 slide removal listed until Thu, Jan 7, 2027');
  });
});

describe('Broomfield earlier list with the rolling 7 x 24 h window', () => {
  it('#4537 drops out at 21:54 UTC on 16 Nov, the road line still shows I-25, 3 of 4', () => {
    const rows = [BF.r4537, BF.r4538, BF.r4539, BF.r4598, BF.r4648];
    const ctx = { latestReadStart: '2026-11-16T11:01:28Z', townId: 'broomfield_co', corridors: BF_CORRIDORS, corridorMaxMiles: 8 };
    expect(earlierTrafficIncidents(rows, { ...ctx, now: NOW })).toHaveLength(5);
    const later = earlierTrafficIncidents(rows, { ...ctx, now: new Date('2026-11-16T22:00:00Z') });
    expect(later).toHaveLength(4);
    expect(mostAffectedRoad(later, BF_CORRIDORS)).toBe('Most affected road: I-25, 3 of 4 listed');
  });
});
