/** Sitewide title/H1/lede handoff -- the pattern catalog `resolvePageMeta()`
 *  (site/src/lib/page-meta.ts) reads from. Shared across all three towns;
 *  a town can override an entry where it genuinely differs for the SAME
 *  route (see TOWN_OVERRIDES below -- empty today, see its own comment),
 *  matching the same "shared defaults, narrow per-town override" shape
 *  category-images.ts's own CATEGORY_IMAGES/Broomfield-aliasing precedent
 *  already established.
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
  // this-week/[week].astro is a per-instance DATED archive (one page per
  // ISO week, kept forever), not a static hub -- unlike every other entry
  // in this catalog, its title/H1 MUST differ per instance or every past
  // week's page would carry an identical title (a real, direct violation
  // of the handoff's own "every indexable route's title is unique within
  // its town" rule). {WeekLabel} supplied via resolvePageMeta()'s
  // extraVars from that page's own week.label (e.g. "September 8-14,
  // 2026"). Also fixes a real pre-existing bug: the ORIGINAL <h1> was
  // just {week.label} alone, with no town name in it at all -- failing
  // the handoff's own "H1 must contain the town name" rule outright, not
  // just imperfectly.
  //
  // SECOND known, rare, accepted exception to the 65-char rule (see
  // facilities/detail above for the first): the one ISO week per year
  // that crosses a calendar-year boundary gets a much longer label from
  // formatWeekLabel() (site/src/lib/this-week.ts) -- e.g. "December 29,
  // 2025 - January 4, 2026" -- which pushes Moreno Valley's own title
  // past 65 chars (confirmed: 79 chars with the full label, still 70
  // even with abbreviated month names). Not fixed by changing
  // formatWeekLabel() itself: that function's output is real, visible
  // page content on this page (not just the title), so shortening it
  // sitewide to fit one metadata field one week a year would be the tail
  // wagging the dog. Flagged for the validation phase's exception list,
  // same as facilities/detail.
  'this-week': {
    titlePattern: '{Town}: Week of {WeekLabel} | {Site}',
    h1Pattern: 'The Week Ahead in {Town}: {WeekLabel}',
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
  // CORRECTION to the handoff's own assumption: it describes "/sports/"
  // as one shared route needing per-town H1 framing ("Brookings gets the
  // Jackrabbits angle, Moreno Valley the regional-affiliate angle"). The
  // real architecture is two entirely SEPARATE pages: /sports/ is
  // Moreno-Valley-only (site/src/pages/sports.astro redirects every other
  // town away), and Brookings has its own dedicated /jackrabbits/ page
  // instead (site/src/pages/jackrabbits.astro) -- see that entry below.
  // Broomfield has neither. Since Moreno Valley is the ONLY real caller of
  // this route key, the regional-affiliate framing (no home NCAA program
  // there, hence "affiliate" not a named team) lives directly in the base
  // pattern rather than as a TOWN_OVERRIDES entry with exactly one member --
  // that indirection would document a distinction that no longer exists.
  sports: {
    titlePattern: '{Town} Sports Scores and Schedule | {Site}',
    h1Pattern: '{Town}-Area Sports: Regional and Affiliate Team Scores',
  },
  // Brookings-only (site/src/pages/jackrabbits.astro redirects every
  // other town away) -- SDSU is a real, specific, already-covered-in-
  // depth program, a stronger keyword than a generic "sports" framing
  // would be for this town specifically.
  jackrabbits: {
    titlePattern: 'SDSU Jackrabbits Schedules and Results | {Site}',
    h1Pattern: 'SDSU Jackrabbits in {Town}: Schedules and Results',
  },
  weather: {
    titlePattern: '{Town} Weather Forecast and Alerts | {Site}',
    h1Pattern: '{Town} Forecast, Alerts and What They Mean',
  },
  // CORRECTION to the handoff's own claim: it describes this as "built off
  // a real Search Console query," implying the page already exists.
  // Confirmed via repo-wide search (file paths and route strings) that
  // /free-things-to-do/ does not exist anywhere in this codebase -- no
  // page, no redirect, nothing to migrate. Left registered but inert
  // (not wired into any page) rather than removed, since the pattern
  // itself is harmless and a future decision to actually build the page
  // shouldn't require re-deriving it; building the page itself is out of
  // scope for a title/H1 migration and would violate sibling specs'
  // "no new pages" guardrails.
  'free-things-to-do': {
    titlePattern: 'Free Things to Do in {Town} | {Site}',
    h1Pattern: 'Free Events, Parks and Places in {Town}',
  },
};

/** Per-town overrides. Empty today: the one case this existed for
 *  (sports' H1 framing) turned out to be two separate pages/route keys
 *  (`sports`, `jackrabbits`) rather than one shared route needing a
 *  per-town override -- see those entries' own comments above. Kept as a
 *  real mechanism, not deleted, since a genuine same-route per-town
 *  variation is still a plausible future need (mirrors category-images.ts's
 *  own CATEGORY_IMAGES/Broomfield-aliasing shape). */
export const TOWN_OVERRIDES: Record<string, Partial<Record<string, Partial<PageMetaPattern>>>> = {};
