/**
 * Per-stad sajtidentitet. Väljs vid byggtid via miljövariabeln SITE_CITY
 * (t.ex. SITE_CITY=moreno_valley_ca). Faller tillbaka på Brookings så att
 * befintliga byggen inte ändrar beteende förrän variabeln sätts.
 *
 * Detta är navet som gör "central push" möjlig: en kodbas, komponenterna
 * läser härifrån istället för hårdkodad Brookings-text. Lägg till en ny stad
 * = lägg till en post här + sätt SITE_CITY i den stadens byggmiljö.
 *
 * OBS: håll värdena i synk med configs/<town_id>.json (samma town_id).
 */

export interface SiteConfig {
  townId: string;
  /** Visningsnamn, t.ex. "Moreno Valley" */
  cityName: string;
  /** Delstatens fulla namn, t.ex. "California" */
  stateName: string;
  /** Delstatens förkortning, t.ex. "CA" */
  stateAbbr: string;
  /** Varumärke i sidhuvudet. "View"-delen kursiveras. */
  brandLead: string;   // "Moreno Valley"
  brandTail: string;   // "View"
  /** og:site_name, RSS-titel, PWA-titel, JSON-LD name */
  siteName: string;    // "Moreno Valley View"
  domain: string;      // "morenovalleyview.com"
  siteUrl: string;     // "https://morenovalleyview.com"
  /** IANA-tidszon för datumraden */
  timezone: string;
  /** Meta description-standard */
  description: string;
  /** Rader i footerns "var informationen kommer ifrån" */
  sourceBlurb: string;
  removalEmail: string;
  /** Verified local movie theaters, for Reviews' "showing locally" anchor
   *  (see NEEDS-HUMAN-REVIEW.md "3.3 Reviews" and "Review Writing Standard")
   *  -- names/address/phone/one practical detail, never showtimes (no
   *  permitted showtimes feed found; theater chains' own showtimes aren't
   *  publicly scrapable/licensed the same way MaxPreps/HomeCampus weren't).
   *  address/phone/detail mirrored into configs/<town_id>.json's
   *  local_theaters for the Python content-generation pipeline (same
   *  deliberate cross-language duplication as venue_registry.py <-> db.ts).
   *  Optional: only populate for a town once its theaters are actually
   *  verified, never guessed. */
  localTheaters?: { name: string; url: string; address: string; phone: string; detail: string }[];
  /** The real, live traffic-incident source /traffic.astro attributes and
   *  links to -- see NEEDS-HUMAN-REVIEW.md "Traffic wrong-state source fix":
   *  the page used to hardcode "Source: Caltrans QuickMap" for every town,
   *  which was actively wrong for Brookings (Caltrans is California-only).
   *  Undefined = no working public incident feed has been found for this
   *  town yet (Brookings, as of this writing -- SD511.org has no public
   *  developer API, and South Dakota DOT's own ArcGIS server at
   *  sdgis.sd.gov is GIS asset/inventory data, not live incidents; both
   *  re-verified live). The page must render an honest "no source found
   *  yet" state in that case, never a silent/misattributed empty table --
   *  same "never render a silent gap" principle as home-sales.astro.
   *  scopeNote: what the source does/doesn't cover (e.g. state highways
   *  only, not city streets) -- shown on the page, not left implicit. */
  trafficSource?: { name: string; url: string; scopeNote: string };
  /** Parenthetical shown on /traffic when trafficSource is undefined --
   *  what was actually checked and ruled out, so the "no source yet" state
   *  reads as researched rather than lazy. Town-specific research, so it
   *  must be town-specific text -- traffic.astro used to hardcode
   *  Brookings' own research ("checked SD511.org...") in this parenthetical
   *  UNCONDITIONALLY, which was a real bug: rendered verbatim for ANY town
   *  with no trafficSource, falsely claiming SD511/South Dakota DOT were
   *  checked for towns (e.g. Broomfield, CO) where they never were. Found
   *  2026-08-26 building Broomfield's first real production build.
   *  Undefined = a generic, still-honest fallback (see traffic.astro). */
  noTrafficSourceNote?: string;
  /** Whether this town's config has data_sources.workplace_watch enabled --
   *  a separate flag from the town-equality checks elsewhere (home-sales,
   *  pro_sports, burro-bonanza are still genuinely Moreno-Valley-only), so
   *  Broomfield can carry Workplace Watch (see NEEDS-HUMAN-REVIEW.md
   *  "Broomfield launch") without also unlocking those unrelated features
   *  that happen to share the same `isMorenoValley` boolean in BaseLayout/
   *  index.astro/og/[slug].png.ts. */
  hasWorkplaceWatch?: boolean;
  /** Whether configs/<town_id>.json's features.closure_watch.enabled is true --
   *  gates the /closures page and its nav link. Same reasoning as
   *  hasWorkplaceWatch above: a dedicated flag rather than reusing the
   *  isBrookings/isMorenoValley/isBroomfield booleans, since Closure Watch is
   *  keyed on "does this town have a real school_alerts + weather_alerts
   *  source", not on town identity. Keep this in sync with that config file
   *  by hand -- tests/test_feature_flags.py asserts they match. */
  hasClosureWatch?: boolean;
  /** Mirrors configs/<town_id>.json's features.new_in_town.enabled. See
   *  hasClosureWatch above for the sync requirement. */
  hasNewInTown?: boolean;
  /** Mirrors configs/<town_id>.json's features.housing_market.enabled. See
   *  hasClosureWatch above for the sync requirement. */
  hasHousingMarket?: boolean;
  /** Whether this town has at least one ENABLED events source in
   *  configs/<town_id>.json's data_sources.events (see scrapers/
   *  event_sources.py's registry) -- gates CityStatus's `events_today`
   *  module (lib/cityStatus.ts). Broomfield's events source is still
   *  enabled:false (WebTrac blocked by an active Cloudflare challenge, see
   *  that config's own _notes) -- undefined/false here, not true, since
   *  "no source" and "quiet day" are different states and events_today is
   *  an always-rendered module (getCityStatus() fails the build if a town
   *  configures it without this flag, see CITY_STATUS_MODULES). Keep in
   *  sync with that config file by hand, same convention as
   *  hasClosureWatch above. */
  hasEventsSource?: boolean;
  /** CityStatus (front-page condensed strip, lib/cityStatus.ts) -- which
   *  modules render, in render order. An id with no matching resolver, or
   *  an always-rendered module configured for a town with no real source
   *  behind it, fails the build loudly rather than silently degrading (see
   *  getCityStatus()'s own validation) -- this array is the single source
   *  of truth for "does this town have X", never a hand-maintained prose
   *  matrix (one of those was wrong about Broomfield's traffic source
   *  twice; the fix is deriving availability from this file, not writing a
   *  third copy of the same claim). Missing/empty disables the component
   *  for that town entirely -- no empty container ships. */
  statusModules?: string[];
  /** Closure Watch's operational parameters -- mirrors configs/<town_id>.json's
   *  features.closure_watch (districts/weather_zones excluded here since
   *  school_alerts/events are already scoped by town_id at scrape/query
   *  time; only what closures.astro's render-time SQL and copy actually
   *  need are duplicated, same "duplicate across layers" tradeoff as
   *  localTheaters/home-sales.ts's OUTLIER_PRICE_FLOOR). Present only when
   *  hasClosureWatch is true -- keep in sync with that config file by hand,
   *  tests/test_feature_flags.py only checks the enabled/disabled flag
   *  itself, not these values. districtUrl is the district's own public
   *  notification channel, used for the page's hardcoded (non-AI)
   *  "no closure announced" line. */
  closureWatch?: {
    relevantAlertEvents: string[];
    /** Per-alert-event threshold (NWS event name -> required closure_history
     *  matches before Watch is allowed; 'default' covers any
     *  relevantAlertEvents entry without its own key). NOT a single number
     *  -- see configs/<town_id>.json's identical map shape and its own
     *  comment for why: a single town-wide threshold can't single out one
     *  over-triggering alert type (Air Quality Alert, measured 2026-08-28)
     *  without also suppressing a genuinely rarer one (Red Flag Warning)
     *  that should still reach Watch immediately. */
    minHistoricalClosuresForWatch: Record<string, number>;
    districtName: string;
    districtUrl: string;
  };
  /** Local Accent Identity: one restrained per-town accent color, two tokens
   *  (never one -- a hue that reads right decoratively almost never also
   *  clears text contrast on white). `accent` is decorative/non-text use
   *  only (boundaries, active-state indicators); `accentInk` is any real
   *  text or interactive control. Both are enforced at build time against
   *  WCAG minimums -- see lib/accent-contrast.ts's assertAccentContrast()
   *  -- never hand-picked without running that check. Optional: a town with
   *  no `brand` block falls back to the shared navy palette unchanged (see
   *  astro.config.mjs's BRAND_TOKENS, which mirrors this field exactly --
   *  same cross-layer duplication tradeoff as this file's other astro.config
   *  mirrors, needed because astro.config.mjs evaluates before this file's
   *  own import.meta.env-based SITE_CITY read is available). Broomfield-only
   *  for v1 (rollout order, not a technical limitation) -- Brookings and
   *  Moreno Valley are still working through the August indexing backlog
   *  and shouldn't absorb a site-wide render change until that clears. */
  brand?: { accent: string; accentInk: string };
  /** What's On Phase 3: Ticketmaster Discovery API adapter (lib/
   *  ticketmaster.ts). Object-shaped (not a bare boolean) the same way
   *  closureWatch is above. `enabled: false` everywhere until Phase 7
   *  (town-by-town rollout) -- the adapter itself is fully built and
   *  tested, but not called from buildEventFeed() or any page this phase
   *  (see lib/ticketmaster.ts's own module comment for why). Missing
   *  entirely for every town but Brookings -- Phase 3 is Brookings-only,
   *  on purpose.
   *
   *  latitude/longitude/radiusMiles (What's On Phase 3 follow-up, "Radius
   *  Fix"): the fetch is a real geographic search (Discovery API's
   *  latlong+radius+unit), not the original city/stateCode exact-tag match
   *  it shipped with -- that version structurally excluded everything
   *  outside a town's own city limits, including a real nearby market
   *  (Sioux Falls, ~53mi from Brookings) regardless of what's actually
   *  playing there. Coordinates mirror configs/brookings_sd.json's own
   *  `coordinates` field exactly (same cross-layer duplication tradeoff as
   *  this file's other configs/*.json mirrors -- that file is Python-
   *  pipeline-side JSON, not importable here). radiusMiles is deliberately
   *  generous (75mi, comfortably past the ~53mi to Sioux Falls) rather than
   *  tight -- the point of this fix is to stop excluding a real regional
   *  market, not to guess the smallest radius that still works. Moreno
   *  Valley and Broomfield deliberately have NO radius set yet (and no
   *  `ticketmaster` block at all) -- both sit inside dense metro areas
   *  (Inland Empire, Denver) where the right radius is a real editorial
   *  call, not a small-city default; Ticketmaster isn't enabled for either
   *  yet, so there's no urgency to guess. Flagged as a Phase 7 follow-up
   *  decision, not made here. */
  ticketmaster?: { enabled: boolean; latitude: number; longitude: number; radiusMiles: number };
}

