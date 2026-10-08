/**
 * Shared event-feed logic: cross-source merge/de-dup, timezone-correct date
 * arithmetic, and the Free/Kids/Library/Campus facet rules for the Week 2
 * landing pages (see NEEDS-HUMAN-REVIEW.md, "Week 2 — Event Landing Pages").
 *
 * The date/dedup primitives below are moved here UNCHANGED from events.astro
 * (which now imports them too) so the main /events feed and every new
 * /events/[facet]/ page compute date windows and duplicates identically --
 * never two independently maintained copies of timezone-sensitive math. This
 * file's date functions already carry scar tissue from a real bug: an
 * earlier version re-applied a timezone conversion to an already-converted
 * value when computing "today," and got the weekend window off by one day on
 * every build (confirmed live, reproduced under TZ=UTC too, since the site's
 * own timezone never matches the CI build machine's UTC either). All
 * arithmetic here extracts Y/M/D via Intl.DateTimeFormat (correct for the
 * given IANA timezone, deterministic regardless of the build machine) and
 * re-anchors to UTC midnight for comparisons -- never round-trips through a
 * Date's own implicit LOCAL-timezone constructor.
 *
 * events.astro's OWN "Today / This weekend / Coming up / Further out"
 * sections stay as their own sequential, mutually-exclusive bucket loop
 * (unchanged, low-risk, presentation-specific to that one page) -- but the
 * standalone isToday()/isThisWeekend() facet predicates below are
 * deliberately INCLUSIVE, not mutually exclusive with each other. A Friday
 * event should appear on both the dedicated /events/today/ AND
 * /events/this-weekend/ landing pages: each is an independent SEO surface a
 * visitor might land on directly from a different search query, not a
 * partition of one shared list.
 */
import type { Story, SdsuEvent, Facility } from './db';
import { buildVenueIndex, resolveVenue, isVirtualVenue } from './db';
import { classifyLocalityByCoords, classifyLocalityByText, type LocalityResult } from './town-boundary';

export type FeedItem =
  | { sourceKind: 'story'; occurs_at: string | null; story: Story }
  | { sourceKind: 'arts'; occurs_at: string | null; event: SdsuEvent };

export function itemTitle(item: FeedItem): string {
  return item.sourceKind === 'story' ? item.story.title : item.event.title;
}
export function itemUrl(item: FeedItem): string | null {
  return item.sourceKind === 'story' ? item.story.source_url : item.event.event_url;
}

/** What's On Phase 2: the item's own venue string, whatever field the
 *  source happens to carry it in -- a Story's `venue_raw` or a SdsuEvent's
 *  `location`. Both are nullable in real data; feeds lib/venue-tiers.ts's
 *  venueTierFor(), which already treats null/empty as "unranked." */
export function itemVenue(item: FeedItem): string | null {
  return item.sourceKind === 'story' ? (item.story.venue_raw ?? null) : item.event.location;
}

/** SDSU arts_culture events have no own /s/[slug] page (their link is
 *  event_url, out to sdstate.edu) -- adapted to the Story shape just so
 *  StoryCard/buildEventJsonLd can be reused. Always rendered with an
 *  href/kicker override (see StoryCard.astro) so the title/image link
 *  externally instead of to a nonexistent local page. */
export function artsEventAsStory(event: SdsuEvent): Story {
  return {
    id: 0,
    title: event.title,
    slug: event.external_event_id,
    body: event.teaser ?? '',
    source_type: 'event',
    source_url: event.event_url,
    occurs_at: event.starts_at,
    published_at: event.starts_at ?? new Date().toISOString(),
    generated_by: 'sdsu_event_calendar',
    byline: null,
    image_path: null,
    image_alt: null,
    rating: null,
    ingredients: null,
    instructions: null,
  };
}

