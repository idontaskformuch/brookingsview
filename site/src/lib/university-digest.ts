/** University digest, template-built (owner 2026-11-18, .claude/specs/us-christmas-2026.md "Beslut steg 2", G5).
 *
 *  sdstate.edu is llm_excluded (GPTBot Disallow: /), so no model writes the digest. The page is built from data only:
 *    1. insight lines (rules below, each with a test in university-digest.test.ts, shown only when the rule fires)
 *    2. Games: sport_events of the program (the source for games; the Athletics rows of the SDSU calendar are left out, they
 *       repeat the same games)
 *    3. Open to the public: SDSU calendar rows in the arts_culture bucket
 *    4. Campus calendar: bucket university without Athletics
 *    5. Academic dates: the week, plus the 7 days after it
 *  Pure: the page passes rows + the week + `now`; no database here. */
import type { AcademicDate, Game, SdsuEvent } from './db';
import { teamLabel } from './jackrabbits-view';
import { isComing } from './sport-games';
import { formatClockCompact } from './country-profile';

/** Academic dates starting up to this many days after the digest week still get a line ("Thanksgiving recess starts Wed Nov 25"). */
export const ACADEMIC_LOOKAHEAD_DAYS = 7;
export const ATHLETICS = 'Athletics';

export type DigestEvent = SdsuEvent & { bucket?: string | null };

export interface DigestInput {
  events: DigestEvent[];
  games: Game[];
  academic: AcademicDate[];
  week: { start: Date; end: Date };
  now: Date;
  timezone: string;
  programName: string; // "Jackrabbits"
}

export interface Digest {
  insights: string[];
  games: Game[];
  open: DigestEvent[];
  campus: DigestEvent[];
  academic: AcademicDate[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Sat Nov 21" in the town's zone. */
export function dayLabel(d: Date, timezone: string): string {
  const f = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: timezone });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.month} ${p.day}`;
}

/** A DATE column ("2026-11-25") as the same calendar day, independent of zone. */
function dateOnly(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}
const dateDay = (s: string) => dayLabel(dateOnly(s), 'UTC');
const ymd = (d: Date, timezone: string) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(d);

/** Same title at the same start = one row (the SDSU calendar lists some events twice, e.g. Master Gardeners 12953 + 228). */
export function dedupeEvents(events: DigestEvent[]): DigestEvent[] {
  const seen = new Set<string>();
  return events.filter((e) => {
    const key = `${e.title.trim().toLowerCase()}|${e.starts_at ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Academic dates that touch the week or start within ACADEMIC_LOOKAHEAD_DAYS after it. */
export function academicInWindow(dates: AcademicDate[], week: { start: Date; end: Date }, timezone: string): AcademicDate[] {
  const first = ymd(week.start, timezone);
  const lastDay = new Date(week.end.getTime() - 1);
  const last = ymd(new Date(lastDay.getTime() + ACADEMIC_LOOKAHEAD_DAYS * 86_400_000), timezone);
  return dates.filter((a) => a.starts_on.slice(0, 10) <= last && (a.ends_on ?? a.starts_on).slice(0, 10) >= first);
}

/** Rule A1: one line per academic date in the window. Single day: "<label>: Wed Nov 25". Range starting in or after the week:
 *  "<label> starts Wed Nov 25". Range that began before the week: "<label> until Sun Nov 29". */
export function academicLine(a: AcademicDate, week: { start: Date }, timezone: string): string {
  const start = a.starts_on.slice(0, 10);
  const end = (a.ends_on ?? a.starts_on).slice(0, 10);
  if (start === end) return `${a.label}: ${dateDay(start)}`;
  return start < ymd(week.start, timezone) ? `${a.label} until ${dateDay(end)}` : `${a.label} starts ${dateDay(start)}`;
}

/** Rule G2: the first home game still to come (not time TBA), as "Next home game: Football vs Indiana State, Sat Nov 21, 2pm". */
export function nextHomeGameLine(games: Game[], timezone: string): string | null {
  const g = games.find((x) => x.home_away === 'home' && isComing(x) && x.starts_at && !x.time_tba);
  if (!g || !g.opponent) return null;
  const at = new Date(g.starts_at as string);
  return `Next home game: ${teamLabel(g.sport)} vs ${g.opponent}, ${dayLabel(at, timezone)}, ${formatClockCompact(at, timezone)}`;
}

export function buildDigest(input: DigestInput): Digest {
  const { week, timezone } = input;
  const inWeek = (iso: string | null) => !!iso && new Date(iso) >= week.start && new Date(iso) < week.end;
  const events = dedupeEvents(input.events.filter((e) => inWeek(e.starts_at)));
  const open = events.filter((e) => e.bucket === 'arts_culture');
  const campus = events.filter((e) => e.bucket === 'university' && e.primary_category !== ATHLETICS);
  const games = input.games.filter((g) => inWeek(g.starts_at));
  const academic = academicInWindow(input.academic, week, timezone);

  const insights: string[] = [];
  // Rule E1: the week's campus events (open + campus calendar), at least one.
  const nEvents = open.length + campus.length;
  if (nEvents > 0) insights.push(`${plural(nEvents, 'campus event')} this week`);
  // Rule G1: the week's games, with how many are at home when at least one is.
  if (games.length > 0) {
    const home = games.filter((g) => g.home_away === 'home').length;
    const tail = home === 0 ? '' : home === games.length ? ', all at home' : `, ${home} at home`;
    insights.push(`${plural(games.length, `${input.programName} game`)}${tail}`);
  }
  // Rule G2: next home game still to come.
  const next = nextHomeGameLine(games, timezone);
  if (next) insights.push(next);
  // Rule A1: academic dates.
  for (const a of academic) insights.push(academicLine(a, week, timezone));

  return { insights, games, open, campus, academic };
}
