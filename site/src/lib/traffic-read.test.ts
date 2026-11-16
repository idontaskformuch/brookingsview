import { describe, expect, it } from 'vitest';
import { TRAFFIC_LAST_LISTED_MAX_DAYS, lastListedRows, trafficReadState, trafficStaleLead } from './traffic-read';
import { TRAFFIC_READ_MAX_AGE_HOURS } from './traffic-verdict';
import { trafficReadClock } from './traffic-hero';

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

describe('"Last listed" rows', () => {
  it('keeps closure and planned, drops incident and injury', () => {
    // Severities of real rows #4448, #4638, #4565; no stored row has 'planned' yet, so the fourth is #4449 with severity changed to it.
    const rows = [{ severity: 'closure', id: 4448 }, { severity: 'incident', id: 4638 }, { severity: 'injury', id: 4565 }, { severity: 'planned', id: 4449 }];
    expect(lastListedRows(rows).map((r) => r.id)).toEqual([4448, 4449]);
  });
});
