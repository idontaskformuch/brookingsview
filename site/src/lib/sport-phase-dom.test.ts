import { describe, expect, it } from 'vitest';
import { sportPhase } from './sport-events';
import { cardText, eventOf, pickNext, updateFor, type RowData } from './sport-phase-dom';
import { sportDurationHours } from './sports-registry.generated';
import { sportTerms } from './sport-strings';

const row = (o: Partial<RowData> = {}): RowData => ({ sport: 'football', start: '2026-11-07T19:00:00Z', tz: 'America/Chicago', status: 'scheduled', tba: '0', result: '0', section: 'schedule', ...o });
const at = (iso: string) => new Date(iso);

describe('browser phase update', () => {
  it('walks upcoming -> in progress -> result pending -> history on one row (football 3.5 h, Central)', () => {
    const phases = ['2026-11-07T18:00:00Z', '2026-11-07T20:00:00Z', '2026-11-07T23:30:00Z', '2026-11-08T07:00:00Z'].map((t) => updateFor(row(), at(t))!);
    expect(phases.map((u) => u.phase)).toEqual(['upcoming', 'inProgress', 'pending', 'history']);
    expect(phases.map((u) => u.note)).toEqual([null, 'in_progress', 'result_pending', 'no_result']);
    expect(phases.map((u) => u.toResults)).toEqual([false, false, false, true]);
  });
  it('uses the very same rule as the build: every phase matches sportPhase on the same event', () => {
    for (const sport of ['football', 'basketball', 'volleyball', 'golf']) {
      for (const tba of ['0', '1']) {
        for (const t of ['2026-11-07T10:00:00Z', '2026-11-07T19:30:00Z', '2026-11-07T21:45:00Z', '2026-11-07T23:10:00Z', '2026-11-08T05:30:00Z', '2026-11-08T06:30:00Z']) {
          const d = row({ sport, tba });
          expect(updateFor(d, at(t))!.phase).toBe(sportPhase(eventOf(d)!, at(t)));
        }
      }
    }
  });
  it('takes the window from the one registry (config/sports.json), not from the page', () => {
    expect(sportDurationHours('football')).toBe(3.5);
    expect(updateFor(row({ sport: 'basketball' }), at('2026-11-07T21:45:00Z'))!.phase).toBe('pending'); // 2.75 h > 2.5 h
    expect(updateFor(row({ sport: 'golf' }), at('2026-11-07T22:45:00Z'))!.phase).toBe('inProgress'); // 3.75 h < default 4 h
  });
  it('a time_tba row is never in progress', () => {
    expect(updateFor(row({ tba: '1', start: '2026-11-28T06:00:00Z' }), at('2026-11-28T18:00:00Z'))!.phase).toBe('upcoming');
  });
  it('a row with a result keeps it (no note); a postponed row keeps its word', () => {
    expect(updateFor(row({ status: 'final', result: '1' }), at('2026-11-09T12:00:00Z'))!.note).toBeNull();
    expect(updateFor(row({ status: 'postponed' }), at('2026-11-09T12:00:00Z'))!.note).toBe('postponed');
  });
  it('ignores a row it cannot read', () => {
    expect(updateFor({}, at('2026-11-09T12:00:00Z'))).toBeNull();
    expect(updateFor(row({ start: 'garbage' }), at('2026-11-09T12:00:00Z'))).toBeNull();
  });
  it('every note key the script can write exists in both countries\' strings', () => {
    for (const c of ['us', 'gb']) for (const k of ['in_progress', 'result_pending', 'no_result', 'postponed', 'cancelled']) expect((sportTerms(c) as Record<string, string>)[k]).toBeTruthy();
  });
});

describe('Next up swaps to the next game still to come', () => {
  const g = (o: Partial<RowData>): RowData => ({
    ...row(), label: "Women's basketball", prefix: 'at', opp: 'Texas', venue: 'Austin, Texas', date: 'Wed, November 11', clock: '6:00 PM', neutral: '0', exh: '0', ...o,
  });
  const texas = g({ sport: 'basketball', start: '2026-11-12T00:00:00Z' });
  const stl = g({ sport: 'basketball', start: '2026-11-14T20:00:00Z', opp: 'Saint Louis', prefix: 'vs', date: 'Sat, November 14', clock: '2:00 PM' });
  const later = g({ sport: 'basketball', start: '2026-11-28T20:30:00Z', opp: 'Kentucky', neutral: '1', date: 'Sat, November 28', clock: '2:30 PM' });
  const rows = [later, stl, texas]; // DOM order does not matter
  const T = sportTerms('us') as unknown as Record<string, string>;

  it('picks the earliest upcoming game', () => {
    expect(pickNext(rows, at('2026-11-10T12:00:00Z'))).toBe(2);
  });
  it('keeps a game in progress as the next one', () => {
    expect(pickNext(rows, at('2026-11-12T01:00:00Z'))).toBe(2);
    expect(cardText(texas, 'inProgress', T).tag).toBe('In progress');
  });
  it('moves on to the next game once that one is over', () => {
    expect(pickNext(rows, at('2026-11-12T12:00:00Z'))).toBe(1); // Texas is history, Saint Louis is next
    expect(pickNext(rows, at('2026-11-15T12:00:00Z'))).toBe(0);
  });
  it('a game that is over but whose result is still pending is not "next"', () => {
    expect(pickNext([texas], at('2026-11-12T04:00:00Z'))).toBeNull(); // 2.5 h window over, same local day
  });
  it('hides only when nothing is left to come', () => {
    expect(pickNext(rows, at('2026-12-31T12:00:00Z'))).toBeNull();
    expect(pickNext([], at('2026-11-10T12:00:00Z'))).toBeNull();
  });
  it('card text: home/away/neutral kicker, exhibition tag, TBA instead of a clock time', () => {
    expect(cardText(stl, 'upcoming', T)).toMatchObject({ kicker: "Home · women's basketball", prefix: 'vs', opponent: 'Saint Louis', tag: '', when: 'Sat, November 14 · 2:00 PM' });
    expect(cardText(later, 'upcoming', T).kicker).toBe("Neutral site · women's basketball");
    expect(cardText(g({ exh: '1' }), 'upcoming', T).tag).toBe('Exhibition');
    expect(cardText(g({ tba: '1', clock: '' }), 'upcoming', T).when).toBe('Wed, November 11 · TBA');
  });
});