/** "Downtown @ Sundown" (Chamber) / "Downtown at Sundown" (SDSU) -- "@" is
 *  common shorthand for "at," so it's expanded BEFORE punctuation is
 *  stripped, or the two titles diverge instead of converging. */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/@/g, ' at ')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function localDateParts(instant: Date, timezone: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

export function utcMidnight({ y, m, d }: { y: number; m: number; d: number }): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

/** "Today," re-anchored to UTC midnight in the site's own local timezone --
 *  call ONCE per page build and reuse (today doesn't change mid-render). */
export function todayUtcMidnight(timezone: string): Date {
  return utcMidnight(localDateParts(new Date(), timezone));
}

/** How many LOCAL calendar days after `today` (see todayUtcMidnight()) an
 *  item's occurs_at falls -- 0 is today, 1 is tomorrow, negative is in the
 *  past. Exported (Events correctness Phase 1, 2026-10-07): index.astro's
 *  homepage Today/This-week/Later story-river partition used to hand-roll
 *  this same day-bucketing with `new Date().setHours(0,0,0,0)`, which reads
 *  the BUILD MACHINE's local time (always UTC in CI/Cloudflare, never the
 *  town's own zone) -- exactly the bug class this file's own docstring
 *  already warns about, and it shifted evening events into the wrong
 *  bucket because this one call site was never routed through the
 *  timezone-correct primitive the rest of this file already uses. */
export function dayIndex(occursAt: string, today: Date, timezone: string): number {
  const eventDay = utcMidnight(localDateParts(new Date(occursAt), timezone));
  return Math.round((eventDay.getTime() - today.getTime()) / 86_400_000);
}

/** The item's own local hour-of-day (0-23), for isTonight()'s "after 17:00
 *  local" cutoff -- Intl.DateTimeFormat again, not Date.getHours() (which
 *  reads the BUILD MACHINE's local time, not the town's -- the exact class
 *  of bug this file's own docstring already warns about). */
function localHour(occursAt: string, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour: 'numeric', hour12: false,
  }).formatToParts(new Date(occursAt));
  const hour = Number(parts.find((p) => p.type === 'hour')!.value);
  return hour === 24 ? 0 : hour; // some locales render midnight as "24"
}

export function isToday(item: FeedItem, today: Date, timezone: string): boolean {
  if (!item.occurs_at) return false;
  return dayIndex(item.occurs_at, today, timezone) <= 0;
}

/** /today's TONIGHT bucket (Recurring-traffic layer, Phase 1): today's own
 *  calendar day AND starting at or after 17:00 local -- deliberately NOT
 *  "isToday() minus already-passed," since a same-day item that already
 *  started is still worth knowing about on a page answering "what's
 *  happening today," just not under TONIGHT specifically if it started
 *  earlier in the day. */
export function isTonight(item: FeedItem, today: Date, timezone: string): boolean {
  if (!item.occurs_at) return false;
  return dayIndex(item.occurs_at, today, timezone) === 0 && localHour(item.occurs_at, timezone) >= 17;
}

/** /today's TOMORROW bucket -- exactly the next calendar day, not "within
 *  24 hours" (which would drift across the day depending on build time). */
export function isTomorrow(item: FeedItem, today: Date, timezone: string): boolean {
  if (!item.occurs_at) return false;
  return dayIndex(item.occurs_at, today, timezone) === 1;
}

export function isThisWeekend(item: FeedItem, today: Date, timezone: string): boolean {
  if (!item.occurs_at) return false;
  const weekdayOfToday = today.getUTCDay(); // 0=Sun -- today is already UTC-anchored, read it directly
  const daysToFriday = (5 - weekdayOfToday + 7) % 7;
  const offset = dayIndex(item.occurs_at, today, timezone);
  return offset >= daysToFriday && offset <= daysToFriday + 2;
}

export interface TodayBucket {
  /** Capped for display -- see `limit`. */
  items: FeedItem[];
  /** The REAL count before capping -- /today shows this alongside the
   *  capped list ("+N more") rather than silently hiding how many there
   *  actually are, per the Recurring-traffic layer handoff's Phase 1 spec
   *  ("TOMORROW: count + max 3 items" -- the count is the point, not just
   *  the sample). */
  total: number;
}

/** One bucket (TONIGHT or TOMORROW) for /today -- `matches` is isTonight or
 *  isTomorrow, passed in rather than hardcoded so this one function serves
 *  both buckets instead of two near-identical copies. `items` is assumed
 *  already date-sorted (buildEventFeed's own output already is). */
export function selectTodayBucket(
  items: FeedItem[], today: Date, timezone: string,
  matches: (item: FeedItem, today: Date, timezone: string) => boolean,
  limit: number,
): TodayBucket {
  const matching = items.filter((item) => matches(item, today, timezone));
  return { items: matching.slice(0, limit), total: matching.length };
}

export interface EventFeedResult {
  items: FeedItem[];
  alsoListedBy: Map<FeedItem, string[]>;
}

