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
}

const CITIES: Record<string, SiteConfig> = {
  brookings_sd: {
    townId: 'brookings_sd',
    cityName: 'Brookings',
    stateName: 'South Dakota',
    stateAbbr: 'SD',
    hasClosureWatch: true,
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
