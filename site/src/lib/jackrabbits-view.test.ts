import { describe, expect, it } from 'vitest';
import { buildGroups, nextUp, recordText, teamKey } from './jackrabbits-view';
import type { SportEventRow } from './sport-events';

const ev = (o: Partial<SportEventRow>): SportEventRow => ({
  id: 1, sport: 'basketball', gender: 'women', startAt: new Date('2026-10-29T00:00:00Z'), tz: 'America/Chicago', status: 'scheduled',
  timeTba: false, exhibition: false, neutralSite: false, venue: 'Brookings, S.D.', scoreHome: null, scoreAway: null,
  homeProgramId: 'sdsu', homeName: null, awayProgramId: null, awayName: 'Opp', ...o,
});
const NOW = new Date('2026-11-08T18:00:00Z');

describe('jackrabbits view', () => {
  const stCloud = ev({ id: 1, status: 'final', exhibition: true, scoreHome: 91, scoreAway: 62, awayName: 'St. Cloud State', startAt: new Date('2026-10-29T00:00:00Z') });
  const win = ev({ id: 2, status: 'final', scoreHome: 80, scoreAway: 70, awayName: 'Denver', startAt: new Date('2026-11-04T01:00:00Z') });
  const loss = ev({ id: 3, status: 'final', homeProgramId: null, homeName: 'Omaha', awayProgramId: 'sdsu', awayName: null, scoreHome: 70, scoreAway: 60, startAt: new Date('2026-11-06T01:00:00Z') });
  const next = ev({ id: 4, awayName: 'Kentucky', startAt: new Date('2026-11-28T20:30:00Z') });
  const tba = ev({ id: 5, awayName: 'Showcase', timeTba: true, startAt: new Date('2026-11-26T06:00:00Z') });
  const stale = ev({ id: 6, awayName: 'Never listed', startAt: new Date('2026-08-21T23:00:00Z') });
  const groups = buildGroups([stCloud, win, loss, next, tba, stale], 'sdsu', NOW);

  it('maps basketball by gender to the keys the season summaries use', () => {
    expect(teamKey({ sport: 'basketball', gender: 'women' })).toBe('wbb');
    expect(teamKey({ sport: 'basketball', gender: 'men' })).toBe('mbb');
    expect(teamKey({ sport: 'football', gender: 'men' })).toBe('football');
  });
  it('shows the exhibition result with its tag but leaves it out of the record', () => {
    const g = groups[0];
    const row = g.results.find((r) => r.id === 1)!;
    expect(row.result).toBe('W 91-62');
    expect(row.exhibition).toBe(true);
    expect(g.record).toEqual({ wins: 1, losses: 1, ties: 0 });
    expect(recordText(g.record!)).toBe('1–1');
    expect(g.hasExhibition).toBe(true);
  });
  it('results newest first, schedule soonest first, a past scheduled row is history (never upcoming)', () => {
    const g = groups[0];
    expect(g.results.map((r) => r.id)).toEqual([3, 2, 1, 6]);
    expect(g.schedule.map((r) => r.id)).toEqual([5, 4]);
    expect(g.results.find((r) => r.id === 6)!.note).toBe('no_result');
  });
  it('uses "at" for away games and the other side as opponent', () => {
    const row = groups[0].results.find((r) => r.id === 3)!;
    expect(row.prefix).toBe('at');
    expect(row.opponent).toBe('Omaha');
    expect(row.result).toBe('L 60-70'); // our 60, their 70
  });
  it('time_tba rows are flagged so no clock time is shown', () => {
    expect(groups[0].schedule.find((r) => r.id === 5)!.timeTba).toBe(true);
  });
  it('next up is the earliest game still to come, never a pending one', () => {
    expect(nextUp(groups)!.row.id).toBe(5);
    const pendingOnly = buildGroups([ev({ id: 9, startAt: new Date('2026-11-08T12:00:00Z') })], 'sdsu', new Date('2026-11-08T18:00:00Z'));
    expect(pendingOnly[0].schedule[0].note).toBe('result_pending');
    expect(nextUp(pendingOnly)).toBeNull();
  });
  it('a game under way says "In progress" and is the next up', () => {
    const g = buildGroups([ev({ id: 7, startAt: new Date('2026-11-08T17:00:00Z') })], 'sdsu', NOW);
    expect(g[0].schedule[0].note).toBe('in_progress');
    expect(nextUp(g)!.row.id).toBe(7);
  });
});
