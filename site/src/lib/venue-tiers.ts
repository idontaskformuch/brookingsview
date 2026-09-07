/** What's On Phase 2: per-town venue capacity tiers -- new infrastructure,
 *  no prior "venue size" concept existed anywhere in this codebase before
 *  this file. Feeds lib/event-ranking.ts's notability score.
 *
 *  Tiers are a small ordered set, not raw capacity numbers -- exact seat
 *  counts are rarely knowable from a scraped `location`/`venue_raw` string,
 *  and the ranking only needs RELATIVE size, not a real number.
 *
 *  Keyed per-town (Record<townId, Record<venueName, tier>>), not a flat
 *  venue-name map -- the same town-first shape as config/category-images.ts
 *  -- so a Ticketmaster venue (Phase 3, same or a different town) is a new
 *  entry under its own town, never a redesign, and two towns can each have
 *  a venue with the same generic name (e.g. a "Community Room") without
 *  colliding.
 */

export type VenueTier = 'large' | 'medium' | 'small';

/** Lowest to highest, for numeric comparison in ranking -- see
 *  venueTierRank(). Small is deliberately last-resort: see
 *  DEFAULT_VENUE_TIER below. */
const VENUE_TIER_ORDER: VenueTier[] = ['small', 'medium', 'large'];

export function venueTierRank(tier: VenueTier): number {
  return VENUE_TIER_ORDER.indexOf(tier);
}

/** Applied to any venue string not found in VENUE_TIERS for its town --
 *  including a genuinely new venue that starts appearing in scraped data
 *  after this file was last updated. Lowest tier, not a crash and not a
 *  silent drop: an unranked venue should never accidentally outrank a
 *  known small venue, but it must not break the build either. */
export const DEFAULT_VENUE_TIER: VenueTier = 'small';

function normalize(venueName: string): string {
  return venueName.trim().toLowerCase();
}

/**
 * Brookings' real distinct `sdsu_events.location` values for upcoming
 * arts_culture rows, pulled live from production data (2026-09-07: `SELECT
 * location, count(*) FROM sdsu_events WHERE town_id='brookings_sd' AND
 * bucket='arts_culture' AND NOT is_filtered AND starts_at >= now() -
 * interval '3 hours' GROUP BY location`) rather than guessed. Tiers are a
 * judgment call, not a measured fact (see this file's own docstring on why
 * exact capacity isn't the input) -- reasoning per venue:
 *
 *   - Oscar Larson Performing Arts Center: SDSU's flagship indoor
 *     performance hall -- the one venue in this list built specifically for
 *     large ticketed audiences. large.
 *   - University Student Union / Outdoor Areas / Coolidge Sylvan Theatre
 *     (an outdoor amphitheater): multi-purpose spaces that can hold a
 *     sizable crowd but aren't dedicated performance venues. medium.
 *   - Everything else (two campus museums, the gardens visitor center, a
 *     residence/academic hall, a commons area, an ag building, and the
 *     catch-all "Off-Campus") is a smaller, single-purpose or ambiguous
 *     space. small -- listed explicitly rather than left to the default so
 *     the choice is visible and reviewable, not silent.
 */
const VENUE_TIERS: Record<string, Record<string, VenueTier>> = {
  brookings_sd: {
    'the oscar larson performing arts center': 'large',
    'university student union': 'medium',
    'outdoor areas': 'medium',
    'coolidge sylvan theatre': 'medium',
    'south dakota art museum': 'small',
    'mccrory gardens education and visitor center': 'small',
    'south dakota agricultural heritage museum': 'small',
    'off-campus': 'small',
    'lincoln hall': 'small',
    'larson commons': 'small',
    'raven precision agriculture center': 'small',
  },
};

/** `venueName` is whatever a FeedItem's own venue field holds -- a
 *  SdsuEvent's `location`, or a Story's `venue_raw` -- both nullable in
 *  practice (2 of Brookings' live arts_culture rows have a null
 *  `location`). Never throws on null/empty/unrecognized input. */
export function venueTierFor(townId: string, venueName: string | null | undefined): VenueTier {
  if (!venueName) return DEFAULT_VENUE_TIER;
  const normalized = normalize(venueName);
  if (!normalized) return DEFAULT_VENUE_TIER;
  return VENUE_TIERS[townId]?.[normalized] ?? DEFAULT_VENUE_TIER;
}
