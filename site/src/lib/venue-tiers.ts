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
  // Populated below by Object.assign from each town's own
  // TICKETMASTER_VENUE_TIERS_BY_NAME_* fallback map (What's On Phase 7
  // follow-up) -- no SDSU-equivalent name-keyed source exists for these
  // two towns, so unlike brookings_sd above there's nothing to merge INTO,
  // just the Ticketmaster fallback itself.
  moreno_valley_ca: {},
  broomfield_co: {},
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
  /**
   * What's On Phase 7 follow-up ("Venue Curation") -- top-end only, per
   * that handoff's own instruction: ranking doesn't need fine-grained
   * capacity data, only enough to keep genuine headliners above small-room
   * shows. Curated from the venues that actually appeared in Moreno
   * Valley's real top-20 ranked events at its calibrated 35mi radius
   * (2026-09-07 live pull), plus Toyota Arena/Pechanga/Yaamava from the
   * earlier radius-calibration report. Every tier below is a real, checked
   * public capacity figure (search date 2026-09-07), not a guess:
   *
   *   - Toyota Arena (Ontario): 11,089 full-capacity configuration. large.
   *   - Great Park Live (Irvine): 7,500, expanded to 10,000 GA. large.
   *   - Morongo Casino Resort and Spa (Cabazon): 7,500. large.
   *   - Yaamava' Theater / Yaamava Resort & Casino at San Manuel
   *     (Highland): the dedicated theater seats ~2,500-3,000; the
   *     generic "Resort & Casino" listing (a separate in-property space,
   *     real capacity not separately confirmed) is treated the same,
   *     both well above this market's next tier down. medium.
   *   - Pechanga Resort Casino (Temecula): the Summit event center seats
   *     3,100 (a separate 1,200-seat theater also exists on the same
   *     property). medium.
   *   - Riverside Municipal Auditorium: ~1,600 (sources range 1,400-1,776).
   *     medium.
   *   - Fox Performing Arts Center (Riverside): ~1,646. medium.
   *   - Ontario Improv: 350-seat comedy club -- curated explicitly AS
   *     small (see isVenueCurated()) rather than left to the default, so
   *     its 4 real top-20 appearances read as a deliberate choice, not an
   *     oversight.
   *   - Stage Red (Fontana): 400-500 seats. small.
   *   - Yucaipa Performing Arts Center Indoor Theatre: 291 seats. small.
   *
   * Everything else this market's real feed surfaces stays uncurated at
   * the default tier, deliberately -- this is a top-end-only pass, not an
   * attempt to catalog the whole Inland Empire market.
   */
  moreno_valley_ca: {
    ZFr9jZAvFe: 'medium', // Yaamava Resort & Casino at San Manuel
    KovZpZAFAkJA: 'medium', // Yaamava' Resort & Casino at San Manuel -- SAME
    // real venue, a second Discovery API id differing only by the
    // apostrophe in the display name (confirmed live 2026-09-07) -- kept
    // here too, belt-and-suspenders, on top of the name-keyed fallback
    // below now that normalizeVenueName() strips the apostrophe.
    Z7r9jZaAVT: 'medium', // Yaamava Theater (the resort's dedicated theater)
    KovZpZA1vvlA: 'medium', // Pechanga Resort Casino
    KovZpZAEA6FA: 'medium', // Riverside Municipal Auditorium
    KovZpZAEA6lA: 'medium', // Fox Performing Arts Center
    rZ7HnEZ178EPP: 'small', // Ontario Improv -- deliberately curated, not defaulted
    KovZ917ARhe: 'small', // Stage Red
    KovZ917ANgr: 'small', // Yucaipa Performing Arts Center Indoor Theatre
    ZFr9jZk1a7: 'large', // Toyota Arena (this specific id, seen live as "Toyota Arena-CA")
  },
  /**
   * What's On Phase 7 follow-up ("Venue Curation") -- same top-end-only
   * approach as Moreno Valley above. Curated from Broomfield's real top-20
   * ranked events at its calibrated 20mi radius (2026-09-07 live pull),
   * plus Ball Arena/Empower Field/Red Rocks -- confirmed live to fall
   * within 20mi (13mi and 19mi respectively) even though neither happened
   * to land in that day's specific top-20 date slice; Denver's own market
   * has enough near-term listings that particular top-20 snapshot shifts
   * day to day, but these two venues reliably recur. Real, checked public
   * capacity (search date 2026-09-07):
   *
   *   - Empower Field at Mile High: 76,125 (NFL), 85,000+ configured for
   *     concerts. large.
   *   - Ball Arena: ~19,000-20,000 depending on configuration. large.
   *   - Red Rocks Amphitheatre: 9,525. large.
   *   - Mission Ballroom: 2,200-3,950 (moving-stage configuration). large.
   *   - Fillmore Auditorium (Denver): ~3,600-3,900. medium.
   *   - Paramount Theatre (Denver): ~1,865. medium.
   *   - Cervantes' Masterpiece Ballroom: 1,450 combined (900 Ballroom +
   *     500 Other Side, connected rooms). medium.
   *   - Summit Music Hall: 1,100-1,350. medium.
   *   - The Federal Theatre: 648. medium.
   *   - Marquis Theater: 450. small.
   *   - Arvada Center (Main Stage Theatre): ~500-526. small.
   *
   * Real top-20 venues NOT curated here -- Moon Room at Summit, JUNKYARD,
   * Ophelia's Electric Soapbox, Grizzly Rose -- deliberately: no verified
   * public capacity figure was gathered for these in this pass (a scope
   * boundary, not an oversight; each appeared only once in the real top-20,
   * consistent with being genuinely small rooms). They stay at the default
   * tier and will keep surfacing in scripts/dump-event-ranking.ts's
   * "unmapped venues" section -- a real follow-up to close later, not a
   * silent gap.
   */
  broomfield_co: {
    KovZpZAFa1nA: 'medium', // Paramount Theatre
    Z7r9jZadVI: 'large', // Mission Ballroom
    KovZpZAFaJeA: 'large', // Ball Arena
    KovZpZAJeFkA: 'small', // Marquis Theater
    KovZpZAFFt1A: 'medium', // Summit Music Hall
    Zkr9jZ16es: 'small', // Arvada Center (Main Stage Theatre)
    ZFr9jZkk1d: 'medium', // Cervantes' Masterpiece Ballroom
    KovZ917AVFY: 'medium', // The Federal Theatre
    Z7r9jZakK6: 'medium', // The Federal Theatre -- SAME real venue, a second
    // Discovery API id (confirmed live 2026-09-07, same day, two different
    // listings each carrying a different id for this venue) -- the exact
    // same fragility as Denny Sanford PREMIER Center in Brookings, just
    // discovered here instead.
    KovZpZAE6eJA: 'medium', // Fillmore Auditorium (Denver)
    KovZpa3Wne: 'large', // Empower Field at Mile High
    KovZpZAaeIvA: 'large', // Red Rocks Amphitheatre
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
  // stripped by normalizeVenueName() itself (see that function's own
  // comment), so the stored key must match its OWN output, not the raw
  // pre-normalization name.
  'orpheum theater sioux falls': 'medium',
  'bigs sports bar': 'small',
};
Object.assign(VENUE_TIERS.brookings_sd, TICKETMASTER_VENUE_TIERS_BY_NAME);

