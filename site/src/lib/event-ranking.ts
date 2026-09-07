/** What's On Phase 2: a deterministic notability ranking on top of Phase 1's
 *  buildEventFeed() output. Pure, no I/O -- takes an already-built
 *  EventFeedResult in, returns ranked data out, same "directly unit-
 *  testable" shape as lib/accent-contrast.ts.
 *
 *  Not wired into any page or the build yet -- this phase is config +
 *  algorithm + a way to inspect the output (scripts/dump-event-ranking.ts),
 *  reviewed against real data before anything renders it (Phase 5).
 *
 *  Inputs are deliberately limited to what buildEventFeed() already
 *  exposes, plus the new venue tier config -- no new data collection this
 *  phase:
 *    - venue capacity tier (lib/venue-tiers.ts) -- the primary signal.
 *    - cross-source match count (EventFeedResult.alsoListedBy) -- an event
 *      independently listed by more than one source (e.g. Brookings'
 *      "Downtown at Sundown", carried by both SDSU and the Chamber) is a
 *      real, already-available notability signal, not a guess.
 */
import type { FeedItem, EventFeedResult } from './events';
import { itemTitle, itemVenue } from './events';
import { venueTierFor, venueTierRank, type VenueTier } from './venue-tiers';

const VENUE_TIER_WEIGHT = 10;
const CROSS_MATCH_WEIGHT = 5;

export interface RankedEvent {
  item: FeedItem;
  /** Total score -- higher ranks first. Sum of the two components below,
   *  not just a final order, so a human reviewing a dump can see WHY an
   *  event ranked where it did (Step 2's own requirement). */
  score: number;
  venueTier: VenueTier;
  venueTierScore: number;
  crossMatchCount: number;
  crossMatchScore: number;
}

/**
 * Deterministic: same feed + same town in -> same order out, always.
 * No reliance on wall-clock time (buildEventFeed() already resolved
 * "future" before this runs) or on unordered-structure iteration order --
 * ties are broken by soonest occurs_at, then by title, so two events with
 * an identical score never depend on their position in the input array.
 * Sorts descending by score (most notable first); an empty or single-item
 * feed returns trivially (`[]` or a one-element array) without error.
 */
export function rankEvents(feed: EventFeedResult, townId: string): RankedEvent[] {
  const ranked: RankedEvent[] = feed.items.map((item) => {
    const venueTier = venueTierFor(townId, itemVenue(item));
    const venueTierScore = venueTierRank(venueTier) * VENUE_TIER_WEIGHT;
    const crossMatchCount = feed.alsoListedBy.get(item)?.length ?? 0;
    const crossMatchScore = crossMatchCount * CROSS_MATCH_WEIGHT;
    return {
      item,
      score: venueTierScore + crossMatchScore,
      venueTier,
      venueTierScore,
      crossMatchCount,
      crossMatchScore,
    };
  });

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aTime = a.item.occurs_at ? new Date(a.item.occurs_at).getTime() : Infinity;
    const bTime = b.item.occurs_at ? new Date(b.item.occurs_at).getTime() : Infinity;
    if (aTime !== bTime) return aTime - bTime;
    return itemTitle(a.item).localeCompare(itemTitle(b.item));
  });

  return ranked;
}