/** Per-source participation in cross-source dedup matching (see
 *  findCrossSourceMatch() below) -- encoded as data rather than a hardcoded
 *  if/else so a future source (What's On Phase 3: Ticketmaster) is a new map
 *  entry, not a new branch. `story` and `arts` both participate today. */
export interface EventSourceConfig {
  crossMatch: boolean;
}

/** `ticketmaster` (What's On Phase 3) is registered here even though it
 *  never actually reaches buildEventFeed() yet -- see lib/ticketmaster.ts's
 *  own module comment for why the adapter stays standalone this phase.
 *  Enabled for cross-matching per real data: 14 live Brookings Discovery
 *  API results (2026-09-07, all SDSU Athletics + one commercial wrestling
 *  event) share zero titles with any current arts_culture/story item, so
 *  there's no live evidence of a false-positive risk. Ticketmaster's own
 *  title convention ("South Dakota State Jackrabbits Football vs. Murray
 *  State Racers Football") is far more formal/verbose than how a city
 *  calendar or SDSU's arts_culture feed would describe the same real event,
 *  so in practice this is more likely to MISS a genuine duplicate (a safe
 *  failure -- two cards instead of one) than to wrongly merge two different
 *  events -- the failure mode Phase 1's own same-source exclusion rule
 *  exists to prevent. */
export const EVENT_SOURCES: Record<string, EventSourceConfig> = {
  story: { crossMatch: true },
  arts: { crossMatch: true },
  ticketmaster: { crossMatch: true },
};

/** Same calendar date + exact normalized-title match, cross-SOURCE only
 *  (never within the same source -- the library legitimately lists the same
 *  class title twice for two different session times, and SDSU legitimately
 *  lists the same show twice for a matinee/evening pair; a same-source match
 *  would wrongly collapse those). Generic over the number of participating
 *  sources -- not hardcoded to exactly two -- and independently unit-tested
 *  with synthetic 3+-source data (see events.test.ts) to prove that, without
 *  requiring a real third production source to exist yet. `dateKey` is
 *  `null` for an undated item (never matches anything). */
export function findCrossSourceMatch<T>(
  sourceKind: string,
  dateKey: string | null,
  normalizedTitle: string,
  canonicalByKey: Map<string, T>,
  sources: Record<string, EventSourceConfig>,
): T | undefined {
  if (!dateKey || !sources[sourceKind]?.crossMatch) return undefined;
  for (const otherKind of Object.keys(sources)) {
    if (otherKind === sourceKind || !sources[otherKind].crossMatch) continue;
    const found = canonicalByKey.get(`${dateKey}|${otherKind}|${normalizedTitle}`);
    if (found) return found;
  }
  return undefined;
}

/**
 * Cross-source duplicate reconciliation -- e.g. "Downtown at Sundown" listed
 * independently by both SDSU's calendar and the Chamber's calendar. Narrow
 * and deterministic on purpose -- see findCrossSourceMatch() above for the
 * matching rule itself.
 */
export function buildEventFeed(stories: Story[], artsEvents: SdsuEvent[], timezone: string): EventFeedResult {
  const rawItems: FeedItem[] = [
    ...stories.map((story): FeedItem => ({ sourceKind: 'story', occurs_at: story.occurs_at, story })),
    ...artsEvents.map((event): FeedItem => ({ sourceKind: 'arts', occurs_at: event.starts_at, event })),
  ];

  const canonicalByKey = new Map<string, FeedItem>();
  const alsoListedBy = new Map<FeedItem, string[]>();
  const items: FeedItem[] = [];
  for (const item of rawItems) {
    const dateParts = item.occurs_at ? localDateParts(new Date(item.occurs_at), timezone) : null;
    const dateKey = dateParts ? `${dateParts.y}-${dateParts.m}-${dateParts.d}` : null;
    const normalizedTitle = normalizeTitle(itemTitle(item));
    const ownKey = dateKey ? `${dateKey}|${item.sourceKind}|${normalizedTitle}` : null;
    const canonical = findCrossSourceMatch(item.sourceKind, dateKey, normalizedTitle, canonicalByKey, EVENT_SOURCES);

    if (canonical) {
      const url = itemUrl(item);
      if (url) {
        const host = new URL(url).hostname.replace(/^www\./, '');
        const list = alsoListedBy.get(canonical) ?? [];
        if (!list.includes(host)) list.push(host);
        alsoListedBy.set(canonical, list);
      }
      continue; // already covered by the canonical entry -- no separate card
    }
    if (ownKey) canonicalByKey.set(ownKey, item);
    items.push(item);
  }

  items.sort((a, b) => {
    if (!a.occurs_at) return 1;
    if (!b.occurs_at) return -1;
    return new Date(a.occurs_at).getTime() - new Date(b.occurs_at).getTime();
  });
  return { items, alsoListedBy };
}

