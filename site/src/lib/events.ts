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
import { buildVenueIndex, resolveVenue } from './db';

export type FeedItem =
  | { kind: 'story'; occurs_at: string | null; story: Story }
  | { kind: 'arts'; occurs_at: string | null; event: SdsuEvent };

export function itemTitle(item: FeedItem): string {
  return item.kind === 'story' ? item.story.title : item.event.title;
}
export function itemUrl(item: FeedItem): string | null {
  return item.kind === 'story' ? item.story.source_url : item.event.event_url;
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

function dayIndex(occursAt: string, today: Date, timezone: string): number {
  const eventDay = utcMidnight(localDateParts(new Date(occursAt), timezone));
  return Math.round((eventDay.getTime() - today.getTime()) / 86_400_000);
}

export function isToday(item: FeedItem, today: Date, timezone: string): boolean {
  if (!item.occurs_at) return false;
  return dayIndex(item.occurs_at, today, timezone) <= 0;
}

export function isThisWeekend(item: FeedItem, today: Date, timezone: string): boolean {
  if (!item.occurs_at) return false;
  const weekdayOfToday = today.getUTCDay(); // 0=Sun -- today is already UTC-anchored, read it directly
  const daysToFriday = (5 - weekdayOfToday + 7) % 7;
  const offset = dayIndex(item.occurs_at, today, timezone);
  return offset >= daysToFriday && offset <= daysToFriday + 2;
}

export interface EventFeedResult {
  items: FeedItem[];
  alsoListedBy: Map<FeedItem, string[]>;
}

/**
 * Cross-source duplicate reconciliation -- e.g. "Downtown at Sundown" listed
 * independently by both SDSU's calendar and the Chamber's calendar. Narrow
 * and deterministic on purpose: same calendar date + EXACT normalized-title
 * match, cross-kind only (never within the same kind -- the library
 * legitimately lists the same class title twice for two different session
 * times, and SDSU legitimately lists the same show twice for a matinee/
 * evening pair; a same-kind match would wrongly collapse those).
 */
export function buildEventFeed(stories: Story[], artsEvents: SdsuEvent[], timezone: string): EventFeedResult {
  const rawItems: FeedItem[] = [
    ...stories.map((story): FeedItem => ({ kind: 'story', occurs_at: story.occurs_at, story })),
    ...artsEvents.map((event): FeedItem => ({ kind: 'arts', occurs_at: event.starts_at, event })),
  ];

  const canonicalByKey = new Map<string, FeedItem>();
  const alsoListedBy = new Map<FeedItem, string[]>();
  const items: FeedItem[] = [];
  for (const item of rawItems) {
    const dateKey = item.occurs_at ? localDateParts(new Date(item.occurs_at), timezone) : null;
    const key = dateKey ? `${dateKey.y}-${dateKey.m}-${dateKey.d}|${item.kind === 'arts' ? 'arts' : 'story'}|${normalizeTitle(itemTitle(item))}` : null;
    const crossKey = dateKey && key
      ? `${dateKey.y}-${dateKey.m}-${dateKey.d}|${item.kind === 'arts' ? 'story' : 'arts'}|${normalizeTitle(itemTitle(item))}`
      : null;
    const canonical = crossKey ? canonicalByKey.get(crossKey) : undefined;

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
    if (key) canonicalByKey.set(key, item);
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
 *  event as free, the one failure mode this facet must never produce. */
const PAID_LANGUAGE_RE = /\$\d|admission fee|cover charge|tickets?\s+(required|on sale)|purchase\s+a\s+ticket/i;

const FREE_VENUE_CATEGORIES = new Set(['library', 'park', 'community_center']);

/**
 * Events genuinely knowable as free without guessing. Neither `events` nor
 * `stories` carries a structured cost/price field anywhere in the pipeline
 * (confirmed against scrapers/parsers/events.py and ai_pipeline/publish.py),
 * and the raw feed source ('library' / 'chamber' / 'city_events') that WOULD
 * distinguish a reliably-free civic calendar from a mixed commercial one is
 * never persisted past the `events` table -- it doesn't survive onto the
 * published `stories` row publish.py writes. Venue CATEGORY is the one
 * signal that IS reliably known at render time: a town-run library, park, or
 * community center essentially never charges for its own public programs.
 * SDSU arts events are always excluded here -- they don't resolve against
 * the town's own `facilities` registry (campus venues aren't in it), so
 * free-ness there is genuinely unknown, and per the brief's own rule an
 * uncertain event is omitted, never guessed onto this page.
 */
export function isFreeEvent(item: FeedItem, facilities: Facility[]): boolean {
  if (item.kind !== 'story') return false;
  const facility = resolveVenue(buildVenueIndex(facilities), item.story.venue_raw);
  if (!facility || !FREE_VENUE_CATEGORIES.has(facility.category)) return false;
  if (PAID_LANGUAGE_RE.test(item.story.body)) return false;
  return true;
}

/** The most reliable facet: venue resolution is already built (the venue
 *  registry), and a library-category facility is an unambiguous fact, not a
 *  derived guess. */
export function isLibraryEvent(item: FeedItem, facilities: Facility[]): boolean {
  if (item.kind !== 'story') return false;
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
  const body = item.kind === 'story' ? item.story.body : (item.event.teaser ?? '');
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
  return item.kind === 'arts';
}
