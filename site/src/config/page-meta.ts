/** Sitewide title/H1/lede handoff -- the pattern catalog `resolvePageMeta()`
 *  (site/src/lib/page-meta.ts) reads from. Shared across all three towns;
 *  a town overrides an entry only where it genuinely differs (sports'
 *  own framing today -- see TOWN_OVERRIDES below), matching the same
 *  "shared defaults, narrow per-town override" shape category-images.ts's
 *  own CATEGORY_IMAGES/Broomfield-aliasing precedent already established.
 *
 *  `{Town}`/`{Site}` interpolate from siteConfig.cityName/siteName. A
 *  pattern needing an extra placeholder (facility detail's own
 *  `{FacilityName}`) passes it via resolvePageMeta()'s own `extraVars`
 *  param -- the catalog entry just names the token, it doesn't know where
 *  the value comes from.
 *
 *  `ledeRequirement` is documentation for a human (and, later, the
 *  build-time validation check) about what the page's own HAND-WRITTEN
 *  lede prose must satisfy -- never a template string to render from.
 *  "Ledes stay in content, not config" per the handoff's own instruction:
 *  a good lede already exists on several of these pages (/city-hall/ is
 *  the reference example) and this catalog must never risk mangling it.
 *
 *  Deliberately EXCLUDES /recipes/, /editorials/, /columns/: these are
 *  Phase C cross-site-canonical content (see lib/cross-site-canonical.ts)
 *  -- a town-specific keyword pattern here would compete with, not
 *  complement, that already-shipped canonical-consolidation logic. The
 *  handoff's own text names this exact tradeoff and asks to check Phase C
 *  before touching them; the check says leave them alone.
 *
 *  Also excludes the homepage (masthead already carries the town name,
 *  per the handoff's own H1 exception), story pages (already have
 *  per-item generated titles; only the length/uniqueness GUARD applies,
 *  not a template pattern), and trust pages (explicitly "no keyword
 *  optimization" -- length/single-H1 guard only).
 */
export interface PageMetaPattern {
  titlePattern: string;
  h1Pattern: string;
  /** Documentation only -- see this module's own doc comment. */
  ledeRequirement?: string;
}