const CITIES: Record<string, SiteConfig> = {
  brookings_sd: {
    townId: 'brookings_sd',
    cityName: 'Brookings',
    stateName: 'South Dakota',
    stateAbbr: 'SD',
    hasClosureWatch: true,
    hasEventsSource: true,
    // Coordinates mirror configs/brookings_sd.json's own `coordinates`
    // field exactly. radiusMiles=75 comfortably clears the ~53mi to Sioux
    // Falls -- see this field's own doc comment above for why.
    ticketmaster: { enabled: false, latitude: 44.3114, longitude: -96.7984, radiusMiles: 75 },
    statusModules: ['weather', 'alerts', 'closures', 'events_today', 'next_meeting', 'university'],
    closureWatch: {
      relevantAlertEvents: [
        'Winter Storm Warning', 'Blizzard Warning', 'Ice Storm Warning',
        'Extreme Cold Warning', 'Winter Weather Advisory',
      ],
      minHistoricalClosuresForWatch: { default: 0 },
      districtName: 'Brookings School District 05-1',
      districtUrl: 'https://www.brookings.k12.sd.us/',
    },
    brandLead: 'Brookings',
    brandTail: 'View',
    siteName: 'Brookings View',
    domain: 'brookingsview.com',
    siteUrl: 'https://brookingsview.com',
    timezone: 'America/Chicago',
    description:
      'Meetings, events, Jackrabbits games, weather and market prices in Brookings, South Dakota. Updated every hour.',
    sourceBlurb:
      'Brookings View gathers public information from the City of Brookings, Brookings County, South Dakota State University, and Brookings Public Library.',
    removalEmail: 'hello@brookingsview.com',
    noTrafficSourceNote:
      "checked SD511.org and South Dakota DOT's GIS server directly -- neither exposes an open incident API at this time",
    // Verified 2026-08-23 (Yelp, Brookings Area Chamber of Commerce
    // directory, IMDb -- cross-checked, not a single-source guess): the
    // only movie theater in Brookings. See NEEDS-HUMAN-REVIEW.md "Brookings
    // Parity Audit" -- added alongside Moreno Valley's localTheaters so
    // Brookings reviews get the same real "how to see it" anchor instead of
    // silently rendering nothing.
    localTheaters: [
      {
        name: 'Brookings Cinema 8',
        url: 'https://brookingstheatre.com/',
        address: '219 6th St, Brookings, SD 57006',
        phone: '(605) 692-4412',
        detail: '$5 tickets all day Tuesdays; expanded-legroom seating.',
      },
    ],
  },

  moreno_valley_ca: {
    townId: 'moreno_valley_ca',
    cityName: 'Moreno Valley',
    stateName: 'California',
    stateAbbr: 'CA',
    hasWorkplaceWatch: true,
    hasClosureWatch: true,
    hasEventsSource: true,
    statusModules: ['weather', 'alerts', 'traffic', 'closures', 'events_today', 'next_meeting', 'worker_pulse'],
    closureWatch: {
      relevantAlertEvents: ['Red Flag Warning', 'Fire Weather Watch', 'Air Quality Alert'],
      // Measured 2026-08-28 against real scrape history: Air Quality Alert
      // fired on 6 of the last 36 days (~17%) with zero confirmed closures
      // ever recorded here -- same over-triggering risk heat had, see
      // configs/moreno_valley_ca.json's identical note for the full
      // reasoning (including why a severity floor doesn't work: every real
      // row has severity='Unknown').
      minHistoricalClosuresForWatch: { default: 0, 'Air Quality Alert': 1 },
      districtName: 'Moreno Valley Unified School District',
      districtUrl: 'https://www.mvusd.net/engage/news',
    },
    hasHousingMarket: true,
    brandLead: 'Moreno Valley',
    brandTail: 'View',
    siteName: 'Moreno Valley View',
    domain: 'morenovalleyview.com',
    siteUrl: 'https://morenovalleyview.com',
    timezone: 'America/Los_Angeles',
    description:
      'City council decisions, events, weather and local happenings in Moreno Valley, California. Updated every hour.',
    sourceBlurb:
      'Moreno Valley View gathers public information from the City of Moreno Valley, Riverside County, and the Moreno Valley Public Library.',
    removalEmail: 'hello@morenovalleyview.com',
    trafficSource: {
      name: 'Caltrans QuickMap',
      url: 'https://quickmap.dot.ca.gov',
      scopeNote: 'State highways, freeways, and CHP-logged incidents -- not city or county streets.',
    },
    // Verified 2026-08-23 (search + each theater's own site): the two
    // first-run theaters actually in Moreno Valley. Not an exhaustive
    // regional list (Riverside/Redlands/Perris have more) -- deliberately
    // scoped to what's genuinely local.
    localTheaters: [
      {
        name: 'Harkins Moreno Valley 16',
        url: 'https://harkins.com/theatres/moreno-valley',
        address: '22350 Town Cir, Moreno Valley, CA 92553',
        phone: '(951) 653-6161',
        detail: 'Power-reclining stadium seating; free parking in the adjacent Moreno Valley Mall lot.',
      },
      {
        name: 'Regency Theatres — Towngate 8',
        url: 'https://www.regencymovies.com/movie-theatres/california/moreno-valley/towngate-8',
        address: '12625 Frederick St Suite L, Moreno Valley, CA 92553',
        phone: '(951) 653-5500',
        detail: 'A discount second-run house — tickets run well below first-run prices; free lot parking.',
      },
    ],
  },

  broomfield_co: {
    townId: 'broomfield_co',
    cityName: 'Broomfield',
    stateName: 'Colorado',
    stateAbbr: 'CO',
    hasWorkplaceWatch: true,
    statusModules: ['weather', 'alerts', 'traffic', 'next_meeting'],
    // Local Accent Identity, Broomfield-first rollout. A muted Front Range
    // slate-teal (H185) -- deliberately not green (avoids reading as an
    // interpretation of Vail Resorts' own branding, which this town's
    // /vail-resorts page already covers) and far enough in hue from both
    // the existing shared --navy (H212) and the shared CTA --accent orange
    // (H17) to never be confused with either. Both values verified via
    // lib/accent-contrast.ts against real WCAG minimums, not eyeballed --
    // accent 5.05:1 / accentInk 10.64:1 against the page background.
    brand: { accent: '#2d7980', accentInk: '#124549' },
    brandLead: 'Broomfield',
    brandTail: 'View',
    siteName: 'Broomfield View',
    domain: 'broomfieldview.com',
    siteUrl: 'https://broomfieldview.com',
    timezone: 'America/Denver',
    description:
      'City Council decisions, events, weather and local happenings in Broomfield, Colorado. Updated every hour.',
    sourceBlurb:
      'Broomfield View gathers public information from the City and County of Broomfield, Adams 12 Five Star Schools, and Boulder Valley School District.',
    removalEmail: 'hello@broomfieldview.com',
    trafficSource: {
      name: 'CDOT / COtrip',
      url: 'https://www.cotrip.org',
      scopeNote: 'State highways and CDOT-logged incidents -- not city or county streets.',
    },
    // No verified movie theater yet either -- undefined (never guessed)
    // until one is cross-checked the way Brookings/Moreno Valley's were.
  },
};

// Astro exposer env via import.meta.env vid byggtid. SITE_CITY sätts i varje
// stads byggmiljö (GitHub Action / Cloudflare Pages). Utelämnad -> Brookings.
const active = (import.meta.env.SITE_CITY as string | undefined) ?? 'brookings_sd';

export const siteConfig: SiteConfig = CITIES[active] ?? CITIES.brookings_sd;

export function getSiteConfig(): SiteConfig {
  return siteConfig;
}

/** All three towns' public identity, for the multi-site disclosure on
 *  /about (AdSense doorway-abuse remediation, Phase H2: state the shared
 *  operator plainly rather than have each site look independently run --
 *  Google's policy flags CONCEALING shared operation, not the network
 *  existing). CITIES itself isn't exported -- it carries every town's full
 *  config (theaters, closure-watch params, etc.), more than a disclosure
 *  line needs -- this is a purpose-built, minimal projection of it. */
export const ALL_SITES: { townId: string; cityName: string; siteName: string; siteUrl: string }[] =
  Object.values(CITIES).map((c) => ({
    townId: c.townId, cityName: c.cityName, siteName: c.siteName, siteUrl: c.siteUrl,
  }));