export function withAttribution(body: string, item: FeedItem, alsoListedBy: Map<FeedItem, string[]>): string {
  const hosts = alsoListedBy.get(item);
  if (!hosts || hosts.length === 0) return body;
  const suffix = `Also listed by ${hosts.join(', ')}.`;
  return body ? `${body} ${suffix}` : suffix;
}

/* ------------------------------------------------------------- facet rules */

/** Paid-language safety net for isFreeEvent() -- excludes ONLY, never
 *  includes. A false-positive exclusion just omits a genuinely free event
 *  from this one page (harmless: it still has its own /s/[slug] page and
 *  shows on /events); a false-positive inclusion would mislabel a paid
 *  event as free, the one failure mode this facet must never produce.
 *
 *  Events correctness Step A, point 3 (2026-10-08): the `\$\d` branch can
 *  no longer fire against `body` -- guardrails.py's
 *  check_no_date_time_price_age_claims now blanket-bans a dollar amount
 *  from event prose, the exact text this branch used to catch. Checked
 *  against `meta.cost` too below (that's the one field the ban doesn't
 *  touch, since it's a structured extraction, not prose) so a real paid
 *  amount still excludes the event; the textual phrases ("admission fee",
 *  "tickets required", ...) still work against `body` since the guardrail
 *  never covered them. */
const PAID_LANGUAGE_RE = /\$\d|admission fee|cover charge|tickets?\s+(required|on sale)|purchase\s+a\s+ticket/i;

// Exported so events/[facet].astro's 'free' facet can pick the SAME
// always-free facilities (library/park/community_center) out of the
// facilities list it already has, rather than re-declaring this set a
// second time in that file (ai_pipeline/free_teasers.py ports it a third
// time, Python-side -- see that module's own comment on the tradeoff).
export const FREE_VENUE_CATEGORIES = new Set(['library', 'park', 'community_center']);

/**
 * Events genuinely knowable as free without guessing. `stories.meta.cost`
 * (db/migrations/027_story_meta.sql) is a structured per-event extraction
 * when the source's own text named a price/cost, but it's the EXCEPTION
 * (NULL for most rows: most sources never mention a price either way, and
 * no row published before 027 has it at all) -- Venue CATEGORY stays the
 * PRIMARY signal, same as before: a town-run library, park, or community
 * center essentially never charges for its own public programs. SDSU arts
 * events are always excluded here -- they don't resolve against the town's
 * own `facilities` registry (campus venues aren't in it), so free-ness
 * there is genuinely unknown, and per the brief's own rule an uncertain
 * event is omitted, never guessed onto this page.
 */
export function isFreeEvent(item: FeedItem, facilities: Facility[]): boolean {
  if (item.sourceKind !== 'story') return false;
  const facility = resolveVenue(buildVenueIndex(facilities), item.story.venue_raw);
  if (!facility || !FREE_VENUE_CATEGORIES.has(facility.category)) return false;
  if (PAID_LANGUAGE_RE.test(item.story.body)) return false;
  if (item.story.meta?.cost && PAID_LANGUAGE_RE.test(item.story.meta.cost)) return false;
  return true;
}

/** Events correctness Step A, point 3: the compact "Free"/price + age line
 *  for event cards and the detail page -- rendered only from the
 *  structured `meta` fields, never from prose. `null` (never an empty
 *  string) when the source gave neither, so callers can gate rendering on
 *  it directly without a second emptiness check. Meeting/alert rows and
 *  every row published before 027_story_meta.sql have `meta` null -- same
 *  "render nothing" rule. */
