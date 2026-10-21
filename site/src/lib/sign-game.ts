/** Which game the sign strip names, and how it words it.
 *
 *  The strip used to show the first row of sports_games whatever the sport, so a
 *  Friday volleyball match beat Saturday's Hobo Day football game, and the text
 *  never said which sport ("Jacks vs South Dakota"). Now:
 *   1. a football game within the next 7 calendar days wins (the town's main
 *      draw), preferring a home game;
 *   2. otherwise the nearest HOME game within 7 days;
 *   3. otherwise simply the next game.
 *  "Days" are calendar days in the town's timezone, never 24-hour blocks and never
 *  the build machine's zone. Pure, so it is tested with a fake clock. */
import { localDayNumber } from './local-day';

export interface SignGame {
  sport: string;
  opponent: string;
  home_away: string | null;
  starts_at: string | null;
}

export const SIGN_LOOKAHEAD_DAYS = 7;

const SPORT_LABEL: Record<string, string> = {
  football: 'football',
  volleyball: 'volleyball',
  mbb: "men's basketball",
  wbb: "women's basketball",
};

export function sportLabel(sport: string): string {
  return SPORT_LABEL[sport] ?? sport.replace(/_/g, ' ');
}

/** "South Dakota" is the rival USD here, not the state; drop "No. 3 " ranks. */
export function opponentLabel(opponent: string): string {
  const name = opponent.replace(/^No\.\s*\d+\s+/i, '').trim();
  return name === 'South Dakota' ? 'USD' : name;
}

/** "Jacks volleyball vs USD" / "Jacks football at Northern Iowa". */
export function signGameText(g: SignGame): string {
  const prep = g.home_away === 'away' ? 'at' : 'vs';
  return `Jacks ${sportLabel(g.sport)} ${prep} ${opponentLabel(g.opponent)}`;
}

export function pickSignGame<T extends SignGame>(games: T[], now: Date, timezone: string): T | null {
  const upcoming = games
    .filter((g) => g.starts_at && new Date(g.starts_at).getTime() >= now.getTime())
    .sort((a, b) => new Date(a.starts_at as string).getTime() - new Date(b.starts_at as string).getTime());
  if (upcoming.length === 0) return null;
  const today = localDayNumber(now, timezone);
  const soon = upcoming.filter((g) => localDayNumber(new Date(g.starts_at as string), timezone) - today <= SIGN_LOOKAHEAD_DAYS);
  const football = soon.filter((g) => g.sport === 'football');
  if (football.length > 0) return football.find((g) => g.home_away === 'home') ?? football[0];
  return soon.find((g) => g.home_away === 'home') ?? upcoming[0];
}
