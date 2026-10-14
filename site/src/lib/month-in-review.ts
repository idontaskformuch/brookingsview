/** Phase 8 ("Month in <Town>") -- build-time, no-AI monthly recap. Six
 *  structured-data modules (decisions, projects, home sales, events,
 *  traffic, jobs), each independently gated on whether its SOURCE actually
 *  covered the whole target month -- see .claude/phase8-research.md for
 *  the full data audit this is built from and owner approval's 8 numbered
 *  conditions (.claude/state.md).
 *
 *  COVERAGE RULE (owner condition 1): a module renders real numbers for a
 *  month only if its source was already active for the WHOLE month.
 *  Implemented uniformly for five of the six modules (decisions, projects,
 *  events, traffic, jobs) as: compare the EARLIEST row ever recorded for
 *  this town+module (its global "first seen" floor) against the target
 *  month's start --
 *    floor < monthStart         -> 'full'    (source was already running)
 *    monthStart <= floor < end  -> 'partial' (this IS the source's start
 *                                   month -- show the real, partial count,
 *                                   disclosed via "(data from <date>)")
 *    floor >= monthEnd, or null -> 'none'    (nothing yet -- module omitted)
 *  Home sales is the one deliberate exception -- see buildSalesModule()'s
 *  own comment for why a generic floor-date rule doesn't fit a quarterly,
 *  occasionally-gappy county import the way it fits an always-on scraper.
 *
 *  'full' and 'partial' both count as "this module cleared" for owner
 *  condition 7's >=4-of-6 noindex gate -- a scraper's own first, partial
 *  month still clears the bar (matches the research file's own worked Aug
 *  2026 example, where traffic/jobs are both counted ✅ despite probably
 *  starting mid-month).
 */
import {
  TOWN_ID,
  getMeetingDecisionsInMonth, getMeetingDecisionsFirstEverDate,
  getProjectUpdatesInMonth, getProjectUpdatesFirstEntryDate,
  getPropertySalesInMonth, getMostRecentPropertySaleDate,
  getContentByType, getEarliestPublishedDate,
  getTrafficIncidentsFirstSeenInMonth, getTrafficIncidentsFirstEverSeen,
  getJobsFirstScrapedInMonth, getJobsFirstEverScraped,
  getFacilities, formatPrice, calendarDateParts,
} from './db';
import { classifyTrafficIncident } from './traffic';
import { jobZone } from './jobs';
import { classifyEventLocality, localDateParts, type FeedItem } from './events';
import { isOutlierSale } from './home-sales';

export type ModuleStatus = 'full' | 'partial' | 'none';

/** Earliest month each town's own data clears owner condition 7's >=4-of-6
 *  noindex gate -- see .claude/phase8-research.md section 1. Pages are
 *  never generated for an earlier month: before this, at most 2 of 6
 *  modules have anything real to show (property_sales' own Jan 2024 floor
 *  would otherwise drag the hub back through 2.5 years of near-empty
 *  noindexed stub pages for no reader benefit -- the same "low value
 *  content" reasoning already applied sitewide, see astro.config.mjs's
 *  MIN_TAG_PAGE_ITEMS). Add an entry here -- never move Moreno Valley's --
 *  when another town's own feeds mature enough to support a start month of
 *  its own. moreno_valley_ca is the only entry today per owner condition 6
 *  (no Brookings/Broomfield pages yet).
 */
export const MONTH_IN_REVIEW_START: Record<string, { year: number; month: number }> = {
  moreno_valley_ca: { year: 2026, month: 8 },
};

export function monthBoundsUTC(year: number, month: number): { start: Date; end: Date } {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1));
  return { start, end };
}

export function monthSlug(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function parseMonthSlug(slug: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(slug);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year: Number(match[1]), month };
}

export function monthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, 1)));
}

function formatDisclosureDate(value: string): string {
  const { y, m, d } = calendarDateParts(value)!;
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m, d)));
}

/** A calendar month is eligible once it's strictly before the CURRENT
 *  local month in the town's own timezone -- matches calendarDayDiff's own
 *  "today never counts as past" discipline used elsewhere, just at month
 *  granularity. getStaticPaths must never generate a path for the current
 *  or a future month (owner condition: "only fully completed calendar
 *  months are eligible"). */
export function isMonthComplete(year: number, month: number, timezone: string, now: Date = new Date()): boolean {
  const today = localDateParts(now, timezone); // today.m is 1-12, matching this module's own month params
  if (year !== today.y) return year < today.y;
  return month < today.m;
}

/** Every eligible month for this town, newest first -- from
 *  MONTH_IN_REVIEW_START through the latest COMPLETE month. Empty for a
 *  town with no start entry (owner condition 6). */