// LENGTH CALIBRATION NOTE: every titlePattern below is verified (see
// page-meta.test.ts) to stay <= 65 chars for all three REAL towns, not
// just a hypothetical short one. The handoff's own literal example
// strings assumed town names shorter than "Moreno Valley" (13 chars, the
// longest of the three) -- several blew the 65-char hard-fail line as
// originally written (e.g. "{Town} City Council Meetings, Summarized |
// {Site}" hit 68 chars for Moreno Valley) and were shortened here
// (dropping redundant words like "City" before "Council", where
// "Council" alone already says government) rather than either loosening
// the limit or leaving a town-specific overflow to be caught later by
// the validation phase. facility-detail is the one page type that can't
// be fully solved this way -- see its own comment below.
export const PAGE_META_PATTERNS: Record<string, PageMetaPattern> = {
  'city-hall': {
    titlePattern: '{Town} Council Meetings, Summarized | {Site}',
    h1Pattern: '{Town} City Hall: Council and Planning Meetings in Plain Language',
    // Keep existing -- already good, see this handoff's own reference example.
  },
  'city-hall/archive': {
    titlePattern: '{Town} Meeting Archive by Month | {Site}',
    h1Pattern: "Every {Town} Council and Commission Meeting We've Covered",
    ledeRequirement: 'State the date range covered and that each entry links to the original agenda.',
  },
  'city-hall/projects': {
    titlePattern: '{Town} Projects, Tracked by Meeting | {Site}',
    h1Pattern: 'Active {Town} Projects, Followed Meeting by Meeting',
  },
  events: {
    titlePattern: 'Things to Do in {Town} This Week | {Site}',
    h1Pattern: '{Town} Events: Today, This Weekend, and Coming Up',
    ledeRequirement: 'Name the actual sources (library, city, chamber) and the update cadence.',
  },
  'whats-on': {
    titlePattern: 'Concerts and Shows Near {Town} | {Site}',
    h1Pattern: 'Live Music, Theatre and Festivals Within Driving Distance of {Town}',
    ledeRequirement: 'NON-NEGOTIABLE anti-doorway disclosure: must state the radius and that drive times are shown.',
  },
  today: {
    titlePattern: '{Town} Today: Weather and Events | {Site}',
    h1Pattern: "What's Happening in {Town} Today",
  },
  'this-week': {
    titlePattern: '{Town} This Week: Events and Meetings | {Site}',
    h1Pattern: 'The Week Ahead in {Town}',
  },
  traffic: {
    titlePattern: '{Town} Road Closures and Traffic | {Site}',
    h1Pattern: 'Current Road Work and Incidents Around {Town}',
    ledeRequirement: 'Name the DOT source and state the refresh interval.',
  },
  closures: {
    titlePattern: '{Town} School and Facility Closures | {Site}',
    h1Pattern: '{Town} Closure Watch: Schools, Facilities and Weather Alerts',
    ledeRequirement: 'Must include the existing never-predicts-a-closure disclaimer.',
  },
  facilities: {
    titlePattern: '{Town} Libraries, Parks and Buildings | {Site}',
    h1Pattern: 'Public Facilities in {Town}: Hours, Addresses and Contacts',
  },
  // {FacilityName} supplied via resolvePageMeta()'s extraVars -- see
  // facilities/[slug].astro's own call site. Lede requirement already
  // satisfied by lib/facility-lede.ts (shipped separately, see
  // NEEDS-HUMAN-REVIEW.md #46) -- these pages already earn Broomfield's
  // civic-reference impressions, treated as high value, not boilerplate.
  //
  // KNOWN, UNAVOIDABLE EXCEPTION to the 65-char hard-fail rule: even this
  // shortest possible form (facility name + site suffix, no extra words
  // at all) still exceeds 65 chars for the longest real facility names
  // combined with a longer town's site suffix -- confirmed against real
  // data, e.g. "Brookings City Hall (City & County Government Center)"
  // is 53 chars alone. No amount of surrounding-word trimming fixes
  // this; the facility's own official name can't be shortened without
  // misrepresenting it. Flagged for the validation phase (page_meta_check,
  // not built yet) to carry a named per-slug exception list, same
  // "known exception, not silently violated" convention as
  // build-checks.ts's own KNOWN_VENUE_MATCHING_GAPS.
  'facilities/detail': {
    titlePattern: '{FacilityName} | {Site}',
    h1Pattern: '{FacilityName}: Hours, Location and What\'s There',
    ledeRequirement: 'Must include the street address in prose form (already shipped, see facility-lede.ts).',
  },
  'home-sales': {
    titlePattern: 'Recent Home Sales in {Town} | {Site}',
    h1Pattern: 'What Homes Are Actually Selling For in {Town}',
    ledeRequirement: "Name the assessor source and the reporting lag.",
  },
  'workplace-watch': {
    titlePattern: "Working at {Town}'s Biggest Employers | {Site}",
    h1Pattern: '{Town} Worker Pulse: What Employees Say About Local Employers',
    ledeRequirement: 'Must carry the existing attribution hedge -- everything is from reviews, nothing stated as fact.',
  },
  jobs: {
    titlePattern: 'Jobs Hiring Now in {Town} | {Site}',
    h1Pattern: 'Current Job Openings in and Around {Town}',
  },
  // Base pattern; TOWN_OVERRIDES below supplies each town's own H1 framing
  // (Jackrabbits for Brookings, regional-affiliate for Moreno Valley) --
  // the handoff's own "pull the framing from town config" instruction.
  sports: {
    titlePattern: '{Town} Sports Scores and Schedule | {Site}',
    h1Pattern: '{Town} Area Sports Scores and Schedule',
  },
  weather: {
    titlePattern: '{Town} Weather Forecast and Alerts | {Site}',
    h1Pattern: '{Town} Forecast, Alerts and What They Mean',
  },
  'free-things-to-do': {
    // Built off a real Search Console query -- keep the title close to
    // the query wording, per the handoff's own instruction.
    titlePattern: 'Free Things to Do in {Town} | {Site}',
    h1Pattern: 'Free Events, Parks and Places in {Town}',
  },
};

/** Per-town overrides, narrow on purpose -- only sports' H1 framing
 *  differs today. Brookings gets the Jackrabbits angle (a real, named
 *  program this site already covers in depth); Moreno Valley gets the
 *  regional-affiliate framing (no home NCAA program there). Broomfield
 *  has no /sports/ route at all (see site-config.ts's own townId checks
 *  in that page), so it needs no entry here. */
export const TOWN_OVERRIDES: Record<string, Partial<Record<string, Partial<PageMetaPattern>>>> = {
  brookings_sd: {
    sports: { h1Pattern: '{Town}-Area Sports: Jackrabbits, Prep and Regional Scores' },
  },
  moreno_valley_ca: {
    sports: { h1Pattern: '{Town}-Area Sports: Regional and Affiliate Team Scores' },
  },
};