export function eventPriceAgeLine(story: Story): string | null {
  const parts = [story.meta?.cost, story.meta?.audience].filter((v): v is string => Boolean(v));
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** The most reliable facet: venue resolution is already built (the venue
 *  registry), and a library-category facility is an unambiguous fact, not a
 *  derived guess. */
export function isLibraryEvent(item: FeedItem, facilities: Facility[]): boolean {
  if (item.sourceKind !== 'story') return false;
  const facility = resolveVenue(buildVenueIndex(facilities), item.story.venue_raw);
  return facility?.category === 'library';
}

/** No structured audience/age field exists (same gap as cost), so this is a
 *  deliberate keyword rule against title + the first part of the body --
 *  per the brief's own explicit allowance for this specific facet. Lower
 *  stakes than Free: a missed or over-included kids event is a mild
 *  annoyance, not a broken promise to the reader the way mislabeling a paid
 *  event as free would be. Checked against a real sample of both towns'
 *  live event titles before shipping (see the facet-reliability report). */
const KIDS_RE = /\b(kids?|children|childrens?|toddler|preschool|storytime|story time|famil(?:y|ies)|youth|teens?|tween)\b/i;

export function isKidsEvent(item: FeedItem): boolean {
  const title = itemTitle(item);
  const body = item.sourceKind === 'story' ? item.story.body : (item.event.teaser ?? '');
  return KIDS_RE.test(title) || KIDS_RE.test(body.slice(0, 200));
}

/** Brookings' SDSU arts & culture events -- the one facet that's naturally
 *  town-scoped, since getUpcomingArtsEvents() always returns [] for towns
 *  without a university feed (same "naturally empty elsewhere" pattern as
 *  getRegionalSports()/getUpcomingSdsuEvents). Deliberately scoped to just
 *  the arts_culture bucket already shown (deduped) on the townwide /events
 *  page -- NOT a re-listing of /university's athletics/camps content, which
 *  already has its own page and its own SEO surface; duplicating it here
 *  would be the thin/near-duplicate-content problem the GSC data confirmed
 *  this site currently does NOT have. */
export function isCampusEvent(item: FeedItem): boolean {
  return item.sourceKind === 'arts';
}

/** Phase 2, item 2a's "Outdoor" filter chip -- same grounding discipline as
 *  isFreeEvent()/isLibraryEvent(): a real, resolved venue CATEGORY, never a
 *  keyword guess against the title/body (an indoor "Outdoor Education"
 *  class at the community center would false-positive on a text match).
 *  `park` is the one facility category that's unambiguously outdoor space;
 *  deliberately not `community_center` (overwhelmingly indoor programs). */
export function isOutdoorEvent(item: FeedItem, facilities: Facility[]): boolean {
  if (item.sourceKind !== 'story') return false;
  const facility = resolveVenue(buildVenueIndex(facilities), item.story.venue_raw);
  return facility?.category === 'park';
}

/** Phase 2, item 2a's "In <Town>" vs "Nearby" split -- see
 *  lib/town-boundary.ts's own module doc for the boundary/distance
 *  mechanics and the straight-line-not-drive-time decision. This is the
 *  one adapter that knows how to get FROM a FeedItem TO a classification:
 *  - SDSU arts events never resolve against the town's own facilities
 *    registry (campus venues aren't in it, same gap isFreeEvent()'s own
 *    comment already documents) but are inherently local -- always
 *    `in_town`, no lookup needed.
 *  - A virtual/online venue has no real-world location at all; treated as
 *    `in_town` rather than invented as "nearby" or dropped from both
 *    sections, since it's still hosted by a local organizer.
 *  - A resolved facility (real lat/lon) uses the precise boundary/distance
 *    path. An unresolved venue string falls back to the text heuristic --
 *    this is the path the new Broomfield Chamber (BizWest) source's one
 *    live event takes today, see town-boundary.ts's own doc comment. */
export function classifyEventLocality(
  item: FeedItem, facilities: Facility[], townId: string, cityName: string,
  townCenter: { lat: number; lon: number },
): LocalityResult {
  if (item.sourceKind !== 'story') return { zone: 'in_town', distanceMiles: null };
  const venueText = item.story.venue_raw;
  if (isVirtualVenue(venueText)) return { zone: 'in_town', distanceMiles: null };

  const facility = resolveVenue(buildVenueIndex(facilities), venueText);
  if (facility?.lat != null && facility?.lon != null) {
    return classifyLocalityByCoords(townId, facility.lat, facility.lon, townCenter);
  }
  if (!venueText) return { zone: 'in_town', distanceMiles: null };
  return classifyLocalityByText(venueText, cityName);
}
