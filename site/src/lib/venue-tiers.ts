/** What's On Phase 2: per-town venue capacity tiers -- new infrastructure,
 *  no prior "venue size" concept existed anywhere in this codebase before
 *  this file. Feeds lib/event-ranking.ts's and lib/whats-on.ts's notability
 *  scores.
 *
 *  Tiers are a small ordered set, not raw capacity numbers -- real seat
 *  counts (see below) are used to CHOOSE a tier at curation time, but the
 *  ranking itself only ever compares tiers, never numbers.
 *
 *  Keyed per-town (Record<townId, Record<venueName, tier>>), not a flat
 *  venue-name map -- the same town-first shape as config/category-images.ts
 *  -- so a Ticketmaster venue (Phase 3, same or a different town) is a new
 *  entry under its own town, never a redesign, and two towns can each have
 *  a venue with the same generic name (e.g. a "Community Room") without
 *  colliding.
 *
 *  Two lookup maps, ID-based checked first (What's On Phase 5 follow-up,
 *  "Radius Fix" review): a Ticketmaster venue's own Discovery API id is
 *  stable, but its display NAME can drift (arena sponsorship renames are
 *  common -- "Denny Sanford PREMIER Center" itself is a naming-rights deal,
 *  the kind of name that changes). SDSU arts_culture venues have no id
 *  concept at all (they come from sdsu_events.location, a plain scraped
 *  string) -- those stay name-keyed, checked as the fallback. See
 *  venueTierFor()'s own doc comment for the exact precedence.
 */

export type VenueTier = 'large' | 'medium' | 'small';

/** Lowest to highest, for numeric comparison in ranking -- see
 *  venueTierRank(). Small is deliberately last-resort: see
 *  DEFAULT_VENUE_TIER below. */
const VENUE_TIER_ORDER: VenueTier[] = ['small', 'medium', 'large'];

export function venueTierRank(tier: VenueTier): number {
  return VENUE_TIER_ORDER.indexOf(tier);
}

/** Applied to any venue not found in either lookup map for its town --
 *  including a genuinely new venue that starts appearing in scraped/fetched
 *  data after this file was last updated. Lowest tier, not a crash and not
 *  a silent drop: an unranked venue should never accidentally outrank a
 *  known small venue, but it must not break the build either.
 *
 *  "Silent" is the operative risk this default carries -- see What's On
 *  Phase 5's own human review finding: an unmapped venue landing here
 *  invisibly is exactly what let a genuinely major touring act (Zac Brown
 *  Band, Denny Sanford PREMIER Center) rank behind small club shows before
 *  that venue was curated. scripts/dump-event-ranking.ts's own
 *  "unmapped venues" section exists specifically to surface this at review
 *  time -- see that script for the visibility half of this fix; this file
 *  only owns the fallback behavior itself, which stays unchanged (never
 *  crash, never silently drop). */
export const DEFAULT_VENUE_TIER: VenueTier = 'small';

/** Every US state's 2-letter postal code (plus DC) -- narrow in WHAT
 *  normalizeVenueName() below strips (only a trailing, hyphen-attached
 *  2-letter code that's a REAL state abbreviation), not in WHICH states it
 *  applies to. Deliberately a fixed literal list rather than importing one
 *  from elsewhere in the codebase (e.g. validation/place_state.py's
 *  US_STATE_NAMES is full names, a different shape for a different job). */
const US_STATE_ABBRS = new Set([
  'al', 'ak', 'az', 'ar', 'ca', 'co', 'ct', 'de', 'fl', 'ga', 'hi', 'id', 'il',
  'in', 'ia', 'ks', 'ky', 'la', 'me', 'md', 'ma', 'mi', 'mn', 'ms', 'mo', 'mt',
  'ne', 'nv', 'nh', 'nj', 'nm', 'ny', 'nc', 'nd', 'oh', 'ok', 'or', 'pa', 'ri',
  'sc', 'sd', 'tn', 'tx', 'ut', 'vt', 'va', 'wa', 'wv', 'wi', 'wy', 'dc',
]);

// A trailing "-XX" or " - XX", with or without surrounding spaces --
// confirmed live (What's On Phase 7 follow-up, "Venue Curation"): Discovery
// API returns the SAME real venue as both "Toyota Arena" and
// "Toyota Arena-CA" (no spaces) and, already in this file's own map before
// this fix, "Orpheum Theater Sioux Falls - SD" (spaced). Checked against
// US_STATE_ABBRS above before stripping, not stripped unconditionally --
// a bare "-XX" suffix that ISN'T a real state code is left alone, since a
// venue's own name legitimately ending that way is far less likely than a
// real state-code suffix, but not impossible.
const _TRAILING_STATE_SUFFIX_RE = /\s*-\s*([a-z]{2})$/i;

