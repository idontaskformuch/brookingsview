/** What's On Phase 5 -- ranks Ticketmaster events for the Marquee/Also-on
 *  split, reusing Phase 2's venue-tier concept (venueTierFor/venueTierRank)
 *  rather than forcing TicketmasterFeedItem through Phase 1/2's FeedItem-
 *  typed rankEvents(). Kept standalone for the same reason lib/
 *  ticketmaster.ts's own TicketmasterFeedItem stayed out of the FeedItem
 *  union: rankEvents() operates on EventFeedResult.items (FeedItem[]), and
 *  unioning Ticketmaster in would force type-narrowing changes onto Phase
 *  1's real page consumers for no benefit here -- this page never merges
 *  its list with the story/arts feed.
 *
 *  Venue tiers for the real Sioux Falls-area venues in Brookings' 75-mile
 *  Ticketmaster inventory (Denny Sanford PREMIER Center, Washington
 *  Pavilion, Orpheum Theater, ...) were curated in the Phase 5 human
 *  review follow-up, reversing Phase 3's earlier "don't guess" deferral
 *  once real review showed the gap was load-bearing, not cosmetic -- see
 *  lib/venue-tiers.ts's own VENUE_TIERS_BY_ID for the real, checked
 *  capacity figures behind each tier. Passes the Ticketmaster venue's own
 *  stable id through to venueTierFor() (preferred over the display name,
 *  which can drift -- arena sponsorship renames are common). A venue not
 *  yet observed in a live response still falls back to the default tier,
 *  same as before -- see venue-tiers.ts's own DEFAULT_VENUE_TIER comment
 *  and scripts/dump-event-ranking.ts's "unmapped venues" section for how
 *  that's now surfaced at review time instead of staying invisible. */
import { venueTierFor, venueTierRank } from './venue-tiers';
import type { TicketmasterFeedItem, TicketmasterEvent } from './ticketmaster';
import type { ResolvableStory } from './images';

/** Title alone collides -- confirmed live: "Goosebumps: The Musical" is a
 *  real touring show with 5 separate Sioux Falls dates in Brookings' own
 *  75-mile feed, same title every time. Always suffixed with Ticketmaster's
 *  own event id (already unique, confirmed by Discovery API's own data
 *  model) rather than truncated, so two different events can never collide
 *  and the same event always resolves to the same slug across rebuilds. */
