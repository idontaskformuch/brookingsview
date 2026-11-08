import { describe, expect, it } from 'vitest';
import { gamesFromEvents, isComing, toGame, upcomingGames } from './sport-games';
import { sportPhase, type SportEventRow } from './sport-events';

const ev = (o: Partial<SportEventRow>): SportEventRow => ({
  id: 1, sport: 'basketball', gender: 'men', startAt: new Date('2026-11-12T01:00:00Z'), tz: 'America/Chicago', status: 'scheduled',
  timeTba: false, exhibition: false, neutralSite: false, venue: 'Brookings, S.D.', scoreHome: null, scoreAway: null,
  homeProgramId: 'sdsu', homeName: null, awayProgramId: null, awayName: 'Opp', ...o,
});
const NOW = new Date('2026-11-08T18:00:00Z');

describe('sport_events as Game rows', () => {
  it('maps team key, side, neutral site, result and the shared phase', () => {
    const home = toGame(ev({ id: 1 }), 'sdsu', NOW);
    expect(home).toMatchObject({ sport: 'mbb', home_away: 'home', opponent: 'Opp', result: null, phase: 'upcoming', exhibition: false, time_tba: false });
    const away = toGame(ev({ id: 2, gender: 'women', homeProgramId: null, homeName: 'Texas', awayProgramId: 'sdsu', awayName: null }), 'sdsu', NOW);
    expect(away).toMatchObject({ sport: 'wbb', home_away: 'away', opponent: 'Texas' });
    expect(toGame(ev({ id: 3, neutralSite: true }), 'sdsu', NOW).home_away).toBe('neutral');
    const done = toGame(ev({ id: 4, status: 'final', scoreHome: 91, scoreAway: 62, exhibition: true, startAt: new Date('2026-10-29T00:00:00Z') }), 'sdsu', NOW);
    expect(done).toMatchObject({ result: 'W 91-62', exhibition: true, phase: 'history' });
  });

  it('uses exactly the phase sportPhase gives for the same event', () => {
    for (const startAt of ['2026-11-08T17:00:00Z', '2026-11-08T12:00:00Z', '2026-11-07T20:00:00Z', '2026-11-20T20:00:00Z']) {
      const e = ev({ startAt: new Date(startAt) });
      expect(toGame(e, 'sdsu', NOW).phase).toBe(sportPhase(e, NOW));
    }
  });

  it('leaves out postponed and cancelled games, keeps scheduled and final', () => {
    const games = gamesFromEvents([ev({ id: 1 }), ev({ id: 2, status: 'postponed' }), ev({ id: 3, status: 'cancelled' }), ev({ id: 4, status: 'final', scoreHome: 1, scoreAway: 0 })], 'sdsu', NOW);
    expect(games.map((g) => g.id).sort()).toEqual([1, 4]);
  });

  it('filters by team key and sorts soonest first', () => {
    const games = gamesFromEvents([
      ev({ id: 1, sport: 'football', gender: 'men', startAt: new Date('2026-11-21T20:00:00Z') }),
      ev({ id: 2, sport: 'football', gender: 'men', startAt: new Date('2026-11-14T19:00:00Z') }),
      ev({ id: 3 }),
    ], 'sdsu', NOW, 'football');
    expect(games.map((g) => g.id)).toEqual([2, 1]);
  });

  it('upcoming = not started or in progress; a finished game without a result is not "next"', () => {
    const inProgress = ev({ id: 1, sport: 'football', startAt: new Date('2026-11-08T17:00:00Z') });
    const pending = ev({ id: 2, sport: 'football', startAt: new Date('2026-11-08T10:00:00Z') });
    const stale = ev({ id: 3, startAt: new Date('2026-11-01T20:00:00Z') });
    const later = ev({ id: 4, startAt: new Date('2026-11-20T20:00:00Z') });
    const tba = ev({ id: 5, timeTba: true, startAt: new Date('2026-11-09T06:00:00Z') });
    const up = upcomingGames([later, stale, pending, inProgress, tba], 'sdsu', NOW, 10);
    expect(up.map((g) => g.id)).toEqual([1, 5, 4]);
    expect(up.every(isComing)).toBe(true);
    expect(upcomingGames([later, inProgress, tba], 'sdsu', NOW, 2).map((g) => g.id)).toEqual([1, 5]);
  });
});
