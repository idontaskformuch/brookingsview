import { describe, expect, it } from 'vitest';
import { clubRows } from './club-games';
import type { ClubGame } from './db';

const game = (over: Partial<ClubGame>): ClubGame => ({
  id: 1, sport: 'hockey', gender: null, startAt: new Date('2026-11-12T01:30:00Z'), tz: 'America/Chicago', status: 'scheduled', timeTba: false,
  neutralSite: false, exhibition: false, venue: 'Larson Ice Center', homeProgramId: 'sdsu-club-hockey', homeName: null, awayProgramId: null,
  awayName: 'Augustana', scoreHome: null, scoreAway: null, url: 'https://visitbrookingssd.com/event/x/', ...over,
});
const P = 'sdsu-club-hockey';

describe('clubRows', () => {
  it('lists upcoming and in-progress games with the link back, soonest first as given', () => {
    const rows = clubRows([game({}), game({ id: 2, startAt: new Date('2026-11-21T20:00:00Z'), awayName: 'Creighton' })], P, new Date('2026-11-08T12:00:00Z'));
    expect(rows.map((r) => [r.prefix, r.opponent, r.venue, r.url])).toEqual([
      ['vs', 'Augustana', 'Larson Ice Center', 'https://visitbrookingssd.com/event/x/'],
      ['vs', 'Creighton', 'Larson Ice Center', 'https://visitbrookingssd.com/event/x/'],
    ]);
    expect(clubRows([game({})], P, new Date('2026-11-12T02:00:00Z'))[0].phase).toBe('inProgress');
  });
  it('drops a game that is over: no result exists in this feed, so nothing to show', () => {
    expect(clubRows([game({})], P, new Date('2026-11-12T06:30:00Z'))).toEqual([]); // past the window, same local day: pending
    expect(clubRows([game({})], P, new Date('2026-11-14T00:00:00Z'))).toEqual([]);
  });
  it('an away listing reads "at"; a postponed or cancelled game and a row without an opponent are left out', () => {
    const away = game({ homeProgramId: null, homeName: 'Augustana', awayProgramId: P, awayName: null });
    expect(clubRows([away], P, new Date('2026-11-08T12:00:00Z'))[0]).toMatchObject({ prefix: 'at', opponent: 'Augustana' });
    expect(clubRows([game({ status: 'postponed' }), game({ status: 'cancelled' }), game({ awayName: null })], P, new Date('2026-11-08T12:00:00Z'))).toEqual([]);
  });
});
