/** The rows of a club team's list on /jackrabbits: games that are not over, soonest first, each with the link back to its source.
 *  Phase and window come from lib/sport-events.ts (the one rule); a club program has no record and no results here (its feed has no scores). */
import { isOpen, sportPhase, type SportPhase } from './sport-events';
import type { ClubGame } from './db';

export interface ClubRow { startAt: Date; tz: string; timeTba: boolean; prefix: 'vs' | 'at'; opponent: string; venue: string | null; url: string | null; phase: SportPhase }

export function clubRows(games: ClubGame[], programId: string, now: Date): ClubRow[] {
  const rows: ClubRow[] = [];
  for (const g of games) {
    const phase = sportPhase(g, now);
    if (!isOpen(phase) || phase === 'pending') continue; // a game with no result that is over is not "upcoming"; a club list has no results to show
    const home = g.homeProgramId === programId;
    const opponent = (home ? g.awayName : g.homeName) ?? '';
    if (!opponent) continue;
    rows.push({ startAt: g.startAt, tz: g.tz, timeTba: g.timeTba, prefix: home ? 'vs' : 'at', opponent, venue: g.venue, url: g.url, phase });
  }
  return rows;
}