export function ticketmasterSlug(event: Pick<TicketmasterEvent, 'id' | 'title'>): string {
  const base = event.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${base}-${event.id}`;
}

/** Adapts a TicketmasterFeedItem into resolveImage()'s ResolvableStory
 *  shape -- source_type: 'event' is a real, already-meaningful SourceType
 *  (see lib/db.ts), used here only as a plausible fallback category if the
 *  Ticketmaster image tier (Phase 4) somehow didn't fire; in practice it
 *  always does for an item with ticketmasterImageUrl set, since that tier
 *  outranks article/venue/category unconditionally. */
export function ticketmasterResolvableImage(item: TicketmasterFeedItem): ResolvableStory & { slug: string } {
  const e = item.ticketmasterEvent;
  return {
    slug: ticketmasterSlug(e),
    title: e.title,
    source_type: 'event',
    image_path: null,
    image_alt: null,
    venue_raw: null,
    ticketmasterImageUrl: e.imageUrl,
    ticketmasterImageWidth: e.imageWidth ?? undefined,
    ticketmasterImageHeight: e.imageHeight ?? undefined,
  };
}

// Ticketmaster items carry the title on their own payload, not through
// events.ts's itemTitle() (that only knows story/arts) -- see below.
function ticketmasterItemTitle(item: TicketmasterFeedItem): string {
  return item.ticketmasterEvent.title;
}

export interface RankedTicketmasterEvent {
  item: TicketmasterFeedItem;
  score: number;
  venueTier: ReturnType<typeof venueTierFor>;
}

/** Deterministic: same input -> same output, same tie-breaking discipline
 *  as lib/event-ranking.ts's rankEvents() (soonest occurs_at, then title --
 *  never input-array order). */
export function rankTicketmasterEvents(items: TicketmasterFeedItem[], townId: string): RankedTicketmasterEvent[] {
  const ranked = items.map((item) => {
    const venueTier = venueTierFor(townId, item.ticketmasterEvent.venueName, item.ticketmasterEvent.venueId);
    return { item, score: venueTierRank(venueTier), venueTier };
  });

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aTime = a.item.occurs_at ? new Date(a.item.occurs_at).getTime() : Infinity;
    const bTime = b.item.occurs_at ? new Date(b.item.occurs_at).getTime() : Infinity;
    if (aTime !== bTime) return aTime - bTime;
    return ticketmasterItemTitle(a.item).localeCompare(ticketmasterItemTitle(b.item));
  });

  return ranked;
}

/** Provisional starting cutoff (per the Phase 5 handoff's own instruction:
 *  "treat it as provisional... review against the real dataset"), not a
 *  final decision -- see the Phase 5 human-review report for whether this
 *  held up against the real ~40-event Brookings dataset. Deliberately left
 *  at 6 in the "Tour-Run Collapsing" follow-up (per that handoff's own
 *  instruction: run collapsing addresses the crowding directly, so the
 *  cutoff itself isn't the first thing to touch). */
export const MARQUEE_SIZE = 6;

/** One Marquee slot -- either a standalone event (`members.length === 1`)
 *  or a collapsed run of the SAME real production at the SAME venue across
 *  multiple dates (confirmed live: 6 separate "Disney On Ice presents Find
 *  Your Hero" dates at Denny Sanford PREMIER Center, all sharing one
 *  Discovery API attraction id). `primary` is the best-ranked member (in
 *  practice, since tier dominates score and every member of a run shares a
 *  venue and thus a tier, this is the SOONEST date) -- used for the card's
 *  image/title/link. See collapseMarqueeRuns() below for how a run is
 *  identified. */
export interface MarqueeEntry {
  primary: TicketmasterFeedItem;
  members: TicketmasterFeedItem[];
}

/**
 * Groups already-ranked items into Marquee entries, collapsing a run of
 * events that share BOTH the same primary attraction id AND the same
 * venue id (or venue name, if no id) into one entry -- venue is part of
 * the key on purpose: the same touring production at two different venues
 * is two separate bookings, not one run, even though Discovery API would
 * give them the same attraction id.
 *
 * Never collapses on attraction id alone, and NEVER collapses when
 * attractionId is absent -- an event with no attraction data always gets
 * its own entry. Collapsing is a structural match (a real, stable
 * Discovery API id), never a title/name guess -- the same discipline
 * isNonEventListing() applies to filtering.
 *
 * `ranked` is assumed already sorted (rankTicketmasterEvents()'s own
 * output) -- since every member of a run shares a venue, and therefore a
 * tier, a run's members are contiguous in score and differ only by date;
 * the FIRST occurrence encountered is always the soonest date, which
 * becomes `primary` without needing a separate re-sort here.
 */
export function collapseMarqueeRuns(ranked: RankedTicketmasterEvent[]): MarqueeEntry[] {
  const entries: MarqueeEntry[] = [];
  const entryIndexByKey = new Map<string, number>();

  for (const { item } of ranked) {
    const e = item.ticketmasterEvent;
    const key = e.attractionId ? `${e.attractionId}::${e.venueId ?? e.venueName ?? ''}` : null;

    const existingIndex = key ? entryIndexByKey.get(key) : undefined;
    if (existingIndex !== undefined) {
      entries[existingIndex].members.push(item);
      continue;
    }

    if (key) entryIndexByKey.set(key, entries.length);
    entries.push({ primary: item, members: [item] });
  }

  return entries;
}

export interface MarqueeSplit {
  /** One card per entry -- a collapsed run still occupies exactly ONE
   *  Marquee slot, per the "Tour-Run Collapsing" handoff's own instruction
   *  not to let a six-date run count as six times as notable as a
   *  one-night show. */
  marquee: MarqueeEntry[];
  /** Deliberately NOT collapsed -- every individual date/listing appears
   *  on its own here, including the non-primary members of a run that DID
   *  collapse in Marquee (e.g. Disney On Ice's other 5 dates, once its
   *  earliest date is used as the Marquee entry). A dense list of repeated
   *  titles is a smaller visual cost here than in Marquee's large-image
   *  cards, and each one is still a real, individually bookable date with
   *  its own detail page -- so showing it is more honest than hiding it. */
  alsoOn: TicketmasterFeedItem[];
}

export function splitMarquee(ranked: RankedTicketmasterEvent[], marqueeSize: number = MARQUEE_SIZE): MarqueeSplit {
  const allEntries = collapseMarqueeRuns(ranked);
  const marquee = allEntries.slice(0, marqueeSize);
  const marqueePrimaryIds = new Set(marquee.map((entry) => entry.primary.ticketmasterEvent.id));
  const alsoOn = ranked
    .map((r) => r.item)
    .filter((item) => !marqueePrimaryIds.has(item.ticketmasterEvent.id));
  return { marquee, alsoOn };
}

/** What's On Phase 6b: is a stored weekly-intro row (identified by its own
 *  ISO year/week -- see lib/db.ts's WhatsOnIntroRow and
 *  ai_pipeline/whats_on_intro.py's week_bounds()) still describing the
 *  CURRENT week, per lib/this-week.ts's currentWeekInfo()? A block
 *  describing last week's events above this week's listing is worse than no
 *  block at all (handoff's own Step 4) -- kept as a separate, pure,
 *  synchronous function (rather than folded into the DB query itself) so
 *  this specific "is it stale" decision is unit-testable without a live DB,
 *  the same testability reason buildWhatsOnStatus() in lib/cityStatus.ts
 *  takes its data as a parameter instead of reaching for siteConfig/db.ts
 *  itself. */
export interface IsoWeek { isoYear: number; isoWeek: number }

export function isWhatsOnIntroFresh(introWeek: IsoWeek, currentWeek: IsoWeek): boolean {
  return introWeek.isoYear === currentWeek.isoYear && introWeek.isoWeek === currentWeek.isoWeek;
}
