/** sport_events seen through the older `Game` shape, for the pages that list games next to other things (front page, sign strip,
 *  /this-week/, /game-day/). It decides nothing itself: phase, season, exhibition and the result line all come from lib/sport-events.ts
 *  (through jackrabbits-view's toRow), the same rule /jackrabbits uses. Pure, so it is testable without a database. */
import type { Game } from './db';
import { teamKey, toRow } from './jackrabbits-view';
import { type SportEventRow } from './sport-events';

/** `home_away`: 'home' / 'away' from the program's side; 'neutral' when the row is flagged neutral_site. */
export function toGame(ev: SportEventRow, programId: string, now: Date): Game {
  const row = toRow(ev, programId, now);
  return {
    id: ev.id,
    sport: teamKey(ev),
    opponent: row.opponent,
    home_away: ev.neutralSite ? 'neutral' : row.prefix === 'at' ? 'away' : 'home',
    starts_at: ev.startAt.toISOString(),
    venue: ev.venue,
    result: row.result,
    time_tba: ev.timeTba,
    exhibition: ev.exhibition,
    phase: row.phase,
  };
}

/** Games a page may list as scheduled or final. A postponed or cancelled game is left out: nothing here can say when (or whether) it is played. */
export function gamesFromEvents(events: SportEventRow[], programId: string, now: Date, sport?: string): Game[] {
  return events
    .filter((ev) => ev.status === 'scheduled' || ev.status === 'final')
    .map((ev) => toGame(ev, programId, now))
    .filter((g) => !sport || g.sport === sport)
    .sort((a, b) => (a.starts_at as string).localeCompare(b.starts_at as string) || a.id - b.id);
}

/** Not over and with a result still to come: upcoming or in progress (what /jackrabbits calls "Next up"). */
export const isComing = (g: Pick<Game, 'phase'>): boolean => g.phase === 'upcoming' || g.phase === 'inProgress';

export function upcomingGames(events: SportEventRow[], programId: string, now: Date, limit: number): Game[] {
  return gamesFromEvents(events, programId, now).filter(isComing).slice(0, limit);
}
