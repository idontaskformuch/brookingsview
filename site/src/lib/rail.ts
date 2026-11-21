/** Which rail modules render, in which order (Fas 2). Pure, so the rules are tested without a database.
 *  - A module renders only when it has data (`available`); a module without data is hidden, never an empty box.
 *  - The configured modules come first, in config order. The reserve order then fills in, one module at a time, only while the estimated
 *    rail height is below the main column's first screen (RAIL_FIRST_SCREEN_REM). Heights are estimates per kind, in rem, checked against
 *    the review shots at 1440; they decide only whether a reserve module is needed.
 *  - The ad slot sits after the configured module number, counted among the modules actually shown; past the end it is dropped. */
import type { RailConfig, RailModuleKind } from '../config/home-rail';
import type { MeetingView } from './meetings-view';
import { daysBetween } from './meetings-view';
import type { FrontPageHoliday } from './front-page';
import { OFF_SEASON_DAYS, ymd } from './sports-season';

export const RAIL_HEIGHT_REM: Record<RailModuleKind | 'status', number> = {
  status: 16, meeting: 8, holiday: 10, sport: 9, numbers: 14, weather: 9, traffic: 9, workplace: 7, markets: 10, play: 5, burro_bonanza: 5,
  meetings_more: 12, weather_today: 5, open_now: 10, shows_weekend: 14, closure_status: 5,
};
/** The main column's first screen at 1440x900 below the masthead, in rem (900 px minus the ~13rem masthead and section nav, rounded down). */
export const RAIL_FIRST_SCREEN_REM = 42;

export interface RailPlan { modules: RailModuleKind[]; adAfter: number | null }

export function planRail(cfg: RailConfig, available: Partial<Record<RailModuleKind, boolean>>, opts: { withStatus?: boolean } = {}): RailPlan {
  const has = (k: RailModuleKind) => available[k] === true;
  const modules = cfg.modules.filter(has);
  let height = (opts.withStatus ? RAIL_HEIGHT_REM.status : 0) + modules.reduce((s, k) => s + RAIL_HEIGHT_REM[k], 0);
  for (const k of cfg.reserve) {
    if (height >= RAIL_FIRST_SCREEN_REM) break;
    if (!has(k) || modules.includes(k)) continue;
    modules.push(k);
    height += RAIL_HEIGHT_REM[k];
  }
  const after = cfg.adSlot?.afterModule;
  return { modules, adAfter: after !== undefined && after >= 1 && after <= modules.length ? after : null };
}

// ---- module data rules (each one tested) ----

/** The meeting a resident can attend: not cancelled, postponed, closed, a quorum notice or folded into a group. */
const attendable = (m: MeetingView) => !m.quorumNotice && !m.cancelled && !m.postponed && !m.closed && !m.collapsedGroup;
/** How far ahead the rail looks for a meeting. */
export const RAIL_MEETING_DAYS = 45;
export const RAIL_MORE_MEETINGS = 3;

/** The next meeting (the `meeting` module) and the ones after it (the `meetings_more` reserve). Meetings already featured elsewhere on
 *  the page (`exclude`) are skipped. */
export function railMeetings(ms: MeetingView[], todayYmd: string, exclude: Set<string> = new Set()): { next: MeetingView | null; more: MeetingView[] } {
  const ok = ms.filter((m) => attendable(m) && !exclude.has(String(m.id)) && daysBetween(todayYmd, m.ymd) >= 0 && daysBetween(todayYmd, m.ymd) <= RAIL_MEETING_DAYS);
  return { next: ok[0] ?? null, more: ok.slice(1, 1 + RAIL_MORE_MEETINGS) };
}

/** How far ahead the rail shows a holiday page. */
export const RAIL_HOLIDAY_DAYS = 60;
/** The next holiday page from today (local day number), within RAIL_HOLIDAY_DAYS, that the page does not already show (`excludeSlugs`:
 *  the front page's holiday lead/secondary, or the holiday page itself). Only the pages themselves, not their extra front-page posts. */
export function nextRailHoliday(holidays: FrontPageHoliday[], today: number, excludeSlugs: Set<string> = new Set()): (FrontPageHoliday & { daysAway: number }) | null {
  const next = holidays
    .filter((h) => !h.window && !h.slug.includes('#') && !excludeSlugs.has(h.slug))
    .map((h) => ({ ...h, daysAway: h.day - today }))
    .filter((h) => h.daysAway >= 0 && h.daysAway <= RAIL_HOLIDAY_DAYS)
    .sort((a, b) => a.daysAway - b.daysAway);
  return next[0] ?? null;
}

/** The latest final with a score, played at most `maxDays` before `todayYmd` (the town's date): an off-season team's last result from
 *  months ago is not news (lib/sports-season.ts OFF_SEASON_DAYS). */
export function latestFinal<T extends { status: string; game_date: string | Date | null; team_score: number | null; opponent_score: number | null }>(
  games: T[], todayYmd: string, maxDays = OFF_SEASON_DAYS,
): T | null {
  // DATE column: a string or a local-midnight Date from the driver; ymd() reads either without a zone shift.
  const t = (g: T) => Date.parse(`${ymd(g.game_date as string | Date)}T00:00:00Z`);
  const today = Date.parse(`${todayYmd}T00:00:00Z`);
  return games
    .filter((g) => g.status === 'final' && g.team_score !== null && g.opponent_score !== null && g.game_date && !Number.isNaN(t(g)))
    .filter((g) => t(g) <= today + 86_400_000 && (today - t(g)) / 86_400_000 <= maxDays)
    .sort((a, b) => t(b) - t(a))[0] ?? null;
}

/** "W 4-1" / "L 0-2" / "D 1-1" (UK) or "T 1-1" (US). */
export function scoreLine(ours: number, theirs: number, drawLetter: 'D' | 'T'): string {
  return `${ours > theirs ? 'W' : ours < theirs ? 'L' : drawLetter} ${ours}-${theirs}`;
}

/** Days shown by the weather module. One more than shown ships, so the browser can drop a day that has passed since the build. */
export const RAIL_WEATHER_DAYS = 3;
