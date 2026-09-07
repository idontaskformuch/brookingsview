/** What's On Phase 5 -- ranks Ticketmaster events for the Marquee/Also-on
 *  split, reusing Phase 2's venue-tier concept (venueTierFor/venueTierRank)
 *  rather than forcing TicketmasterFeedItem through Phase 1/2's FeedItem-
 *  typed rankEvents(). Kept standalone for the same reason lib/
 *  ticketmaster.ts's own TicketmasterFeedItem stayed out of the FeedItem
 *  union: rankEvents() operates on EventFeedResult.items (FeedItem[]), and
 *  unioning Ticketmaster in would force type-narrowing changes onto Phase
 *  1's real page consumers for no benefit here -- this page never merges
 *  its list with the story/arts feed. */
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
    const venueTier = venueTierFor(townId, item.ticketmasterEvent.venueName);
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
 *  held up against the real ~40-event Brookings dataset. */
export const MARQUEE_SIZE = 6;

export interface MarqueeSplit {
  marquee: TicketmasterFeedItem[];
  alsoOn: TicketmasterFeedItem[];
}

export function splitMarquee(ranked: RankedTicketmasterEvent[], marqueeSize: number = MARQUEE_SIZE): MarqueeSplit {
  const marquee = ranked.slice(0, marqueeSize).map((r) => r.item);
  const alsoOn = ranked.slice(marqueeSize).map((r) => r.item);
  return { marquee, alsoOn };
}
