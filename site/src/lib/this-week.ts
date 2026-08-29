/**
 * "This Week in <Town>" -- shared logic behind /this-week/[week].astro.
 *
 * Week-boundary math deliberately mirrors ai_pipeline/weekly.py's own
 * week_bounds()/collect(): Monday 00:00 to next Monday 00:00 in the town's
 * OWN timezone, ISO week slug (`2026-w35`), and -- critically -- the same
 * split this codebase has hit and fixed three times now (events.astro's
 * original weekend-bucketing bug, weekly.py's own documented meeting_date
 * fix, the Legistar _date_only_noon_utc() fix): two different kinds of
 * "when" exist in this schema, and they are NEVER interchangeable.
 *
 *   REAL TIMESTAMPS   stories.occurs_at for source_type='event', sports_games
 *                      .starts_at, sdsu_events.starts_at. These carry a true
 *                      instant -- bucket them by the town's LOCAL calendar
 *                      day via localDateParts() (lib/events.ts).
 *
 *   BARE CALENDAR DATES  stories.occurs_at for source_type IN ('meeting',
 *                      'meeting_followup'), project_updates.meeting_date,
 *                      regional_sports_games.game_date. These are stored as
 *                      UTC midnight of a plain calendar date with NO real
 *                      time-of-day (Legistar/CivicEngage only ever give a
 *                      date) -- bucket them by comparing UTC Y/M/D directly,
 *                      NEVER by re-interpreting through a timezone (that's
 *                      exactly the bug: UTC midnight read back in
 *                      America/Chicago lands on the PREVIOUS local day).
 *
 * This is why WeekInfo below carries two separate boundary pairs
 * (start/end for real timestamps, civilStart/civilEnd for bare calendar
 * dates) instead of one.
 */
import type { Story, Game, RegionalGame, SdsuEvent, ProjectUpdate } from './db';
import { calendarDateParts } from './db';
import { localDateParts, utcMidnight, buildEventFeed, itemTitle, itemUrl } from './events';
import { selectWorthKnowing } from './homepage-curation';

export interface DateParts { y: number; m: number; d: number; } // m is 1-12, unlike calendarDateParts()