/** Narrow, explicit normalization -- NOT aggressive fuzzy matching (What's
 *  On Phase 7 follow-up, "Venue Curation"). Strips only apostrophes
 *  (straight and curly -- "Yaamava' Resort & Casino" vs "Yaamava Resort &
 *  Casino", confirmed live as the SAME real venue) and a trailing real
 *  state-code suffix (see above), then collapses whitespace. Deliberately
 *  does NOT strip other punctuation (an ampersand is meaningful --
 *  "Icon Events & Dada Gastropub" -- and a mid-name hyphen might be too):
 *  collapsing two genuinely DIFFERENT venues into one match is a worse
 *  failure than missing a real duplicate, so normalization stays narrow
 *  and each addition here is backed by a real confirmed-live duplicate,
 *  never a guess at what else might vary. */
export function normalizeVenueName(venueName: string): string {
  let s = venueName.trim().toLowerCase().replace(/['’]/g, '');
  const stateSuffix = _TRAILING_STATE_SUFFIX_RE.exec(s);
  if (stateSuffix && US_STATE_ABBRS.has(stateSuffix[1].toLowerCase())) {
    s = s.slice(0, stateSuffix.index);
  }
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Brookings' real distinct `sdsu_events.location` values for upcoming
 * arts_culture rows, pulled live from production data (2026-09-07: `SELECT
 * location, count(*) FROM sdsu_events WHERE town_id='brookings_sd' AND
 * bucket='arts_culture' AND NOT is_filtered AND starts_at >= now() -
 * interval '3 hours' GROUP BY location`) rather than guessed. Tiers are a
 * judgment call informed by real capacity data where it was checked --
 * reasoning per venue:
 *
 *   - Oscar Larson Performing Arts Center: SDSU's flagship indoor
 *     performance complex -- but real capacity (verified 2026-09-07, public
 *     source: sdstate.edu's own building page), its largest single hall
 *     (Larson Memorial Concert Hall) seats 1,000, smaller than several of
 *     the Sioux Falls venues now curated below (Washington Pavilion 1,800,
 *     The District 1,500, Grand Falls Casino Resort 1,100). REVISED from
 *     large to medium here specifically because leaving it at "large"
 *     while correctly tiering the Sioux Falls venues by real capacity would
 *     have reintroduced the exact inconsistency this whole curation pass
 *     exists to fix (a smaller real venue outranking a bigger one). No
 *     other Brookings venue below was re-verified in this pass -- this is
 *     a narrow, evidence-driven correction of the one entry the new data
 *     directly contradicted, not a re-audit of the whole list.
 *   - University Student Union / Outdoor Areas / Coolidge Sylvan Theatre
 *     (an outdoor amphitheater): multi-purpose spaces that can hold a
 *     sizable crowd but aren't dedicated performance venues, not
 *     capacity-verified. medium.
 *   - Everything else (two campus museums, the gardens visitor center, a
 *     residence/academic hall, a commons area, an ag building, and the
 *     catch-all "Off-Campus") is a smaller, single-purpose or ambiguous
 *     space, not capacity-verified. small -- listed explicitly rather than
 *     left to the default so the choice is visible and reviewable, not
 *     silent.
 */
const VENUE_TIERS: Record<string, Record<string, VenueTier>> = {
  brookings_sd: {
    'the oscar larson performing arts center': 'medium',
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

/**
 * Ticketmaster venues actually observed in Brookings' real 75-mile Discovery
 * API feed (What's On Phase 5 follow-up, "Radius Fix" review, 2026-09-07),
 * keyed by Discovery API's own stable venue id -- see this file's own
 * module comment for why id, not name. Every tier below is a real, checked
 * public capacity figure (search date 2026-09-07), not a guess:
 *
 *   - Denny Sanford PREMIER Center (Sioux Falls): ~10,000-12,000 (concert
 *     configuration). The only venue in this town's entire feed -- SDSU
 *     campus included -- built for arena-scale audiences. large.
 *   - Washington Pavilion of Arts & Science, Mary W. Sommervold Great Hall
 *     (Sioux Falls): 1,800, hosts touring Broadway/national acts. medium.
 *   - The District (Sioux Falls): 1,500 max capacity concert venue. medium.
 *   - Grand Falls Casino Resort Event Center (Larchwood, IA, within the
 *     75-mile radius): ~1,100. medium.
 *   - Icon Events & Dada Gastropub (Sioux Falls): up to 700 in its main
 *     gastropub space -- real capacity places it above Orpheum Theater
 *     despite reading, by name alone, like a smaller room. medium.
 *   - Orpheum Theater Sioux Falls: 686, a real dedicated historic theater
 *     (opened 1913, still hosts national touring comedy/music). medium.
 *   - BIGS Sports Bar (Sioux Falls): 300, a neighborhood bar/live-music
 *     room. small.
 *
 * Curated ONLY for venues actually seen in a live response -- per the
 * original Phase 3 follow-up's own instruction, a venue that hasn't
 * appeared yet stays uncurated rather than guessed from a list of
 * plausible regional venues.
 */
const VENUE_TIERS_BY_ID: Record<string, Record<string, VenueTier>> = {
  brookings_sd: {
    KovZpZAJAl7A: 'large', // Denny Sanford PREMIER Center
    Z7r9jZaers: 'large', // Denny Sanford PREMIER Center -- SAME real venue, a
    // SECOND, different Discovery API venue id. Confirmed live 2026-09-07:
    // "Zac Brown Band w/ Brothers Osborne" and "Zach Top w/ Marty Stuart &
    // His Fabulous Superlatives" both carry this id while every other
    // Denny Sanford listing in the same feed (Jonas Brothers, Bert
    // Kreischer, Disney On Ice, ...) carries KovZpZAJAl7A -- Ticketmaster's
    // own data has two venue records for one physical building. This is
    // the fragility this file's module comment warned about, just the
    // OPPOSITE direction expected (id drifted, not name) -- confirmed by
    // this specific real duplicate, not hypothetical. See VENUE_TIERS'
    // name-keyed fallback below, added specifically so a THIRD undiscovered
    // id for the same venue still resolves correctly by name.
    ZFr9jZA7a6: 'medium', // Washington Pavilion of Arts & Science
    ZFr9jZ11FA: 'medium', // The District
    ZFr9jZaAkv: 'medium', // Grand Falls Casino Resort
    rZ7HnEZ178xxA: 'medium', // Icon Events & Dada Gastropub
    ZFr9jZF6eF: 'medium', // Orpheum Theater Sioux Falls
    rZ7HnEZ178s_A: 'small', // BIGS Sports Bar
  },
};

/** Name-keyed fallback for the same real Ticketmaster venues curated by id
 *  above -- a second safety net, added after confirming LIVE that Discovery
 *  API can assign more than one venue id to the same physical venue (see
 *  VENUE_TIERS_BY_ID's own comment on the Denny Sanford PREMIER Center
 *  case). If a third, still-uncurated id for one of these venues shows up,
 *  this lets venueTierFor() still resolve the correct tier by name instead
 *  of silently landing at the default. Merged into the SAME `brookings_sd`
 *  entry as the SDSU arts_culture venues above -- both are real Brookings-
 *  town venue names, one map. */
const TICKETMASTER_VENUE_TIERS_BY_NAME: Record<string, VenueTier> = {
  'denny sanford premier center': 'large',
  'washington pavilion of arts & science': 'medium',
  'the district': 'medium',
  'grand falls casino resort': 'medium',
  'icon events & dada gastropub': 'medium',
  // Was 'orpheum theater sioux falls - sd' -- the trailing " - SD" is now
  // stripped by normalize() itself (see that function's own comment), so
  // the stored key must match its OWN output, not the raw pre-normalized
  // name.
  'orpheum theater sioux falls': 'medium',
  'bigs sports bar': 'small',
};
Object.assign(VENUE_TIERS.brookings_sd, TICKETMASTER_VENUE_TIERS_BY_NAME);

/**
 * `venueName` is whatever a FeedItem's own venue field holds -- a
 * SdsuEvent's `location`, a Story's `venue_raw`, or a TicketmasterEvent's
 * `venueName` -- all nullable in practice (2 of Brookings' live
 * arts_culture rows have a null `location`). `venueId` is optional and
 * Ticketmaster-only (SDSU/story sources have no id concept) -- when
 * present, it's checked FIRST; a miss (unknown/absent id, or a genuine
 * second id for an already-curated venue -- see VENUE_TIERS_BY_ID's own
 * comment for a real confirmed example) falls through to the name-keyed
 * map rather than the default, so venue id instability degrades to
 * name-based matching rather than straight to "unmapped." Never throws on
 * null/empty/unrecognized input.
 */
export function venueTierFor(
  townId: string,
  venueName: string | null | undefined,
  venueId?: string | null,
): VenueTier {
  if (venueId) {
    const byId = VENUE_TIERS_BY_ID[townId]?.[venueId];
    if (byId) return byId;
  }
  if (!venueName) return DEFAULT_VENUE_TIER;
  const normalized = normalizeVenueName(venueName);
  if (!normalized) return DEFAULT_VENUE_TIER;
  return VENUE_TIERS[townId]?.[normalized] ?? DEFAULT_VENUE_TIER;
}

/** Whether this venue has a REAL curated entry (by id or by name), as
 *  opposed to having merely resolved to the default tier -- these are NOT
 *  the same question, since a venue can be deliberately curated AS
 *  'small' (BIGS Sports Bar, see VENUE_TIERS_BY_ID) and DEFAULT_VENUE_TIER
 *  is also 'small'. Comparing `venueTierFor(...) === DEFAULT_VENUE_TIER`
 *  can't tell those apart -- confirmed live: scripts/dump-event-ranking.ts's
 *  own "unmapped venues" section first version did exactly that and wrongly
 *  flagged BIGS Sports Bar as unmapped. This function exists specifically
 *  so that review-time check asks the right question. */
export function isVenueCurated(
  townId: string,
  venueName: string | null | undefined,
  venueId?: string | null,
): boolean {
  if (venueId && VENUE_TIERS_BY_ID[townId]?.[venueId]) return true;
  if (!venueName) return false;
  const normalized = normalizeVenueName(venueName);
  return Boolean(normalized && VENUE_TIERS[townId]?.[normalized]);
}
