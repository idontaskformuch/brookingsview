import { describe, expect, it } from 'vitest';
import { TRAFFIC_LAST_LISTED_MAX_DAYS, lastListedRows, trafficReadState, trafficStaleLead } from './traffic-read';
import { TRAFFIC_READ_MAX_AGE_HOURS } from './traffic-verdict';
import { trafficHero, trafficReadClock } from './traffic-hero';
import { trafficKind, trafficLabelKey } from './traffic';
import FIX from './fixtures/traffic-rows-2026-11-16.json';

const MV = FIX.moreno_valley_ca;
const BF = FIX.broomfield_co;

/** Real scrape_runs rows (source 'traffic', SELECT 2026-11-16). */
const RUN_14981 = { status: 'ok', started_at: '2026-11-16T11:24:39.853982+00:00', finished_at: '2026-11-16T11:25:00.759806+00:00' }; // Moreno Valley
const RUN_14912 = { status: 'ok', started_at: '2026-11-15T11:01:20.341219+00:00', finished_at: '2026-11-15T11:02:03.105493+00:00' }; // Broomfield
const MV_TZ = 'America/Los_Angeles';
const BF_TZ = 'America/Denver';

describe('which run is the latest read', () => {
  it('a finished ok run is a read', () => {
    expect(trafficReadState(RUN_14981, new Date('2026-11-16T20:00:00Z'))).toEqual({
      kind: 'fresh', start: '2026-11-16T11:24:39.853Z', finish: '2026-11-16T11:25:00.759Z',
    });
  });
  it('a started run that has not finished is never a read (#14981 as it stood while running: status running, finished_at null)', () => {
    expect(trafficReadState({ ...RUN_14981, status: 'running', finished_at: null }, new Date('2026-11-16T11:24:50Z'))).toEqual({ kind: 'none' });
  });
  it('an ok row without finished_at is not a read either (#14981 with finished_at null)', () => {
    expect(trafficReadState({ ...RUN_14981, finished_at: null }, new Date('2026-11-16T20:00:00Z'))).toEqual({ kind: 'none' });
  });
  it('a failed run is not a read (#14981 with status error)', () => {
    expect(trafficReadState({ ...RUN_14981, status: 'error' }, new Date('2026-11-16T20:00:00Z'))).toEqual({ kind: 'none' });
  });
  it('no run at all', () => expect(trafficReadState(null, new Date('2026-11-16T20:00:00Z'))).toEqual({ kind: 'none' }));
});

describe('out of date: cut on the read start, the same instant the list is cut on', () => {
  it(`threshold ${TRAFFIC_READ_MAX_AGE_HOURS} h from started_at`, () => {
    const start = Date.parse(RUN_14981.started_at);
    const at = (ms: number) => trafficReadState(RUN_14981, new Date(start + ms)).kind;
    expect(at(26 * 3_600_000)).toBe('fresh');
    // 1 ms past 26 h after the START is stale, although only ~25 h 59 m 39 s have passed since the finish
    expect(at(26 * 3_600_000 + 1)).toBe('stale');
  });
  it(`"Last listed" only while the read is at most ${TRAFFIC_LAST_LISTED_MAX_DAYS} days old`, () => {
    const start = Date.parse(RUN_14981.started_at);
    const s = (ms: number) => trafficReadState(RUN_14981, new Date(start + ms));
    expect(s(7 * 86_400_000)).toMatchObject({ kind: 'stale', showLastListed: true });
    expect(s(7 * 86_400_000 + 1)).toMatchObject({ kind: 'stale', showLastListed: false });
  });
});

describe('the out-of-date line', () => {
  it('Moreno, built 17 Nov 20:00 UTC on the read of 16 Nov', () => {
    const now = new Date('2026-11-17T20:00:00Z');
    expect(trafficStaleLead(trafficReadState(RUN_14981, now), now, MV_TZ, 'en-US')).toBe('Not updated since Mon 3:25 AM PST.');
  });
  it('Broomfield, built 16 Nov 20:00 UTC on the read of 15 Nov', () => {
    const now = new Date('2026-11-16T20:00:00Z');
    expect(trafficStaleLead(trafficReadState(RUN_14912, now), now, BF_TZ, 'en-US')).toBe('Not updated since Sun 4:02 AM MST.');
  });
  it('a read from a week or more back carries its date, not a weekday', () => {
    const now = new Date('2026-11-23T20:00:00Z');
    expect(trafficStaleLead(trafficReadState(RUN_14981, now), now, MV_TZ, 'en-US')).toBe('Not updated since Nov 16, 3:25 AM PST.');
  });
  it('no read: "No data yet."', () => {
    expect(trafficStaleLead({ kind: 'none' }, new Date(), MV_TZ, 'en-US')).toBe('No data yet.');
  });
  it('a fresh read has no line', () => {
    const now = new Date('2026-11-16T20:00:00Z');
    expect(trafficStaleLead(trafficReadState(RUN_14981, now), now, MV_TZ, 'en-US')).toBeNull();
  });
  it('the clock is the finish, floored to the minute (11:25:00.759 -> 3:25)', () => {
    expect(trafficReadClock(RUN_14981.finished_at, new Date('2026-11-16T20:00:00Z'), MV_TZ, 'en-US')).toBe('3:25 AM PST');
  });
});

describe('closure or incident (one rule: lib/traffic.ts trafficKind)', () => {
  it('#4648: a CDOT crash whose message says a lane is closed is an incident, though its severity is "closure"', () => {
    expect(BF['4648'].severity).toBe('closure');
    expect(trafficKind(BF['4648'])).toBe('incident');
    expect(trafficLabelKey(BF['4648'])).toBe('incident');
  });
  it('#4622: a CHP collision whose log mentions a closure is an incident, though its severity is "closure"', () => {
    expect(MV['4622'].severity).toBe('closure');
    expect(trafficKind(MV['4622'])).toBe('incident');
    expect(trafficLabelKey(MV['4622'])).toBe('incident');
  });
  it('#4448 and #4449 (Caltrans lane closures) are still closures', () => {
    for (const r of [MV['4448'], MV['4449']]) {
      expect(trafficKind(r)).toBe('closure');
      expect(trafficLabelKey(r)).toBe('closure');
    }
  });
  it('CDOT road work (#4538 Maintenance Operations) is a closure; an injury crash (#4537) keeps its injury label', () => {
    expect(trafficKind(BF['4538'])).toBe('closure');
    expect(trafficLabelKey(BF['4537'])).toBe('injury');
  });
  it('"planned" refines a closure only (#4449 with severity planned; #4648 with severity planned stays an incident)', () => {
    expect(trafficLabelKey({ ...MV['4449'], severity: 'planned' })).toBe('planned');
    expect(trafficLabelKey({ ...BF['4648'], severity: 'planned' })).toBe('incident');
  });
  it('"Last listed" keeps the closures: #4448, #4449 stay, #4648 and #4622 go', () => {
    expect(lastListedRows([MV['4448'], BF['4648'], MV['4449'], MV['4622']])).toEqual([MV['4448'], MV['4449']]);
  });
  it('the hero counts #4622 as an incident: "1 closure, 1 incident"', () => {
    const h = trafficHero({ current: [MV['4448'], MV['4622']], earlierCount: 0, readAt: RUN_14981.finished_at, readIsStale: false,
      now: new Date('2026-11-16T20:00:00Z'), tz: MV_TZ, locale: 'en-US', scope: 'state highways', cityName: 'Moreno Valley' });
    expect(h!.sub).toBe('1 closure, 1 incident on state highways in and near Moreno Valley');
  });
});