/** Name-keyed fallback for Moreno Valley's id-curated venues above -- same
 *  belt-and-suspenders reasoning as Brookings' own fallback: a still-
 *  undiscovered id for one of these real venues resolves by name instead
 *  of landing at the default. Keys already reflect normalizeVenueName()'s
 *  own output (apostrophe stripped, no trailing state suffix). */
const MORENO_VALLEY_VENUE_TIERS_BY_NAME: Record<string, VenueTier> = {
  'yaamava resort & casino at san manuel': 'medium',
  'yaamava theater': 'medium',
  'pechanga resort casino': 'medium',
  'riverside municipal auditorium': 'medium',
  'fox performing arts center': 'medium',
  'ontario improv': 'small',
  'stage red': 'small',
  'yucaipa performing arts center indoor theatre': 'small',
  'toyota arena': 'large',
};
Object.assign(VENUE_TIERS.moreno_valley_ca, MORENO_VALLEY_VENUE_TIERS_BY_NAME);

/** Name-keyed fallback for Broomfield's id-curated venues above -- same
 *  reasoning as Moreno Valley's fallback immediately above. */
const BROOMFIELD_VENUE_TIERS_BY_NAME: Record<string, VenueTier> = {
  'paramount theatre': 'medium',
  'mission ballroom': 'large',
  'ball arena': 'large',
  'marquis theater': 'small',
  'summit music hall': 'medium',
  'arvada center': 'small',
  'cervantes masterpiece ballroom': 'medium', // apostrophe stripped by normalizeVenueName()
  'the federal theatre': 'medium',
  'fillmore auditorium (denver)': 'medium',
  'empower field at mile high': 'large',
  'red rocks amphitheatre': 'large',
};
Object.assign(VENUE_TIERS.broomfield_co, BROOMFIELD_VENUE_TIERS_BY_NAME);

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
