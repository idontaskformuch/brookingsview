/** What /sports shows when the pro seasons are over (owner decision 2026-11-11):
 *  - no game scheduled or live in the next 14 days -> an off-season status line (with the next game's date, if the feed has one);
 *  - only the latest weekly recap, with its age; the older ones are folded away;
 *  - each team's table: every game still to come, plus the last 10 finished ones; the rest is folded away. */
import { daysBetween } from './election';

export const OFF_SEASON_DAYS = 14;
export const KEEP_FINALS = 10;

export interface SeasonGame {
  /** The driver gives a YYYY-MM-DD string or a Date built from local y/m/d (see db.ts formatCalendarDate). */
  game_date: string | Date | null;
  status: string;
  team_name: string;
  opponent_name: string;
  home_away: string | null;
}

/** YYYY-MM-DD for either shape of game_date. */
export function ymd(value: string | Date): string {
  if (typeof value === 'string') return value.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

const isOpen = (g: SeasonGame) => g.status === 'scheduled' || g.status === 'live';

/** The first game (by date) that is still to be played, from `today` on; null when the feed has none. */
export function nextOpenGame<T extends SeasonGame>(games: T[], today: string): T | null {
  const open = games.filter((g) => isOpen(g) && g.game_date && daysBetween(today, ymd(g.game_date)) >= 0);
  open.sort((a, b) => ymd(a.game_date!).localeCompare(ymd(b.game_date!)));
  return open[0] ?? null;
}

/** Off-season = no scheduled or live game in the next `days` days (today included). `next` is the first game after that, if any. */
export function seasonStatus<T extends SeasonGame>(games: T[], today: string, days = OFF_SEASON_DAYS): { offSeason: boolean; next: T | null } {
  const next = nextOpenGame(games, today);
  const offSeason = !next || daysBetween(today, ymd(next.game_date!)) > days;
  return { offSeason, next };
}

/** "today", "yesterday", "5 days ago", "3 weeks ago", "2 months ago" for a past calendar date. */
export function ageLabel(today: string, date: string): string {
  const d = -daysBetween(today, date.slice(0, 10));
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 14) return `${d} days ago`;
  if (d < 60) return `${Math.floor(d / 7)} weeks ago`;
  return `${Math.floor(d / 30)} months ago`;
}

/** One team's games, in date order: `shown` = everything not yet finished + the last `keepFinals` finished games; `earlier` = the older finished ones. */
export function splitTeamGames<T extends SeasonGame>(games: T[], keepFinals = KEEP_FINALS): { shown: T[]; earlier: T[] } {
  const finals = games.filter((g) => g.status === 'final');
  const older = new Set(finals.slice(0, Math.max(0, finals.length - keepFinals)));
  return { shown: games.filter((g) => !older.has(g)), earlier: games.filter((g) => older.has(g)) };
}