export function listEligibleMonths(townId: string, timezone: string, now: Date = new Date()): { year: number; month: number }[] {
  const start = MONTH_IN_REVIEW_START[townId];
  if (!start) return [];
  const months: { year: number; month: number }[] = [];
  let y = start.year;
  let m = start.month;
  while (isMonthComplete(y, m, timezone, now)) {
    months.push({ year: y, month: m });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return months.reverse();
}

interface Coverage {
  status: ModuleStatus;
  firstEverDate: string | null; // set only when status === 'partial', for the "(data from <date>)" disclosure
}

/** Shared coverage test for the five modules that use the "global first-
 *  seen floor" rule -- see this file's own module doc. Home sales does not
 *  use this (see buildSalesModule()). */
function coverageFromFloor(firstEverDate: string | null, monthStart: Date, monthEnd: Date): Coverage {
  if (!firstEverDate) return { status: 'none', firstEverDate: null };
  const first = new Date(firstEverDate);
  if (first < monthStart) return { status: 'full', firstEverDate: null };
  if (first < monthEnd) return { status: 'partial', firstEverDate };
  return { status: 'none', firstEverDate: null };
}

function pluralize(n: number, word: string, pluralWord = `${word}s`): string {
  return n === 1 ? word : pluralWord;
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export interface DecisionsModule {
  status: ModuleStatus;
  firstEverDate: string | null;
  total: number;
  approved: number;
  denied: number;
  continued: number;
}

export async function buildDecisionsModule(start: Date, end: Date): Promise<DecisionsModule> {
  const [rows, firstEverDate] = await Promise.all([
    getMeetingDecisionsInMonth(start, end),
    getMeetingDecisionsFirstEverDate(),
  ]);
  const coverage = coverageFromFloor(firstEverDate, start, end);
  const nonPending = rows.filter((r) => r.outcome !== 'pending');
  return {
    status: coverage.status,
    firstEverDate: coverage.firstEverDate,
    total: nonPending.length,
    approved: nonPending.filter((r) => r.outcome === 'approved').length,
    denied: nonPending.filter((r) => r.outcome === 'denied').length,
    continued: nonPending.filter((r) => r.outcome === 'continued').length,
  };
}

export function decisionsSentence(mod: DecisionsModule, label: string): string | null {
  if (mod.status === 'none') return null;
  const note = mod.status === 'partial' ? ` (data from ${formatDisclosureDate(mod.firstEverDate!)})` : '';
  if (mod.total === 0) return `No council or commission decisions were finalized in ${label}${note}.`;
  return `${mod.total} ${pluralize(mod.total, 'decision')} were finalized in ${label}${note}: `
    + `${mod.approved} approved, ${mod.denied} denied, ${mod.continued} continued.`;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export interface ProjectsModule {
  status: ModuleStatus;
  firstEverDate: string | null;
  count: number;
}

export async function buildProjectsModule(start: Date, end: Date): Promise<ProjectsModule> {
  const [rows, firstEverDate] = await Promise.all([
    getProjectUpdatesInMonth(start, end),
    getProjectUpdatesFirstEntryDate(),
  ]);
  const coverage = coverageFromFloor(firstEverDate, start, end);
  return {
    status: coverage.status,
    firstEverDate: coverage.firstEverDate,
    count: new Set(rows.map((r) => r.project_slug)).size,
  };
}

export function projectsSentence(mod: ProjectsModule, label: string): string | null {
  if (mod.status === 'none') return null;
  const note = mod.status === 'partial' ? ` (data from ${formatDisclosureDate(mod.firstEverDate!)})` : '';
  if (mod.count === 0) return `No tracked development projects received an update in ${label}${note}.`;
  return `${mod.count} tracked development ${pluralize(mod.count, 'project')} received an update in ${label}${note}.`;
}

// ---------------------------------------------------------------------------
// Home sales
// ---------------------------------------------------------------------------

// Matches ai_pipeline/home_sales_digest.py's SMALL_SAMPLE_THRESHOLD exactly
// -- a median of fewer than this many priced sales is noise, not insight.
export const SALES_SMALL_SAMPLE_THRESHOLD = 15;

export interface SalesModule {
  status: ModuleStatus;
  mostRecentSaleDate: string | null; // populated only when status === 'none', for a lag-disclosure fallback
  count: number;
  medianPrice: number | null;
  smallSample: boolean;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Home sales deliberately does NOT use coverageFromFloor(): property_sales
 *  is a quarterly, manually-reconciled county import that's already known
 *  to be gappy WITHIN its own history (research: "no Sep 2025 row at all"),
 *  not just thin at its very start -- a global first-ever-date floor would
 *  wrongly call every such gap "full coverage" just because the feed is old.
 *  Simpler, honest rule instead: a month with >=1 real row is 'full' (the
 *  county's own report, once it exists for a month, is treated as that
 *  month's real count -- same trust ai_pipeline/home_sales_digest.py
 *  already places in it); a month with zero rows is 'none' and omitted,
 *  whether that's a genuine reporting gap or data that hasn't arrived yet
 *  (the two are indistinguishable from this data alone, so neither is
 *  asserted). mostRecentSaleDate is returned anyway for an optional lag
 *  note, mirroring home-sales.astro's own disclosure. */
export async function buildSalesModule(start: Date, end: Date): Promise<SalesModule> {
  const [rows, mostRecent] = await Promise.all([
    getPropertySalesInMonth(start, end),
    getMostRecentPropertySaleDate(),
  ]);
  if (rows.length === 0) {
    return { status: 'none', mostRecentSaleDate: mostRecent, count: 0, medianPrice: null, smallSample: false };
  }
  // Matches home_sales_digest.py's compute_stats(): the headline count
  // includes outliers (len(sales)); only the median excludes them.
  const priced = rows
    .map((r) => r.sale_price)
    .filter((p): p is number => p != null && !isOutlierSale(p));
  const smallSample = priced.length < SALES_SMALL_SAMPLE_THRESHOLD;
  return {
    status: 'full',
    mostRecentSaleDate: null,
    count: rows.length,
    medianPrice: smallSample || priced.length === 0 ? null : median(priced),
    smallSample,
  };
}

export function salesSentence(mod: SalesModule, label: string, cityName: string): string | null {
  if (mod.status === 'none') return null; // owner condition 1: omit rather than guess at partial-month coverage
  let sentence = `${mod.count} ${pluralize(mod.count, 'home')} sold in ${cityName} in ${label}`;
  if (mod.smallSample) {
    sentence += ', too few recorded sales to report a reliable median price';
  } else if (mod.medianPrice != null) {
    sentence += `; the median sale price was ${formatPrice(mod.medianPrice)}`;
  }
  return `${sentence}.`;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface EventsModule {
  status: ModuleStatus;
  firstEverDate: string | null;
  inTown: number;
  nearby: number;
}

export async function buildEventsModule(
  year: number, month: number, timezone: string, townId: string, cityName: string,
  townCenter: { lat: number; lon: number },
): Promise<EventsModule> {
  const { start, end } = monthBoundsUTC(year, month);
  const [allEvents, facilities, firstEverDate] = await Promise.all([
    // 5000, same ceiling events/past.astro already uses for its own
    // full-archive month grouping -- see that page's own comment on why
    // getContentByType() (not getPastStories()) is the right source: it
    // has no occurs_at filter, so undated/launch-day rows aren't silently
    // dropped, and it already filters superseded_by_slug IS NULL.
    getContentByType(['event'], 5000),
    getFacilities(),
    getEarliestPublishedDate(['event']),
  ]);
  const coverage = coverageFromFloor(firstEverDate, start, end);
  if (coverage.status === 'none') {
    return { status: 'none', firstEverDate: null, inTown: 0, nearby: 0 };
  }
  // Timezone-aware month bucketing, like events/past.astro's own
  // monthKey() -- occurs_at is a real instant, so a UTC calendar-date
  // bucket would misfile anything near local midnight (see that page's own
  // comment on the off-by-one-day bug this avoids).
  const inMonth = allEvents.filter((e) => {
    if (!e.occurs_at) return false;
    const parts = localDateParts(new Date(e.occurs_at), timezone);
    return parts.y === year && parts.m === month;
  });
  const localized = inMonth.map((story) => classifyEventLocality(
    { sourceKind: 'story', occurs_at: story.occurs_at, story } as FeedItem,
    facilities, townId, cityName, townCenter,
  ));
  return {
    status: coverage.status,
    firstEverDate: coverage.firstEverDate,
    inTown: localized.filter((l) => l.zone === 'in_town').length,
    nearby: localized.filter((l) => l.zone === 'nearby').length,
  };
}

export function eventsSentence(mod: EventsModule, label: string, cityName: string): string | null {
  if (mod.status === 'none') return null;
  const note = mod.status === 'partial' ? ` (data from ${formatDisclosureDate(mod.firstEverDate!)})` : '';
  if (mod.inTown === 0 && mod.nearby === 0) return `No community events were recorded in ${cityName} or nearby in ${label}${note}.`;
  const nearbyNote = mod.nearby > 0 ? ` (plus ${mod.nearby} more nearby)` : '';
  return `${mod.inTown} ${pluralize(mod.inTown, 'event')} took place in ${cityName} in ${label}${nearbyNote}${note}.`;
}

// ---------------------------------------------------------------------------
// Traffic
// ---------------------------------------------------------------------------

export interface TrafficModule {
  status: ModuleStatus;
  firstEverDate: string | null;
  inTown: number;
  approach: number;
}

export async function buildTrafficModule(
  start: Date, end: Date, townId: string,
  corridors: { label: string; numbers: string[] }[] | undefined, corridorMaxMiles: number | undefined,
): Promise<TrafficModule> {
  const [rows, firstEverDate] = await Promise.all([
    getTrafficIncidentsFirstSeenInMonth(start, end),
    getTrafficIncidentsFirstEverSeen(),
  ]);
  const coverage = coverageFromFloor(firstEverDate, start, end);
  if (coverage.status === 'none') {
    return { status: 'none', firstEverDate: null, inTown: 0, approach: 0 };
  }
  // Same classifyTrafficIncident() call, same corridors/maxMiles, as
  // traffic.astro -- owner condition 2 ("same boundary/corridor filters as
  // the traffic page"). Counting created_at (first-seen), not
  // last_seen_at, means a long-lived closure is counted once, in the
  // month it first appeared, never again in a later month it was still
  // being re-scraped.
  const classified = rows
    .map((r) => classifyTrafficIncident(r, townId, corridors, corridorMaxMiles))
    .filter((c): c is NonNullable<typeof c> => c !== null);
  return {
    status: coverage.status,
    firstEverDate: coverage.firstEverDate,
    inTown: classified.filter((c) => c.zone === 'in_town').length,
    approach: classified.filter((c) => c.zone === 'approach').length,
  };
}

export function trafficSentence(mod: TrafficModule, label: string, cityName: string): string | null {
  if (mod.status === 'none') return null;
  const note = mod.status === 'partial' ? ` (data from ${formatDisclosureDate(mod.firstEverDate!)})` : '';
  if (mod.inTown === 0 && mod.approach === 0) return `No traffic incidents were recorded on ${cityName}'s roads in ${label}${note}.`;
  const approachNote = mod.approach > 0 ? ` (plus ${mod.approach} more on nearby approach roads)` : '';
  const verb = mod.inTown === 1 ? 'was' : 'were';
  return `${mod.inTown} traffic ${pluralize(mod.inTown, 'incident')} ${verb} recorded on ${cityName}'s roads in ${label}${approachNote}${note}.`;
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export interface JobsModule {
  status: ModuleStatus;
  firstEverDate: string | null;
  inTown: number;
  nearby: number;
}

export async function buildJobsModule(start: Date, end: Date, cityName: string): Promise<JobsModule> {
  const [rows, firstEverDate] = await Promise.all([
    getJobsFirstScrapedInMonth(start, end),
    getJobsFirstEverScraped(),
  ]);
  const coverage = coverageFromFloor(firstEverDate, start, end);
  if (coverage.status === 'none') {
    return { status: 'none', firstEverDate: null, inTown: 0, nearby: 0 };
  }
  // Distinctness already guaranteed by jobs' own UNIQUE(town_id,
  // external_job_id) + append-only insert (owner condition 4) -- counting
  // by created_at (our own first-scrape date), never Adzuna's posted_at,
  // is what makes this "after first scrape month", not a re-count of an
  // old posting we only happened to scrape this month.
  const zones = rows.map((r) => jobZone(r.location, cityName));
  return {
    status: coverage.status,
    firstEverDate: coverage.firstEverDate,
    inTown: zones.filter((z) => z === 'in_town').length,
    nearby: zones.filter((z) => z === 'nearby').length,
  };
}

export function jobsSentence(mod: JobsModule, label: string, cityName: string): string | null {
  if (mod.status === 'none') return null;
  const note = mod.status === 'partial' ? ` (data from ${formatDisclosureDate(mod.firstEverDate!)})` : '';
  if (mod.inTown === 0 && mod.nearby === 0) return `No new job postings appeared in or around ${cityName} in ${label}${note}.`;
  const nearbyNote = mod.nearby > 0 ? ` (plus ${mod.nearby} nearby)` : '';
  return `${mod.inTown} job ${pluralize(mod.inTown, 'posting')} appeared in ${cityName} in ${label}${nearbyNote}${note}.`;
}

// ---------------------------------------------------------------------------
// Noindex gate (owner condition 7)
// ---------------------------------------------------------------------------

export const MIN_MODULES_FOR_INDEX = 4;

export function clearedModuleCount(modules: { status: ModuleStatus }[]): number {
  return modules.filter((m) => m.status !== 'none').length;
}

export { TOWN_ID };