export function addDays(dp: DateParts, days: number): DateParts {
  const dt = utcMidnight(dp);
  dt.setUTCDate(dt.getUTCDate() + days);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

export function sameDate(a: DateParts, b: DateParts): boolean {
  return a.y === b.y && a.m === b.m && a.d === b.d;
}

/** calendarDateParts() (db.ts) uses 0-indexed months (JS Date convention);
 *  everything in this file uses 1-indexed months (ISO/human convention) --
 *  this is the one seam between the two, kept in one place. */
export function bareDateParts(value: string | Date | null): DateParts | null {
  const parts = calendarDateParts(value);
  if (!parts) return null;
  return { y: parts.y, m: parts.m + 1, d: parts.d };
}

/**
 * Converts a LOCAL wall-clock date (midnight, in `timezone`) to the real UTC
 * instant it represents -- standard two-pass approximation (guess as if the
 * wall time WERE UTC, read back what that guess formats to locally, correct
 * by the difference). Exact for both America/Chicago and America/Los_Angeles
 * at local midnight specifically, since neither ever transitions DST at
 * 00:00 local (both transition at 02:00) -- the single correction pass is
 * therefore not an approximation for this call site, it's exact.
 */
function zonedMidnightToUtc(dp: DateParts, timezone: string): Date {
  const guess = Date.UTC(dp.y, dp.m - 1, dp.d);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const readBack = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return new Date(guess + (guess - readBack));
}

function mondayContaining(instant: Date, timezone: string): DateParts {
  const local = utcMidnight(localDateParts(instant, timezone));
  const daysSinceMonday = (local.getUTCDay() + 6) % 7; // 0=Mon
  const monday = new Date(local.getTime() - daysSinceMonday * 86_400_000);
  return { y: monday.getUTCFullYear(), m: monday.getUTCMonth() + 1, d: monday.getUTCDate() };
}

/** Standard ISO-8601 week/year for a given calendar date (the date's own
 *  weekday doesn't affect correctness -- this file always calls it with a
 *  Monday, matching ai_pipeline/weekly.py's iso_year, iso_week, _ =
 *  monday.isocalendar()). */
export function isoWeekInfo(dp: DateParts): { isoYear: number; isoWeek: number } {
  const date = new Date(Date.UTC(dp.y, dp.m - 1, dp.d));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // nearest Thursday
  const isoYear = date.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4DayNum = (jan4.getUTCDay() + 6) % 7;
  const week1Monday = new Date(jan4.getTime() - jan4DayNum * 86_400_000);
  const isoWeek = Math.round((date.getTime() - week1Monday.getTime()) / (7 * 86_400_000)) + 1;
  return { isoYear, isoWeek };
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "August 24–30, 2026" / "July 28–August 3, 2026" / "December 29, 2025 –
 *  January 4, 2026" -- mirrors weekly.py's own label formatting. */
export function formatWeekLabel(monday: DateParts, sunday: DateParts): string {
  if (monday.y !== sunday.y) {
    return `${MONTH_NAMES[monday.m - 1]} ${monday.d}, ${monday.y} – ${MONTH_NAMES[sunday.m - 1]} ${sunday.d}, ${sunday.y}`;
  }
  if (monday.m !== sunday.m) {
    return `${MONTH_NAMES[monday.m - 1]} ${monday.d}–${MONTH_NAMES[sunday.m - 1]} ${sunday.d}, ${monday.y}`;
  }
  return `${MONTH_NAMES[monday.m - 1]} ${monday.d}–${sunday.d}, ${monday.y}`;
}

export interface WeekInfo {
  monday: DateParts;
  sunday: DateParts;
  /** Real UTC instants of local midnight Monday / local midnight the
   *  following Monday -- the window for REAL-TIMESTAMP fields. */
  start: Date;
  end: Date;
  /** UTC midnight of the same calendar dates, with no timezone conversion
   *  applied -- the window for BARE-CALENDAR-DATE fields (meeting_date-
   *  style). Mirrors weekly.py's own `utc_start = datetime.combine(
   *  start.date(), datetime.min.time(), tzinfo=UTC)`. */
  civilStart: Date;
  civilEnd: Date;
  isoYear: number;
  isoWeek: number;
  /** "2026-w35" -- matches ai_pipeline/weekly.py's slug format exactly. */
  slug: string;
  label: string;
}

function weekInfoFromMonday(monday: DateParts, timezone: string): WeekInfo {
  const sunday = addDays(monday, 6);
  const nextMonday = addDays(monday, 7);
  const { isoYear, isoWeek } = isoWeekInfo(monday);
  return {
    monday,
    sunday,
    start: zonedMidnightToUtc(monday, timezone),
    end: zonedMidnightToUtc(nextMonday, timezone),
    civilStart: utcMidnight(monday),
    civilEnd: utcMidnight(nextMonday),
    isoYear,
    isoWeek,
    slug: `${isoYear}-w${String(isoWeek).padStart(2, '0')}`,
    label: formatWeekLabel(monday, sunday),
  };
}

/** The week containing `instant` (defaults to now), in the town's own
 *  timezone -- used both for "what week is it right now" (the rolling
 *  /this-week/ redirect target) and to place a real 'weekly' story's own
 *  occurs_at into a WeekInfo. */
export function weekInfoForInstant(instant: Date, timezone: string): WeekInfo {
  return weekInfoFromMonday(mondayContaining(instant, timezone), timezone);
}

export function currentWeekInfo(timezone: string): WeekInfo {
  return weekInfoForInstant(new Date(), timezone);
}

/** Reconstructs a WeekInfo purely from its own "2026-w35" slug -- lets
 *  getStaticPaths derive exact boundaries from a URL param with no lookup.
 *  ISO week 1's Monday = the Monday of the week containing January 4
 *  (the ISO-8601 definition), from which every other week is a fixed
 *  7-day offset. */
export function weekInfoForSlug(slug: string, timezone: string): WeekInfo | null {
  const m = /^(\d{4})-w(\d{2})$/.exec(slug);
  if (!m) return null;
  const isoYear = Number(m[1]);
  const isoWeek = Number(m[2]);
  const jan4 = utcMidnight({ y: isoYear, m: 1, d: 4 });
  const jan4DayNum = (jan4.getUTCDay() + 6) % 7;
  const week1Monday = new Date(jan4.getTime() - jan4DayNum * 86_400_000);
  const targetMonday = new Date(week1Monday.getTime() + (isoWeek - 1) * 7 * 86_400_000);
  const monday: DateParts = {
    y: targetMonday.getUTCFullYear(), m: targetMonday.getUTCMonth() + 1, d: targetMonday.getUTCDate(),
  };
  return weekInfoFromMonday(monday, timezone);
}

/** The week immediately before `week` -- for the archive-chain "previous
 *  week" link every page shows (brief: "links to the previous week...
 *  crawlable chain"). The caller decides whether that week actually has a
 *  published page before linking to it (see [week].astro's getStaticPaths)
 *  -- this just does the date math, it doesn't know what pages exist. */
export function previousWeekInfo(week: WeekInfo, timezone: string): WeekInfo {
  return weekInfoFromMonday(addDays(week.monday, -7), timezone);
}

export const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function weekDays(week: WeekInfo): DateParts[] {
  return Array.from({ length: 7 }, (_, i) => addDays(week.monday, i));
}

/* -------------------------------------------------------- day-by-day items */

export type Vertical = 'events' | 'city_hall' | 'sdsu' | 'sports';

/** The owner's sketched editorial rhythm (Mon/Tue=events, Wed=City Hall,
 *  Thu=SDSU, Fri=sports, weekend=events) -- used ONLY to order which
 *  vertical leads a day's section when more than one has real items that
 *  day. It never hides or gates data: a day with nothing in its "default"
 *  vertical still shows whatever it DOES have, and a day with nothing at
 *  all gets an honest one-line note, never a filled-in placeholder. */
const DEFAULT_VERTICAL_BY_WEEKDAY: Vertical[] = ['events', 'events', 'city_hall', 'sdsu', 'sports', 'events', 'events'];

export interface DayItem {
  vertical: Vertical;
  title: string;
  /** Internal story/project page when one exists; external URL for SDSU
   *  (no local page, see artsEventAsStory's own comment); null when neither
   *  applies (a game -- sports_games/regional_sports_games are
   *  deliberately never their own pages, see db.ts's module docstring). */
  href: string | null;
  external: boolean;
  detail: string;
}

export interface DayBucket {
  date: DateParts;
  weekdayName: string;
  leadVertical: Vertical;
  items: DayItem[];
}

function gameHomeAway(g: { home_away: string | null }): string {
  return g.home_away === 'home' ? 'vs' : 'at';
}

/**
 * Builds all 7 days of a week from already-fetched, town-broad data (the
 * same "fetch broad once, filter per page" pattern as Week 2's event-facets
 * -- see lib/events.ts's own module docstring). Events and SDSU items are
 * first run through buildEventFeed() so the SAME cross-source dedup that
 * /events already applies (e.g. "Downtown at Sundown" listed by both SDSU
 * and the Chamber) also applies here -- an item can only ever land on ONE
 * day, under whichever kind buildEventFeed kept as canonical.
 */
export function buildWeekDays(
  week: WeekInfo,
  timezone: string,
  data: {
    eventStories: Story[];
    meetingStories: Story[];
    artsEvents: SdsuEvent[];
    projectUpdates: (ProjectUpdate & { project_slug: string; project_title: string })[];
    games: Game[];
    regionalGames: RegionalGame[];
  },
): DayBucket[] {
  const { items: feedItems } = buildEventFeed(data.eventStories, data.artsEvents, timezone);

  const days = weekDays(week);
  return days.map((date, i) => {
    const items: DayItem[] = [];

    for (const item of feedItems) {
      if (!item.occurs_at) continue;
      if (!sameDate(localDateParts(new Date(item.occurs_at), timezone), date)) continue;
      items.push({
        vertical: item.kind === 'arts' ? 'sdsu' : 'events',
        title: itemTitle(item),
        href: item.kind === 'story' ? `/s/${item.story.slug}/` : itemUrl(item),
        external: item.kind === 'arts',
        detail: item.kind === 'story' ? firstLine(item.story.body) : (item.event.teaser ?? ''),
      });
    }

    for (const meeting of data.meetingStories) {
      const md = bareDateParts(meeting.occurs_at);
      if (!md || !sameDate(md, date)) continue;
      items.push({
        vertical: 'city_hall', title: meeting.title, href: `/s/${meeting.slug}/`,
        external: false, detail: firstLine(meeting.body),
      });
    }

    for (const update of data.projectUpdates) {
      const md = bareDateParts(update.meeting_date);
      if (!md || !sameDate(md, date)) continue;
      items.push({
        vertical: 'city_hall', title: `${update.project_title} — ${update.agenda_title}`,
        href: `/city-hall/projects/${update.project_slug}/`, external: false,
        detail: firstLine(update.body ?? ''),
      });
    }

    for (const game of data.games) {
      if (!game.starts_at) continue;
      if (!sameDate(localDateParts(new Date(game.starts_at), timezone), date)) continue;
      items.push({
        vertical: 'sports', title: `${game.sport} ${gameHomeAway(game)} ${game.opponent}`,
        href: '/jackrabbits/', external: false,
        detail: game.result ?? (game.venue ?? ''),
      });
    }

    for (const game of data.regionalGames) {
      const gd = bareDateParts(game.game_date);
      if (!gd || !sameDate(gd, date)) continue;
      const score = game.team_score != null && game.opponent_score != null
        ? `${game.team_score}–${game.opponent_score}` : null;
      items.push({
        vertical: 'sports', title: `${game.team_name} ${gameHomeAway(game)} ${game.opponent_name}`,
        href: '/sports/', external: false,
        detail: score ?? (game.status === 'scheduled' ? (game.venue ?? '') : game.status),
      });
    }

    const leadVertical = DEFAULT_VERTICAL_BY_WEEKDAY[i];
    items.sort((a, b) => {
      if (a.vertical === b.vertical) return 0;
      if (a.vertical === leadVertical) return -1;
      if (b.vertical === leadVertical) return 1;
      return 0;
    });

    return { date, weekdayName: WEEKDAY_NAMES[i], leadVertical, items };
  });
}

function firstLine(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return '';
  const [first] = trimmed.split(/(?<=[.!?])\s+/);
  return first;
}

/** Adapts homepage-curation.ts's selectWorthKnowing() (the "P5 significance
 *  logic" the brief asks to reuse) to pick ONE lead item for a whole week
 *  instead of the homepage's rolling 24h window -- same featured-first,
 *  theme-collision-safe selection, just fed week-scoped candidates instead
 *  of the homepage's -24h candidate query. Returns null on a genuinely
 *  quiet week rather than forcing a pick -- never fabricate significance. */
export function selectWeeklyLead(candidates: Story[]): Story | null {
  return selectWorthKnowing(candidates, new Set(), [], 1)[0] ?? null;
}
