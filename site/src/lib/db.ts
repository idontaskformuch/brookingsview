/**
 * Enda filen som pratar med databasen.
 *
 * Allt annat i site/ tar emot färdig data och behöver aldrig veta varifrån den
 * kom -- samma princip som scraper-lagret, där ingen parser vet vilken ort den
 * kör för. Vill vi byta datalager senare är det den här filen som ändras.
 *
 * Två sorters innehåll, medvetet åtskilda:
 *
 *   REDAKTIONELLT (stories)  möten, evenemang, varningar. AI-formaterade,
 *                            guardrail-validerade, en sida var.
 *   STRUKTURERAT (källtabeller)  matcher, väder, råvarupriser. Läses direkt och
 *                            renderas som tabeller och rutor -- ALDRIG som egna
 *                            sidor. 109 nästan identiska matchsidor vore precis
 *                            den "scaled content"-signal som fällde vertoq.net.
 *
 * Alla frågor filtreras på town_id från configen, så samma kod betjänar nästa
 * ort utan ändring.
 */
import { neon } from '@neondatabase/serverless';
import { siteConfig } from './site-config';
import { computeClosureWatchState, type ClosureWatchStatus, type WeatherAlert } from './closure-watch';
import { SHARED_CONTENT_SOURCE_TYPES } from './cross-site-canonical';
import { resolveCluster } from './clusters';
import { storyHref } from './content-slugs';
import { calendarDayDiff } from './time';
import { selectThisWeekImage, type Season } from './this-week-images';
import type { ThisWeekImage } from '../config/this-week-images';
import { resolveActiveHoliday, selectHolidayImage, type DateYMD } from './holidays';
import { HOLIDAYS, holidayImagesFor, type HolidayImage } from '../config/holidays';

const sql = neon(import.meta.env.DATABASE_URL);

// Härleds från siteConfig (SITE_CITY), inte en egen env-variabel -- en separat
// TOWN_ID att komma ihåg att sätta i synk med SITE_CITY är precis den sortens
// fallgrop som gör att en stads build visar en annan stads branding över en
// tredje stads data. Ett enda reglage (SITE_CITY) styr både identitet och data.
export const TOWN_ID = siteConfig.townId;

export type SourceType =
  | 'meeting' | 'meeting_followup' | 'event' | 'alert' | 'weekly'
  | 'culture_essay' | 'editorial' | 'vetenskap_kronika' | 'kvick_essa'
  | 'media_recension' | 'vardagsmiddag' | 'home_sales_digest' | 'sports_digest' | 'local_sports_digest' | 'university_digest'
  | 'announcement' | 'workplace_watch_digest' | 'jackrabbits_season_summary' | 'new_in_town_digest';

/** Presentation-layer label per source_type, för Byline-raden. Ingen egen DB-kolumn --
 *  category är en ren funktion av source_type, inget som behöver lagras separat. */
export const CATEGORY_LABELS: Partial<Record<SourceType, string>> = {
  culture_essay: 'Culture essay',
  editorial: 'Editorial',
  vetenskap_kronika: 'Science',
  kvick_essa: 'Commentary',
  media_recension: 'Review',
  vardagsmiddag: 'Recipe',
  home_sales_digest: 'Market digest',
  sports_digest: 'Sports digest',
  local_sports_digest: 'Local sports notes',
  university_digest: 'University digest',
  // Handskrivet, inte skrapat eller AI-genererat -- t.ex. sajtnyheter som
  // "vi lanserade ett arkadspel". byline sätts (se StoryCard.astro:s
  // hasByline-villkor) så den här kickern faktiskt används i stället för
  // att falla tillbaka på "Events".
  announcement: 'Announcement',
  workplace_watch_digest: 'Worker Pulse',
  new_in_town_digest: 'New in Town',
  // Fas 2.3 (breadcrumbs, see NEEDS-HUMAN-REVIEW.md): the remaining
  // source_types that get their own /s/[slug]/ page but weren't in this
  // map before -- StoryCard.astro already computes its own "Events"/"City
  // hall"/"Alert" kicker for these locally instead of reading this map, so
  // adding them here is new (for breadcrumbs specifically), not a change
  // to any existing rendering.
  event: 'Events',
  meeting: 'City hall',
  meeting_followup: 'City hall',
  weekly: 'This week',
};

/** De sex innehållstyperna från Content Track v1 -- en sammanhållen lista så att
 *  nya sidor/frågor inte behöver skriva om den varje gång. home_sales_digest/
 *  sports_digest är INTE med här -- egen cadence (månadsvis respektive
 *  veckovis) via ai_pipeline/home_sales_digest.py och
 *  ai_pipeline/sports_weekly_digest.py, inte del av den dagliga rotationen
 *  (weekly_rotation.py), samma undantag som 'weekly'. */
export const CONTENT_TRACK_TYPES: SourceType[] = [
  'culture_essay', 'editorial', 'vetenskap_kronika', 'kvick_essa', 'media_recension', 'vardagsmiddag',
];

/** Extra 1: every real row of these six types is AI-generated today (every
 *  one of them carries a `generated_by` of the form "ai:<model>", confirmed
 *  live against the DB) -- CONTENT_TRACK_TYPES itself IS the AI-written
 *  content track, not an incidental correlation with it, so gating the
 *  reader-facing "AI-written" label on source_type (reused here, not a new
 *  parallel list) is both simpler and exactly what the brief asked for:
 *  "every card for reviews, recipes, editorials and columns" -- every card
 *  of these categories, not a per-row generated_by sniff that would quietly
 *  stop labeling a row if some future editorial workflow ever hand-wrote
 *  one under the same source_type. */
export function isAiWrittenContent(sourceType: SourceType): boolean {
  return CONTENT_TRACK_TYPES.includes(sourceType);
}

/** Vilken kategori-sida en Content Track-story hör hemma på när den arkiveras
 *  bort från förstasidan. culture_essay/vetenskap_kronika/kvick_essa delar
 *  /columns -- tre krönike-varianter i en sektion, inte tre tunna sidor.
 *  home_sales_digest/sports_digest pekar till sina respektive tabellsidor
 *  trots att de inte är i CONTENT_TRACK_TYPES ovan -- href-uppslaget är
 *  oberoende av rotationslistan. */
export const CATEGORY_HREFS: Partial<Record<SourceType, string>> = {
  culture_essay: '/columns/',
  kvick_essa: '/columns/',
  vetenskap_kronika: '/columns/',
  editorial: '/editorials/',
  media_recension: '/reviews/',
  vardagsmiddag: '/recipes/',
  home_sales_digest: '/home-sales/',
  sports_digest: '/sports/',
  university_digest: '/university/',
  workplace_watch_digest: '/workplace-watch/',
  // Fas 2.3 (breadcrumbs) -- see CATEGORY_LABELS' own comment just above
  // for why these are new here specifically for that purpose. 'alert' is
  // deliberately NOT included: there's no dedicated alerts section page,
  // and guessing one (e.g. /events/) would misrepresent an alert's actual
  // parent section -- its breadcrumb just skips straight to the page
  // title instead of asserting a wrong middle crumb.
  event: '/events/',
  meeting: '/city-hall/',
  meeting_followup: '/city-hall/',
  weekly: '/this-week/',
};

export interface Story {
  id: number;
  title: string;
  slug: string;
  body: string;
  source_type: SourceType;
  source_url: string | null;
  occurs_at: string | null;
  published_at: string;
  generated_by: string;
  byline: string | null;
  image_path: string | null;
  // Real, content-specific alt text (see db/migrations/025_image_alt.sql) --
  // NULL for every story published before this column existed (forward-only,
  // no retroactive backfill, see NEEDS-HUMAN-REVIEW.md "Image pipeline
  // overhaul") and for all scraped content (meetings/events/alerts never
  // get an illustration at all). Callers fall back to a generic template
  // when this is null, never render a blank alt attribute.
  image_alt: string | null;
  rating: number | null;
  // Endast vardagsmiddag (recept) sätter detta -- strukturerad ingredienslista,
  // en rad per ingrediens. NULL för allt annat innehåll, se db/migrations/005.
  ingredients: string[] | null;
  // Endast vardagsmiddag, samma mönster som ingredients men för steg-för-steg-
  // instruktionerna. NULL för allt annat innehåll, se db/migrations/008.
  instructions: string[] | null;
  // Endast source_type='event' -- den skrapade, rå LOCATION-strängen (se
  // scrapers/parsers/events.py), aldrig sluggad/normaliserad. Resolvas mot
  // `facilities` HÄR vid render/build, aldrig cachad som ett facility-id på
  // raden -- se resolveVenue() nedan och ai_pipeline/venue_registry.py:s
  // moduldocstring för varför. Optional (inte bara `| null`) eftersom
  // frågor som inte behöver den (t.ex. getActiveAlerts) inte selectar den.
  venue_raw?: string | null;
  // Sant för en "series"-story byggd av ai_pipeline.publish.group_recurring_
  // events -- en enda URL som representerar MÅNGA instanser, så den kan
  // aldrig peka på EN verklig plats/tid utan att bryta Googles en-URL-per-
  // event-regel. Se [slug].astro för hur det här styr JSON-LD-emission.
  is_recurring_series?: boolean;
  // Endast source_type='event', enkla (icke-serie) rader -- se
  // ai_pipeline/publish.py. Optional för samma skäl som venue_raw ovan.
  ends_at?: string | null;
  // Handkurerad flagga -- förstasidans "Worth knowing"-block (se
  // NEEDS-HUMAN-REVIEW.md "Homepage Curation" och db/migrations/022) tar in
  // en rad även om den inte matchar någon regelbaserad kategori. false på
  // alla befintliga rader; ingen UI att sätta den från än, bara SQL för
  // hand. Optional av samma skäl som venue_raw/is_recurring_series ovan --
  // bara frågor som faktiskt behöver den selectar den.
  featured?: boolean;
  // Endast source_type='event' rader som ai_pipeline/free_teasers.py har
  // klassat som gratis (samma venue-kategori + pris-språk-regel som
  // isFreeEvent() nedan) -- en förgenererad, en gång per event, cachad
  // rad (db/migrations/036_free_teasers.sql). NULL för allt annat
  // innehåll OCH för ett gratis-event som ännu inte hunnit genereras.
  // Optional av samma skäl som venue_raw ovan.
  free_teaser?: string | null;
  // Image pool rotation (Addendum 2, db/migrations/043) -- the durable
  // category-pool slot ai_pipeline/assign_category_image_rotation.py
  // assigned this story, an ever-incrementing counter NOT modded against
  // any pool size (see that migration's own comment). NULL until that
  // script's next run catches it up, and for any story that never needs
  // tier 4 at all -- resolveImage() falls back to its existing stable
  // hash-pick when this is null, so a story is never left imageless while
  // waiting. Optional for the same reason venue_raw is.
  category_image_index?: number | null;
}

export interface Game {
  id: number;
  sport: string;
  opponent: string;
  home_away: string | null;
  starts_at: string | null;
  venue: string | null;
  result: string | null;
}

export interface WeatherPeriod {
  name: string;
  start: string;
  temp: number | null;
  unit: string;
  short: string;
  wind: string;
  is_daytime: boolean;
}

/** FAS 2: en rad ur weather_snapshots.payload.hourly -- se scrapers/parsers/
 *  noaa.py. Skiljer sig från WeatherPeriod genom att INTE ha `name` (NWS
 *  timprognos ger alltid en tom sträng där -- frontend etiketterar varje
 *  timme själv från `start`, se weather.astro). */
export interface HourlyWeatherPeriod {
  start: string;
  temp: number | null;
  unit: string;
  short: string;
  wind: string;
  is_daytime: boolean;
}

export interface AgPrice {
  commodity: string;
  price: number | null;
  unit: string | null;
  as_of: string | null;
}

/** One commodity's price with direction/trend context -- see
 *  NEEDS-HUMAN-REVIEW.md "Brookings — Farm Report Depth". Everything here
 *  is computed from real stored monthly rows (ag_prices, one row per
 *  commodity+month -- see scrapers/parsers/usda.py), never estimated or
 *  interpolated: a missing month is a missing month, not smoothed over. */
export interface AgPriceSeries {
  commodity: string;
  unit: string | null;
  latest: { price: number; as_of: string } | null;
  /** The point immediately before `latest` in the stored history --
   *  labeled with ITS OWN real as_of date, never assumed to be "last
   *  calendar month" (NASS sometimes skips a month, and this must stay
   *  honest about a gap rather than mislabel a 2-month-old point as
   *  "last month"). */
  previous: { price: number; as_of: string } | null;
  /** The stored point exactly 12 calendar months before `latest`, if one
   *  exists -- omitted (not guessed) when the history doesn't reach back
   *  that far or that specific month is missing. */
  yearAgo: { price: number; as_of: string } | null;
  /** Chronological (oldest first), up to 13 months -- see _HISTORY_MONTHS
   *  in usda.py. */
  history: { price: number; as_of: string }[];
  rangeMin: number | null;
  rangeMax: number | null;
}

export interface PropertySale {
  address: string | null;
  sale_price: number | null;
  sale_date: string | null;
  // Riverside County's parcel identifier -- the stable per-property
  // identity a permalink page keys on (see db/migrations/019 and
  // NEEDS-HUMAN-REVIEW.md, "Week 4 -- Home Sales Address Pages": verified
  // zero collisions across all 2,610 real rows, and (pin, doc_number)
  // together are the real unique-sale identity, so the SAME pin
  // legitimately repeats across multiple rows -- a genuine sale history,
  // not a duplicate). Optional for the same reason venue_raw is on
  // Story -- only queries that need it select it.
  pin?: string | null;
  doc_number?: string | null;
}

/** En rad ur regional_sports_games -- se db/migrations/009_regional_sports.sql.
 *  Namnet skiljer sig medvetet från Game/sports_games ovan: det är ett annat
 *  bord med annan form (flera lag, status/resultat som ÄNDRAS över tid) för
 *  städer utan ett eget lokalt lag att bevaka, t.ex. Moreno Valleys
 *  Inland Empire 66ers/Angels/Dodgers via /sports. Blandas aldrig ihop med
 *  Jackrabbits/sports_games/jackrabbits.astro. */
export interface RegionalGame {
  league: string;
  team_name: string;
  team_abbr: string | null;
  opponent_name: string;
  home_away: string | null;
  game_date: string | null;
  game_time_utc: string | null;
  status: string;
  team_score: number | null;
  opponent_score: number | null;
  venue: string | null;
  relevance_tier: string;
}

/* ------------------------------------------------------------------ stories */

/** Kommande och pågående -- det startsidan och sektionssidorna visar. */
export async function getUpcomingStories(
  sourceTypes: SourceType[],
  limit = 20,
): Promise<Story[]> {
  return (await sql`
    SELECT id, title, slug, body, source_type, source_url, occurs_at, published_at, generated_by,
           byline, image_path, image_alt, rating, ingredients, instructions,
           venue_raw, is_recurring_series, ends_at, category_image_index, free_teaser
      FROM stories
     WHERE town_id = ${TOWN_ID}
       AND source_type = ANY(${sourceTypes})
       AND occurs_at >= now() - interval '12 hours'
     ORDER BY occurs_at ASC
     LIMIT ${limit}
  `) as Story[];
}

/** Candidates for the homepage "Worth knowing" block (see
 *  NEEDS-HUMAN-REVIEW.md "Homepage Curation"): civic decisions with
 *  public-testimony opportunities, secondary alerts, and hand-flagged
 *  items. "city_hall"/"planning" in the brief map to the real source_type
 *  values that actually exist here (meeting/meeting_followup) -- there is
 *  no separate "planning" or "city_hall" source_type in this schema, a
 *  Planning Commission item is just a 'meeting' row like any other civic
 *  body's. The -24h floor matches the brief's "passed by more than 24
 *  hours" rule; featured rows bypass it (an evergreen flag, not tied to a
 *  specific occurs_at). Final selection (cap 3, alert-banner dedup, theme-
 *  collision check) happens in lib/homepage-curation.ts, not here -- this
 *  just gathers real, town-scoped candidates.
 */
export async function getWorthKnowingCandidates(limit = 12): Promise<Story[]> {
  return (await sql`
    SELECT id, title, slug, body, source_type, source_url, occurs_at, published_at,
           generated_by, byline, image_path, image_alt, rating, ingredients, instructions, featured
      FROM stories
     WHERE town_id = ${TOWN_ID}
       AND (
             source_type IN ('meeting', 'meeting_followup', 'alert')
             OR featured = true
           )
       AND (featured = true OR occurs_at IS NULL OR occurs_at >= now() - interval '24 hours')
     ORDER BY featured DESC, occurs_at ASC NULLS LAST
     LIMIT ${limit}
  `) as Story[];
}

/** Candidates for the homepage "Latest from <site>" strip -- the site's
 *  editorial verticals (Editorials/Columns/Reviews/Recipes), never events/
 *  alerts/meetings/the weekly roundup (each of those already has its own
 *  homepage slot). Priority tiebreak on same-published_at ties is applied
 *  in lib/homepage-curation.ts, not the SQL ORDER BY -- see
 *  selectLatestFrom()'s own comment for why a fixed genre order needs real
 *  code, not something ORDER BY can express directly. Fetches more than
 *  the final 3 so that tiebreak has real candidates to work with. */
const EDITORIAL_SOURCE_TYPES: SourceType[] =
  ['editorial', 'culture_essay', 'kvick_essa', 'vetenskap_kronika', 'media_recension', 'vardagsmiddag'];

export async function getLatestFromCandidates(limit = 8): Promise<Story[]> {
  return (await sql`
    SELECT id, title, slug, body, source_type, source_url, occurs_at, published_at,
           generated_by, byline, image_path, image_alt, rating, ingredients, instructions
      FROM stories
     WHERE town_id = ${TOWN_ID}
       AND source_type = ANY(${EDITORIAL_SOURCE_TYPES})
       -- Postgres sorts NULL first in DESC order, so an unpublished row
       -- (published_at set back to NULL, e.g. scripts/scan_contamination.py's
       -- quarantine flow) would otherwise outrank every real published story
       -- for this exact homepage slot -- confirmed live 2026-09-03, see
       -- NEEDS-HUMAN-REVIEW.md's "unpublished" rows. Explicit filter, not
       -- reliance on ORDER BY placement.
       AND published_at IS NOT NULL
     ORDER BY published_at DESC
     LIMIT ${limit}
  `) as Story[];
}

/** Front-page demotion handoff ("demote shared content from the feature
 *  slot"): candidates for the homepage's "More to read" compact row --
 *  ONLY the shared/town-agnostic content-track types (recipe, media
 *  review, science column -- see cross-site-canonical.ts's
 *  isSharedContentType()/SHARED_CONTENT_SOURCE_TYPES, the one existing
 *  shared/unique flag this reuses rather than duplicating). A dedicated
 *  query, not a client-side filter over getLatestFromCandidates(): that
 *  function mixes all 6 content-track types in one published_at-DESC list
 *  capped at a small `limit`, so a recent run of local (feature-eligible)
 *  content could push a shared item below this row's own cap before any
 *  filtering happened. category_image_index/venue_raw included because
 *  media_recension resolves its image through the movie_review category
 *  pool (see images.ts's resolveImage() tier 4), not image_path. */
export async function getRecentCompactContent(limit = 3): Promise<Story[]> {
  return (await sql`
    SELECT id, title, slug, body, source_type, source_url, occurs_at, published_at,
           generated_by, byline, image_path, image_alt, rating, ingredients, instructions,
           venue_raw, is_recurring_series, ends_at, category_image_index
      FROM stories
     WHERE town_id = ${TOWN_ID}
       AND source_type = ANY(${SHARED_CONTENT_SOURCE_TYPES})
       AND published_at IS NOT NULL
     ORDER BY published_at DESC
     LIMIT ${limit}
  `) as Story[];
}

/** Passerat innehåll, nyast först. Arkiv -- inte det sajten leder med. */
export async function getPastStories(
  sourceTypes: SourceType[],
  limit = 20,
): Promise<Story[]> {
  return (await sql`
    SELECT id, title, slug, body, source_type, source_url, occurs_at, published_at, generated_by,
           byline, image_path, image_alt, rating, ingredients, instructions,
           venue_raw, is_recurring_series, ends_at, category_image_index
      FROM stories
     WHERE town_id = ${TOWN_ID}
       AND source_type = ANY(${sourceTypes})
       AND occurs_at < now() - interval '12 hours'
     ORDER BY occurs_at DESC
     LIMIT ${limit}
  `) as Story[];
}

/**
 * Dagens krönika/recension/recept -- den från Content Track v1 som publicerats
 * sedan midnatt lokal tid (ortens EGEN tidszon, siteConfig.timezone -- INTE
 * hårdkodat till en ort. Se formatDate/formatTime nedan för samma fix och
 * varför: fram till denna ändring visade Moreno Valley-bygget allt i
 * America/Chicago, ~2 timmar fel).
 *
 * Visas pushigt på förstasidan bara publiceringsdagen. Efter det hittas den
 * bara via sin kategori-sida (getContentByType) -- precis som andra
 * nyhetssajter kör "dagens ledare/recension" på ettan och arkiverar den till
 * en sektion när nästa dags innehåll tar över.
 */
export async function getTodaysFeature(): Promise<Story | null> {
  const rows = (await sql`
    SELECT id, title, slug, body, source_type, source_url, occurs_at, published_at, generated_by,
           byline, image_path, image_alt, rating, ingredients, instructions,
           venue_raw, is_recurring_series, ends_at, category_image_index
      FROM stories
     WHERE town_id = ${TOWN_ID}
       AND source_type = ANY(${CONTENT_TRACK_TYPES})
       AND published_at::date = (now() AT TIME ZONE ${siteConfig.timezone})::date
     ORDER BY published_at DESC
     LIMIT 1
  `) as Story[];
  return rows[0] ?? null;
}

/** Fullt arkiv för en kategori-sida (recept, recensioner, ledare, krönikor),
 *  nyast först. Till skillnad från getTodaysFeature filtreras inte på dagens
 *  datum -- kategori-sidan är den permanenta hemvisten för allt innehåll av
 *  den typen, inte bara det som nyss publicerades. */
export async function getContentByType(sourceTypes: SourceType[], limit = 40): Promise<Story[]> {
  return (await sql`
    SELECT id, title, slug, body, source_type, source_url, occurs_at, published_at, generated_by,
           byline, image_path, image_alt, rating, ingredients, instructions,
           venue_raw, is_recurring_series, ends_at, category_image_index
      FROM stories
     WHERE town_id = ${TOWN_ID}
       AND source_type = ANY(${sourceTypes})
       -- see getLatestFromCandidates' comment: NULL sorts first in DESC,
       -- so an unpublished row must be filtered explicitly, not just outranked.
       AND published_at IS NOT NULL
     ORDER BY published_at DESC
     LIMIT ${limit}
  `) as Story[];
}

/** Stories eligible for the Google News sitemap (see NEEDS-HUMAN-REVIEW.md,
 *  "Google News sitemap") -- published within the last 48 hours, every real
 *  reported/edited content type EXCEPT 'vardagsmiddag' (recipes: evergreen
 *  content, not news -- the one source_type this codebase's own existing
 *  JSON-LD type selection already treats as generic 'Article' rather than
 *  any NewsArticle-flavored type, see article-jsonld.ts's own
 *  ARTICLE_TYPE_BY_SOURCE_TYPE). Filtered again in lib/news-sitemap.ts's
 *  pure buildNewsSitemapXml() too (defense in depth / unit-testable without
 *  a DB), but filtering here first keeps this cheap to run on every hourly
 *  build -- no reason to fetch the whole stories table just to throw away
 *  everything older than 2 days. */
export async function getStoriesForNewsSitemap(): Promise<Story[]> {
  return (await sql`
    SELECT id, title, slug, body, source_type, source_url, occurs_at, published_at, generated_by,
           byline, image_path, image_alt, rating, ingredients, instructions,
           venue_raw, is_recurring_series, ends_at, category_image_index
      FROM stories
     WHERE town_id = ${TOWN_ID}
       AND source_type != 'vardagsmiddag'
       AND published_at >= now() - interval '48 hours'
     ORDER BY published_at DESC
  `) as Story[];
}

export async function getStoryBySlug(slug: string): Promise<Story | null> {
  const rows = (await sql`
    SELECT id, title, slug, body, source_type, source_url, occurs_at, published_at, generated_by,
           byline, image_path, image_alt, rating, ingredients, instructions,
           venue_raw, is_recurring_series, ends_at, category_image_index
      FROM stories
     WHERE town_id = ${TOWN_ID} AND slug = ${slug}
     LIMIT 1
  `) as Story[];
  return rows[0] ?? null;
}

/** Alla slugs -- används av getStaticPaths för att generera storysidorna. */
export async function getAllStories(): Promise<Story[]> {
  return (await sql`
    SELECT id, title, slug, body, source_type, source_url, occurs_at, published_at, generated_by,
           byline, image_path, image_alt, rating, ingredients, instructions,
           venue_raw, is_recurring_series, ends_at, category_image_index
      FROM stories
     WHERE town_id = ${TOWN_ID}
     ORDER BY occurs_at DESC NULLS LAST
  `) as Story[];
}

/**
 * Varningar som fortfarande gäller.
 *
 * publish.py vägrar redan publicera inaktuella varningar, men den kör bara varje
 * timme -- en varning kan löpa ut mellan två körningar. Dubbelkollen här gör att
 * sajten aldrig visar en utgången varning, oavsett när bygget skedde.
 */
export async function getActiveAlerts(): Promise<Story[]> {
  return (await sql`
    SELECT s.id, s.title, s.slug, s.body, s.source_type, s.source_url,
           s.occurs_at, s.published_at, s.generated_by,
           s.byline, s.image_path, s.rating, s.ingredients, s.instructions
      FROM stories s
      LEFT JOIN events e ON e.town_id = s.town_id AND s.slug = 'alert-' || e.id
     WHERE s.town_id = ${TOWN_ID}
       AND s.source_type = 'alert'
       AND (e.ends_at IS NULL OR e.ends_at >= now())
       AND s.occurs_at >= now() - interval '14 days'
     ORDER BY s.occurs_at DESC
  `) as Story[];
}

/**
 * Veckosammanfattningen för innevarande vecka.
 *
 * Den enda story som väver ihop möten, evenemang, matcher och priser till en
 * sammanhängande text -- och därmed sajtens starkaste innehåll. Hämtas separat
 * i stället för att blandas in i strömmen, eftersom den ska ha en egen plats
 * högst upp och aldrig konkurrera med enskilda notiser.
 */
export async function getLatestWeekly(): Promise<Story | null> {
  const rows = (await sql`
    SELECT id, title, slug, body, source_type, source_url, occurs_at, published_at, generated_by,
           byline, image_path, image_alt, rating, ingredients, instructions,
           venue_raw, is_recurring_series, ends_at, category_image_index
      FROM stories
     WHERE town_id = ${TOWN_ID}
       AND source_type = 'weekly'
       AND occurs_at >= now() - interval '8 days'
     ORDER BY occurs_at DESC
     LIMIT 1
  `) as Story[];
  return rows[0] ?? null;
}

/** Every 'weekly' story ever generated (occurs_at = that week's Monday, see
 *  ai_pipeline/weekly.py's main()) -- the authoritative list of which weeks
 *  get a /this-week/<iso-week>/ archive page. Deliberately NOT an
 *  independent enumeration of ISO weeks: a week only gets a page because
 *  weekly.py itself already decided it was real and generated content for
 *  it, never because this file speculatively guessed one into existence. */
export async function getAllWeeklyStories(): Promise<Story[]> {
  return (await sql`
    SELECT id, title, slug, body, source_type, source_url, occurs_at, published_at, generated_by,
           byline, image_path, image_alt, rating, ingredients, instructions
      FROM stories
     WHERE town_id = ${TOWN_ID} AND source_type = 'weekly'
     ORDER BY occurs_at ASC
  `) as Story[];
}

/** This week's rotating image for the "This week" segment (db/migrations/
 *  050_this_week_image_usage.sql) -- see lib/this-week-images.ts's
 *  selectThisWeekImage() for the actual pick algorithm, kept pure/DB-free
 *  there specifically so it's unit-testable without a database. This
 *  function is the thin, DB-touching shell around it: read any already-
 *  saved pick for this exact (town, iso week) first -- a rebuild within the
 *  same week reuses it rather than re-rolling, which is also what makes the
 *  pick STABLE rather than merely "probably the same" -- and only select +
 *  persist a new one when none exists yet.
 *
 *  Throws (fails the build) when no eligible candidate exists, same
 *  "never silently degrade" principle as assertCategoryImagesComplete()/
 *  resolveVenue()'s hasResolvedAddress() gate elsewhere in this codebase --
 *  reusing a recently-shown or wrong-season image would defeat the entire
 *  point of this feature more quietly than just failing the build does. */
export async function resolveThisWeekImage(
  isoYearWeek: string,
  season: Season,
  pool: ThisWeekImage[],
  weekMonday: DateYMD,
  weekSunday: DateYMD,
): Promise<ThisWeekImage | HolidayImage> {
  // Holiday overlay (2026-10-06): if this week's own date range overlaps an
  // ACTIVE holiday's window (lib/holidays.ts's resolveActiveHoliday()), the
  // holiday pool is tried FIRST, same 60-day/history rule and this exact
  // table -- image_id is a plain string column, not scoped to season vs
  // holiday, so a holiday pick's own id (e.g. "brookings_sd-halloween-01")
  // lives in the SAME row shape as a season pick's. Falls back to the
  // season pool (warn, never throw) when a holiday is active but this
  // town's pool for it is empty -- same "never silently degrade, but never
  // hard-fail over a thin holiday pool either" reasoning a thin season
  // pool already gets via the build-time warning instead of a throw.
  const holidayMatch = resolveActiveHoliday(HOLIDAYS, weekMonday, weekSunday);
  const holidayPool = holidayMatch ? holidayImagesFor(TOWN_ID, holidayMatch.holiday) : [];

  const existing = (await sql`
    SELECT image_id FROM this_week_image_usage
     WHERE town_id = ${TOWN_ID} AND iso_year_week = ${isoYearWeek}
  `) as { image_id: string }[];
  if (existing.length > 0) {
    const found = pool.find((img) => img.id === existing[0].image_id)
      ?? holidayPool.find((img) => img.id === existing[0].image_id);
    if (!found) {
      throw new Error(
        `resolveThisWeekImage: town "${TOWN_ID}" week "${isoYearWeek}" already recorded image_id ` +
        `"${existing[0].image_id}", but no pool entry with that id exists anymore (checked both the season ` +
        'pool and, if a holiday is active this week, the holiday pool) -- it was likely removed during ' +
        'curation. Fix config/this-week-images.ts or config/holidays.ts (re-add it, or re-point this ' +
        'historical row at a replacement) rather than silently re-selecting a different image for an ' +
        'already-published week.',
      );
    }
    return found;
  }

  const history = (await sql`
    SELECT image_id, shown_at FROM this_week_image_usage WHERE town_id = ${TOWN_ID}
  `) as { image_id: string; shown_at: string }[];
  const historyRecords = history.map((h) => ({ imageId: h.image_id, shownAt: new Date(h.shown_at) }));

  if (holidayMatch) {
    const holidayChosenId = selectHolidayImage(
      holidayPool, TOWN_ID, holidayMatch.holiday, historyRecords, isoYearWeek, new Date(),
    );
    if (holidayChosenId) {
      await sql`
        INSERT INTO this_week_image_usage (town_id, iso_year_week, image_id)
        VALUES (${TOWN_ID}, ${isoYearWeek}, ${holidayChosenId})
        ON CONFLICT (town_id, iso_year_week) DO NOTHING
      `;
      return holidayPool.find((img) => img.id === holidayChosenId)!;
    }
    console.warn(
      `resolveThisWeekImage: active holiday "${holidayMatch.holiday}" for town "${TOWN_ID}" week ` +
      `"${isoYearWeek}" has no eligible image -- falling back to the season pool ("${season}"). Add curated ` +
      `images via scripts/source_this_week_images.py --holiday ${holidayMatch.holiday}.`,
    );
  }

  const chosenId = selectThisWeekImage(pool, TOWN_ID, season, historyRecords, isoYearWeek, new Date());
  if (!chosenId) {
    throw new Error(
      `resolveThisWeekImage: no eligible "This week" image for town "${TOWN_ID}", week "${isoYearWeek}", ` +
      `season "${season}" -- every candidate for this town+season was shown within the last 60 days, or ` +
      'config/this-week-images.ts has no entry at all for this town+season. Add more curated images ' +
      '(see that file\'s own module comment) rather than letting this fall back to a stale or wrong-season pick.',
    );
  }

  await sql`
    INSERT INTO this_week_image_usage (town_id, iso_year_week, image_id)
    VALUES (${TOWN_ID}, ${isoYearWeek}, ${chosenId})
    ON CONFLICT (town_id, iso_year_week) DO NOTHING
  `;
  return pool.find((img) => img.id === chosenId)!;
}

/** Every story of the given source_type(s), oldest first, no date window --
 *  for /this-week/[week].astro's day-by-day view (events + meetings), which
 *  needs to reach arbitrarily far back into the archive. Same "fetch broad
 *  once, filter in TS" pattern as getSeasonGames/getRegionalSports/
 *  getAllArtsEvents above. */
export async function getStoriesForWeekly(sourceTypes: SourceType[]): Promise<Story[]> {
  return (await sql`
    SELECT id, title, slug, body, source_type, source_url, occurs_at, published_at, generated_by,
           byline, image_path, image_alt, rating, ingredients, instructions,
           venue_raw, is_recurring_series, ends_at, category_image_index, featured
      FROM stories
     WHERE town_id = ${TOWN_ID}
       AND source_type = ANY(${sourceTypes})
       AND occurs_at IS NOT NULL
     ORDER BY occurs_at ASC
  `) as Story[];
}

/** getWorthKnowingCandidates()'s -24h-floor rolling window doesn't fit an
 *  ARCHIVED week (past or future relative to now) -- this is the same
 *  candidate shape (civic decisions + featured items), scoped instead to an
 *  explicit [start, end) instant range, for lib/this-week.ts's
 *  selectWeeklyLead() to pick a week's single "worth knowing" lead from. */
export async function getWorthKnowingCandidatesInRange(start: Date, end: Date, limit = 12): Promise<Story[]> {
  return (await sql`
    SELECT id, title, slug, body, source_type, source_url, occurs_at, published_at,
           generated_by, byline, image_path, image_alt, rating, ingredients, instructions, featured
      FROM stories
     WHERE town_id = ${TOWN_ID}
       AND source_type IN ('meeting', 'meeting_followup', 'alert')
       AND occurs_at >= ${start.toISOString()} AND occurs_at < ${end.toISOString()}
     ORDER BY featured DESC, occurs_at ASC
     LIMIT ${limit}
  `) as Story[];
}

/**
 * Relaterade artiklar till en given story.
 *
 * Strategi utan taggning eller ämnesmodell: samma källtyp först (ett möte leder
 * till andra möten, ett evenemang till andra evenemang), sorterat på närhet i
 * TID snarare än publiceringsdatum -- det är så en läsare uppfattar relevans på
 * en sajt som handlar om vad som händer. Räcker inte det fylls resten på med
 * närliggande poster oavsett typ, så listan aldrig blir tom.
 */
export async function getRelatedStories(
  story: Pick<Story, 'slug' | 'source_type' | 'occurs_at'>,
  limit = 3,
): Promise<Story[]> {
  const anchor = story.occurs_at ?? new Date().toISOString();

  const sameType = (await sql`
    SELECT id, title, slug, body, source_type, source_url, occurs_at, published_at, generated_by,
           byline, image_path, image_alt, rating, ingredients, instructions,
           venue_raw, is_recurring_series, ends_at, category_image_index
      FROM stories
     WHERE town_id = ${TOWN_ID}
       AND slug <> ${story.slug}
       AND source_type = ${story.source_type}
       AND occurs_at IS NOT NULL
       -- An unpublished row (e.g. a contamination-quarantine row, see
       -- NEEDS-HUMAN-REVIEW.md) still carries a real occurs_at from when it
       -- was generated, so without this it can surface as a "related story"
       -- link on any live page nearby in time -- confirmed live 2026-09-03.
       AND published_at IS NOT NULL
     ORDER BY abs(extract(epoch FROM (occurs_at - ${anchor}::timestamptz)))
     LIMIT ${limit}
  `) as Story[];

  if (sameType.length >= limit) return sameType;

  const seen = [story.slug, ...sameType.map((s) => s.slug)];
  const filler = (await sql`
    SELECT id, title, slug, body, source_type, source_url, occurs_at, published_at, generated_by,
           byline, image_path, image_alt, rating, ingredients, instructions,
           venue_raw, is_recurring_series, ends_at, category_image_index
      FROM stories
     WHERE town_id = ${TOWN_ID}
       AND slug <> ALL(${seen})
       AND occurs_at IS NOT NULL
       AND published_at IS NOT NULL
     ORDER BY abs(extract(epoch FROM (occurs_at - ${anchor}::timestamptz)))
     LIMIT ${limit - sameType.length}
  `) as Story[];

  return [...sameType, ...filler];
}

/**
 * "You might also like" -- site/src/components/RelatedContent.astro. Unlike
 * getRelatedStories() above (which finds OTHER stories near the same date),
 * this is for pages that AREN'T a single story -- section landing pages
 * like /traffic, /events, /university, /workplace-watch -- where the "next
 * click" is a small, deliberately curated set of OTHER SECTIONS and the
 * town's own game, not a database query result. Purely rule-based, no AI
 * call: every branch below is either a fixed link or a plain `stories`/
 * `school_alerts` lookup already used elsewhere in this file.
 *
 * town-gating is implicit, not an explicit parameter: TOWN_ID (module-level,
 * derived from siteConfig/SITE_CITY) already determines which game and
 * which of University/Workplace Watch apply, and 'university'/
 * 'workplace_watch' are only ever passed in by pages that are ALREADY
 * town-gated by redirect (university.astro/workplace-watch/index.astro) --
 * same pattern as everywhere else in this codebase, not a new mechanism.
 */
export type RelatedPageType =
  | 'traffic' | 'events' | 'university' | 'workplace_watch'
  | 'city_hall' | 'jobs' | 'home_sales' | 'vail_news' | 'closure_watch' | 'new_in_town'
  | 'facilities';

export interface RelatedItem {
  href: string;
  title: string;
  kicker: string;
  description?: string | null;
}

/** ISO week slug ("2026-w35") for a 'weekly' story's own occurs_at (its
 *  Monday) -- mirrors lib/this-week.ts's weekInfoForInstant()/isoWeekInfo()
 *  exactly, but deliberately duplicated rather than imported: this.ts
 *  imports FROM db.ts (calendarDateParts), so importing this-week.ts back
 *  here would be a circular module dependency. Same "duplicate across
 *  layers" tradeoff this codebase already makes for OUTLIER_PRICE_FLOOR /
 *  normalize_venue() / slugifyAddress() in astro.config.mjs. */
function isoWeekSlug(occursAt: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(occursAt));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const local = new Date(Date.UTC(get('year'), get('month') - 1, get('day')));
  const dayNum = (local.getUTCDay() + 6) % 7;
  local.setUTCDate(local.getUTCDate() - dayNum + 3); // nearest Thursday
  const isoYear = local.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4DayNum = (jan4.getUTCDay() + 6) % 7;
  const week1Monday = new Date(jan4.getTime() - jan4DayNum * 86_400_000);
  const isoWeek = Math.round((local.getTime() - week1Monday.getTime()) / (7 * 86_400_000)) + 1;
  return `${isoYear}-w${String(isoWeek).padStart(2, '0')}`;
}

async function latestStoryByType(sourceType: SourceType): Promise<RelatedItem | null> {
  const rows = (await sql`
    SELECT title, slug, body, published_at
      FROM stories
     WHERE town_id = ${TOWN_ID} AND source_type = ${sourceType}
       AND published_at IS NOT NULL
     ORDER BY published_at DESC
     LIMIT 1
  `) as { title: string; slug: string; body: string }[];
  const row = rows[0];
  if (!row) return null;
  return {
    href: storyHref(row.slug),
    title: row.title,
    kicker: CATEGORY_LABELS[sourceType] ?? sourceType,
    description: row.body.length > 90 ? row.body.slice(0, 90) + '…' : row.body,
  };
}

/** Topical authority handoff, Phase 5: which cluster route key each
 *  `RelatedPageType` corresponds to, so `getRelatedContent()` can ask
 *  `resolveCluster()` (site/src/lib/clusters.ts, Phase 1) what this page's
 *  cluster is. `new_in_town` is deliberately absent -- that feature is
 *  dark for every town today (no `hasNewInTown: true` anywhere in
 *  site-config.ts), so it was never given a cluster membership either;
 *  its own branch below stays completely untouched, same as before this
 *  phase. */
const RELATED_PAGE_TYPE_ROUTE_KEY: Partial<Record<RelatedPageType, string>> = {
  traffic: 'traffic',
  closure_watch: 'closures',
  events: 'events',
  university: 'university',
  workplace_watch: 'workplace-watch',
  city_hall: 'city-hall',
  jobs: 'jobs',
  home_sales: 'home-sales',
  vail_news: 'vail-resorts',
  facilities: 'facilities/detail', // only ever called from facilities/[slug].astro
};

/** "An upcoming event, an active closure, a recent digest" -- the
 *  handoff's own three examples of what counts as a same-cluster sibling
 *  worth surfacing first. Only implemented for clusters where a real,
 *  non-self-referential signal exists: `civic`'s only real caller
 *  (`city_hall`, the hub) already shows upcoming meetings prominently in
 *  its own primary content, and `places`/`local_life` have no single
 *  obvious "fresh" story type across every town -- both return `null`,
 *  falling through to the hub link (or nothing) instead of forcing a
 *  signal that doesn't exist. `excludePageType` skips a digest type that
 *  would be self-referential (e.g. `workplace_watch` linking to its own
 *  most recent `workplace_watch_digest`) -- mirrors the existing
 *  hand-tuned choice the `workplace_watch` branch below already made
 *  (it surfaces the `home_sales_digest` instead, never its own type). */
async function freshClusterSignal(clusterKey: string, currentPageType: RelatedPageType): Promise<RelatedItem | null> {
  switch (clusterKey) {
    case 'whats_happening': {
      const [nextEvent] = await getUpcomingStories(['event'], 1);
      return nextEvent
        ? { href: storyHref(nextEvent.slug), title: nextEvent.title, kicker: 'Events', description: formatOccursAt(nextEvent) }
        : null;
    }
    case 'getting_around': {
      // Self-referential on closures.astro itself -- that page already IS
      // "the active closure," not a sibling pointing at one.
      if (currentPageType === 'closure_watch') return null;
      const [closure] = await getActiveSchoolAlerts();
      return closure
        ? { href: closure.url || '/events/', title: closure.title || 'School closure alert', kicker: 'School alert', description: closure.district }
        : null;
    }
    case 'work_and_money': {
      const ownDigestType: SourceType | null =
        currentPageType === 'workplace_watch' ? 'workplace_watch_digest'
        : currentPageType === 'home_sales' ? 'home_sales_digest'
        : null;
      for (const t of ['workplace_watch_digest', 'home_sales_digest'] as const) {
        if (t === ownDigestType) continue;
        const item = await latestStoryByType(t);
        if (item) return item;
      }
      return null;
    }
    default:
      return null; // civic, places, local_life -- see doc comment above
  }
}

/** The cluster's own hub, as a related-content item -- only reached when
 *  the current page ISN'T the hub itself. Deliberately generic wording
 *  (a NEW case this phase adds, e.g. Broomfield's own `/jobs/`, gets this
 *  version); an existing branch below that already hand-tunes a link to
 *  the same href keeps its own more specific wording instead -- see
 *  `getRelatedContent()`'s own merge step. */
function hubRelatedItem(hubRoute: string): RelatedItem | null {
  switch (hubRoute) {
    case 'city-hall':
      return { href: '/city-hall/', title: 'City hall', kicker: 'City hall', description: 'Council and commission meetings, summarized in plain language.' };
    case 'events':
      return { href: '/events/', title: "What's on", kicker: 'Events', description: 'Everything happening this week, in one place.' };
    case 'traffic':
      return { href: '/traffic/', title: 'Traffic', kicker: 'Traffic', description: 'Current road incidents and closures.' };
    case 'workplace-watch':
      return { href: '/workplace-watch/', title: 'Worker Pulse', kicker: 'Worker Pulse', description: `Employer review trends for ${siteConfig.cityName}.` };
    case 'facilities':
      return { href: '/facilities/', title: 'Facilities', kicker: 'Facilities', description: 'Every park, library and civic building we track.' };
    case 'jackrabbits':
      return { href: '/jackrabbits/', title: 'Jackrabbits', kicker: 'Sports', description: 'Schedule and results.' };
    case 'sports':
      return { href: '/sports/', title: 'Regional sports', kicker: 'Sports', description: "Scores and schedules for the region's pro and minor-league teams." };
    case 'vail-resorts':
      return { href: '/vail-resorts/', title: 'Vail Resorts Newsroom', kicker: 'Vail Resorts', description: "Company news from the town's largest employer." };
    default:
      return null;
  }
}

export async function getRelatedContent(pageType: RelatedPageType): Promise<RelatedItem[]> {
  const isBrookings = TOWN_ID === 'brookings_sd';
  const isMorenoValley = TOWN_ID === 'moreno_valley_ca';
  const items: RelatedItem[] = [];

  // Topical authority handoff, Phase 5: a priority layer ABOVE every
  // per-pageType rule below, never a replacement for them (the handoff's
  // own explicit instruction) -- computed here, merged in at the very end
  // once `items` is fully populated by the existing (unchanged) branches.
  const clusterRouteKey = RELATED_PAGE_TYPE_ROUTE_KEY[pageType];
  const resolvedCluster = clusterRouteKey ? resolveCluster(clusterRouteKey, siteConfig) : null;
  const priorityItems: RelatedItem[] = [];
  if (resolvedCluster) {
    const fresh = await freshClusterSignal(resolvedCluster.primary.clusterKey, pageType);
    if (fresh) priorityItems.push(fresh);
    if (resolvedCluster.primary.role !== 'hub') {
      const hubItem = hubRelatedItem(resolvedCluster.hubRoute);
      if (hubItem) priorityItems.push(hubItem);
    }
  }

  // Arkadspelet -- olika spel per ort (Fas 1/2-arbetet denna session), inte
  // via CATEGORY_HREFS eftersom spelen inte är egna stories.
  const gameItem: RelatedItem | null = isBrookings
    ? { href: '/play/', title: 'Play Prairie Hopper', kicker: 'Play', description: 'Our free arcade game — how far can you get?' }
    : isMorenoValley
      ? { href: '/burro-bonanza/', title: 'Play Burro Bonanza', kicker: 'Play', description: "Our free match-3 game — help Dusty clear the trail." }
      : null;

  if (pageType === 'traffic') {
    const [nextEvent] = await getUpcomingStories(['event'], 1);
    if (nextEvent) {
      items.push({ href: storyHref(nextEvent.slug), title: nextEvent.title, kicker: 'Events', description: formatOccursAt(nextEvent) });
    }
    const [closure] = await getActiveSchoolAlerts();
    if (closure) {
      items.push({ href: closure.url || '/events/', title: closure.title || 'School closure alert', kicker: 'School alert', description: closure.district });
    }
    if (siteConfig.hasClosureWatch) {
      items.push({ href: '/closures/', title: 'Closure Watch', kicker: 'Closure Watch', description: 'Active weather alerts and what they mean for school closures.' });
    }
    // Fas 2 (SEO hub-linking, see NEEDS-HUMAN-REVIEW.md): roadwork and
    // closure decisions come out of city council/county commission
    // meetings -- no keyword classifier exists to pick out a specific
    // "roadwork" meeting from the rest, so this links the hub itself
    // rather than guessing at one meeting's relevance.
    items.push({ href: '/city-hall/', title: 'City hall', kicker: 'City hall', description: 'Council and commission decisions on roads, permits and closures.' });
    if (gameItem) items.push(gameItem);
  } else if (pageType === 'closure_watch') {
    items.push({ href: '/traffic/', title: 'Traffic', kicker: 'Traffic', description: 'Current road incidents and closures.' });
    items.push({ href: '/events/', title: "What's on", kicker: 'Events', description: 'Community events this week.' });
    items.push({ href: '/city-hall/', title: 'City hall', kicker: 'City hall', description: 'Council and commission decisions, including school-district-adjacent items.' });
    if (gameItem) items.push(gameItem);
  } else if (pageType === 'new_in_town') {
    const digest = await latestStoryByType('new_in_town_digest');
    if (digest) items.push(digest);
    items.push({ href: '/jobs/', title: 'Jobs', kicker: 'Jobs', description: `Current listings in and near ${siteConfig.cityName}.` });
    items.push({ href: '/events/', title: "What's on", kicker: 'Events', description: 'Community events this week.' });
    items.push({ href: '/traffic/', title: 'Traffic', kicker: 'Traffic', description: 'Current road incidents and closures.' });
    if (gameItem) items.push(gameItem);
  } else if (pageType === 'events') {
    items.push({ href: '/traffic/', title: 'Traffic', kicker: 'Traffic', description: 'Current road incidents and closures.' });
    const weekly = await getLatestWeekly();
    if (weekly && weekly.occurs_at) {
      items.push({
        href: `/this-week/${isoWeekSlug(weekly.occurs_at, siteConfig.timezone)}/`,
        title: weekly.title, kicker: 'This week', description: null,
      });
    }
    items.push({ href: '/facilities/', title: 'Venues & facilities', kicker: 'Facilities', description: 'Parks, libraries and community centers that host these events.' });
    items.push({ href: '/events/free/', title: 'Free things to do', kicker: 'Free', description: 'Always-free facilities and free events, in one place.' });
    items.push({ href: '/events/past/', title: 'Past events', kicker: 'Archive', description: 'Every community event covered here, by month.' });
    if (isBrookings) {
      items.push({ href: '/university/', title: "What's on at SDSU", kicker: 'University', description: 'Athletics, music and more.' });
    } else if (isMorenoValley) {
      items.push({ href: '/workplace-watch/', title: 'Worker Pulse', kicker: 'Worker Pulse', description: 'Employer review trends for Moreno Valley.' });
    }
  } else if (pageType === 'university') {
    const [nextEvent] = await getUpcomingStories(['event'], 1);
    if (nextEvent) {
      items.push({ href: storyHref(nextEvent.slug), title: nextEvent.title, kicker: 'Events', description: formatOccursAt(nextEvent) });
    }
    items.push({ href: '/events/campus/', title: 'Arts & culture at SDSU', kicker: 'Events', description: 'Music, theatre and special events on campus.' });
    items.push({ href: '/jackrabbits/', title: 'Jackrabbits', kicker: 'Sports', description: 'Schedule and results.' });
    items.push({ href: '/traffic/', title: 'Traffic', kicker: 'Traffic', description: 'Current road incidents and closures.' });
    if (gameItem) items.push(gameItem);
  } else if (pageType === 'workplace_watch') {
    const homeSales = await latestStoryByType('home_sales_digest');
    if (homeSales) items.push(homeSales);
    // Real bug found building the topical authority handoff's Phase 3
    // (both description strings hardcoded "Moreno Valley" unconditionally,
    // even though hasWorkplaceWatch is also true for Broomfield -- a
    // leftover from when Worker Pulse was Moreno-Valley-only, never
    // updated when it was extended). siteConfig.cityName is correct for
    // every town this branch can ever run for.
    items.push({ href: '/jobs/', title: 'Jobs', kicker: 'Jobs', description: `Current listings in and near ${siteConfig.cityName}.` });
    items.push({ href: '/events/', title: "What's on", kicker: 'Events', description: `This week in ${siteConfig.cityName}.` });
    if (gameItem) items.push(gameItem);
  } else if (pageType === 'city_hall') {
    items.push({ href: '/city-hall/archive/', title: 'Meeting archive', kicker: 'Archive', description: 'Every past meeting covered here, by month.' });
    items.push({ href: '/city-hall/projects/', title: 'Active city hall projects', kicker: 'City hall', description: 'Real developments and ordinances, tracked meeting by meeting.' });
    if (isMorenoValley) {
      items.push({ href: '/home-sales/', title: 'Recent home sales', kicker: 'Home sales', description: 'See how nearby decisions line up with local sale prices.' });
    }
    items.push({ href: '/events/', title: "What's on", kicker: 'Events', description: 'Community events this week.' });
  } else if (pageType === 'jobs') {
    if (isMorenoValley) {
      items.push({ href: '/workplace-watch/', title: 'Worker Pulse', kicker: 'Worker Pulse', description: 'Employer review trends for Moreno Valley.' });
      const digest = await latestStoryByType('workplace_watch_digest');
      if (digest) items.push(digest);
    }
    if (gameItem) items.push(gameItem);
  } else if (pageType === 'home_sales') {
    items.push({ href: '/home-sales/archive/', title: 'Digest archive', kicker: 'Archive', description: 'Every monthly home-sales digest, oldest to newest.' });
    items.push({ href: '/city-hall/projects/', title: 'City hall projects', kicker: 'City hall', description: 'Developments that may affect nearby home values.' });
  } else if (pageType === 'vail_news') {
    // Broomfield-only, same as the page itself -- links to the OTHER things
    // a Vail Resorts employee/investor/local reader would plausibly want
    // next, not a generic "more sections" grab-bag.
    items.push({ href: '/workplace-watch/', title: 'Worker Pulse', kicker: 'Worker Pulse', description: "Review-trend digests for Broomfield's major employers, including Vail Resorts." });
    items.push({ href: '/jobs/', title: 'Jobs', kicker: 'Jobs', description: 'Current listings in and near Broomfield.' });
    items.push({ href: '/traffic/', title: 'Traffic', kicker: 'Traffic', description: 'Current road incidents and closures.' });
  } else if (pageType === 'facilities') {
    items.push({ href: '/events/free/', title: 'Free things to do', kicker: 'Free', description: 'Always-free facilities and free events, in one place.' });
    items.push({ href: '/facilities/', title: 'Venues & facilities', kicker: 'Facilities', description: 'Every park, library and civic building we track.' });
    items.push({ href: '/events/', title: "What's on", kicker: 'Events', description: 'Community events this week.' });
  }

  // Merge: each priority slot is promoted to the front, using the
  // EXISTING branch's own item for that href when one already exists
  // (several branches above already hand-tune a hub or fresh-digest link
  // with more specific wording than this generic layer's own default --
  // that specificity should always win, only the ORDERING changes) and
  // falling back to this layer's own generic item only where the existing
  // rules had a real gap (e.g. Broomfield's own /jobs/ page, which never
  // got a Work and Money link before this phase because the old branch
  // only checked `isMorenoValley`). Every remaining existing item follows,
  // in its original order -- nothing from the old rules is ever dropped.
  const priorityHrefs = new Set(priorityItems.map((p) => p.href));
  const merged: RelatedItem[] = priorityItems.map((p) => items.find((i) => i.href === p.href) ?? p);
  for (const item of items) {
    if (!priorityHrefs.has(item.href)) merged.push(item);
  }
  return merged;
}

/* -------------------------------------------------- strukturerad data ------ */

export async function getUpcomingGames(limit = 10): Promise<Game[]> {
  return (await sql`
    SELECT id, sport, opponent, home_away, starts_at, venue, result
      FROM sports_games
     WHERE town_id = ${TOWN_ID} AND starts_at >= now()
     ORDER BY starts_at ASC
     LIMIT ${limit}
  `) as Game[];
}

export async function getRecentResults(limit = 5): Promise<Game[]> {
  return (await sql`
    SELECT id, sport, opponent, home_away, starts_at, venue, result
      FROM sports_games
     WHERE town_id = ${TOWN_ID} AND starts_at < now() AND result IS NOT NULL
     ORDER BY starts_at DESC
     LIMIT ${limit}
  `) as Game[];
}

export async function getSeasonGames(sport?: string): Promise<Game[]> {
  if (sport) {
    return (await sql`
      SELECT id, sport, opponent, home_away, starts_at, venue, result
        FROM sports_games
       WHERE town_id = ${TOWN_ID} AND sport = ${sport}
       ORDER BY starts_at ASC
    `) as Game[];
  }
  return (await sql`
    SELECT id, sport, opponent, home_away, starts_at, venue, result
      FROM sports_games
     WHERE town_id = ${TOWN_ID}
     ORDER BY starts_at ASC
  `) as Game[];
}

/** Alla matcher för orten, primary-lag (t.ex. 66ers för Moreno Valley) före
 *  secondary (LA-lagen i stort), sen datumordning -- sidan grupperar per
 *  team_name och Map-insättningsordningen följer denna sortering, så primary
 *  lag renderas överst utan att /sports.astro behöver sortera själv. */
export async function getRegionalSports(): Promise<RegionalGame[]> {
  return (await sql`
    SELECT league, team_name, team_abbr, opponent_name, home_away, game_date,
           game_time_utc, status, team_score, opponent_score, venue, relevance_tier
      FROM regional_sports_games
     WHERE town_id = ${TOWN_ID}
     ORDER BY relevance_tier, team_name, game_date ASC
  `) as RegionalGame[];
}

/** En rad ur school_alerts -- se db/migrations/010_school_alerts.sql och
 *  scrapers/parsers/school_alerts_v1.py. message är distriktets EGEN
 *  ordalydelse, oparafraserad -- rendera den rakt av, kör den aldrig genom
 *  någon AI-formatering. is_closure är förberäknad (nyckelordsmatchning) i
 *  parsern, inte här. */
export interface SchoolAlert {
  district: string;
  title: string | null;
  message: string;
  url: string | null;
  posted_at: string;
  is_closure: boolean;
}

/** Skolstängningar/förseningar/nödmeddelanden från de senaste dagarna --
 *  bannern på förstasidan visar bara DESSA (is_closure=true), inte hela
 *  distriktets allmänna meddelandeflöde (se school_alerts_v1.py:s
 *  moduldocstring för varför tabellen ändå innehåller alla poster).
 *  max_age_days är kort (3) med flit -- en stängningsnotis är bara relevant
 *  runt själva händelsen, till skillnad från NWS/county-varningar
 *  (getActiveAlerts, 14 dagar) som kan gälla en längre pågående situation. */
export async function getActiveSchoolAlerts(maxAgeDays = 3): Promise<SchoolAlert[]> {
  return (await sql`
    SELECT district, title, message, url, posted_at, is_closure
      FROM school_alerts
     WHERE town_id = ${TOWN_ID}
       AND is_closure = true
       AND posted_at >= now() - (${maxAgeDays} || ' days')::interval
     ORDER BY posted_at DESC
  `) as SchoolAlert[];
}

/** Active NWS alerts from the raw events table (source='nws_alert'), scoped
 *  to the alert-event names Closure Watch actually cares about (see
 *  siteConfig.closureWatch.relevantAlertEvents / configs/<town_id>.json's
 *  features.closure_watch.relevant_alert_events). Reads the RAW row, not the
 *  AI-formatted 'alert'-type story (see ai_pipeline/publish.py) -- the state
 *  machine needs the exact NWS event name for a deterministic match, and
 *  "not a new data source" (Handoff Feature A §2.2) means no AI in this
 *  path at all. */
async function getActiveWeatherAlerts(relevantEvents: string[]): Promise<WeatherAlert[]> {
  if (relevantEvents.length === 0) return [];
  const rows = (await sql`
    SELECT title, venue, url, starts_at, ends_at, raw_data
      FROM events
     WHERE town_id = ${TOWN_ID} AND source = 'nws_alert'
       AND title = ANY(${relevantEvents})
       AND (ends_at IS NULL OR ends_at >= now())
     ORDER BY starts_at DESC
  `) as { title: string; venue: string | null; url: string | null; starts_at: string; ends_at: string | null; raw_data: Record<string, unknown> | null }[];
  return rows.map((r) => ({
    event: r.title,
    areaDesc: r.venue,
    url: r.url,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    headline: (r.raw_data?.headline as string) ?? null,
    description: (r.raw_data?.description as string) ?? null,
    instruction: (r.raw_data?.instruction as string) ?? null,
  }));
}

async function closureHistoryCount(alertEvent: string): Promise<number> {
  const rows = (await sql`
    SELECT count(*)::int AS n FROM closure_history
     WHERE town_id = ${TOWN_ID} AND alert_event = ${alertEvent}
  `) as { n: number }[];
  return rows[0]?.n ?? 0;
}

/** The optional AI-generated Watch-state paragraph for a specific alert --
 *  see ai_pipeline/closure_watch_digest.py. A missing row (no guardrail-
 *  passing draft exists yet, or one was tried and rejected) is the expected,
 *  common case, not an error -- closures.astro falls back to a fully static
 *  Watch template in that case, see that page's own hardcoded copy. */
async function getClosureWatchProse(alertUrl: string): Promise<string | null> {
  const rows = (await sql`
    SELECT body FROM closure_watch_prose
     WHERE town_id = ${TOWN_ID} AND alert_url = ${alertUrl}
     LIMIT 1
  `) as { body: string }[];
  return rows[0]?.body ?? null;
}

/**
 * Closure Watch's full page-render data: the state (Confirmed/Watch/Clear,
 * see lib/closure-watch.ts) plus the optional AI prose for a Watch alert.
 * Callers must already be town-gated (siteConfig.hasClosureWatch), same
 * pattern as getRelatedContent's 'university'/'workplace_watch' cases --
 * this throws if siteConfig.closureWatch is missing rather than silently
 * defaulting, since that would mean the two config systems drifted (see
 * tests/test_feature_flags.py, which should have already caught that).
 */
export async function getClosureWatchStatus(): Promise<ClosureWatchStatus & { prose: string | null }> {
  const feat = siteConfig.closureWatch;
  if (!feat) throw new Error('getClosureWatchStatus() called but siteConfig.closureWatch is not set');

  const [closures, alerts] = await Promise.all([
    getActiveSchoolAlerts(),
    getActiveWeatherAlerts(feat.relevantAlertEvents),
  ]);
  const alert = alerts[0] ?? null;
  const historicalCount = alert ? await closureHistoryCount(alert.event) : 0;
  const minRequired = alert
    ? feat.minHistoricalClosuresForWatch[alert.event] ?? feat.minHistoricalClosuresForWatch.default ?? 0
    : 0;
  const status = computeClosureWatchState(closures, alert, historicalCount, minRequired);

  const prose = status.state === 'watch' && status.alert ? await getClosureWatchProse(status.alert.url ?? '') : null;
  return { ...status, prose };
}

export interface WhatsOnIntroRow {
  body: string;
  isoYear: number;
  isoWeek: number;
}

/** The optional AI-generated weekly intro block for /whats-on (What's On
 *  Phase 6b) -- see ai_pipeline/whats_on_intro.py. Fetches the MOST RECENT
 *  row regardless of week (not an exact iso_year/iso_week match) so the
 *  freshness comparison is a separate, pure, testable step -- see
 *  lib/whats-on.ts's own isWhatsOnIntroFresh(), which the page calls against
 *  this row's isoYear/isoWeek and lib/this-week.ts's currentWeekInfo(). A
 *  missing row (never generated, or the only guardrail-passing draft is for
 *  an old week that was since cleared -- see that module's own "delete
 *  before regenerating" discipline) is the expected, common case: the page
 *  simply renders with no intro block at all, same "absence is a normal
 *  state, not an error" convention as getClosureWatchProse() above. */
export async function getWhatsOnIntro(): Promise<WhatsOnIntroRow | null> {
  const rows = (await sql`
    SELECT body, iso_year AS "isoYear", iso_week AS "isoWeek" FROM whats_on_intro
     WHERE town_id = ${TOWN_ID}
     ORDER BY iso_year DESC, iso_week DESC
     LIMIT 1
  `) as WhatsOnIntroRow[];
  return rows[0] ?? null;
}

/** The optional AI-generated one-sentence "deck" for a marquee-tier
 *  Ticketmaster event (marquee deck sentences follow-up) -- see
 *  ai_pipeline/event_deck_digest.py. Keyed on Ticketmaster's own event id,
 *  NOT persisted alongside the event itself (Ticketmaster events still
 *  aren't stored anywhere -- see that script's own module docstring), so
 *  this is a batch lookup by id, called once per build with every
 *  marquee-tier item's id at once rather than per-card. A missing entry
 *  for a given id (never generated yet, too sparse to ground a sentence,
 *  or a guardrail rejection) is the expected, common case -- the caller
 *  simply omits the deck line for that card, same "absence is a normal
 *  state, not an error" convention as getWhatsOnIntro() above. */
export async function getEventDeckDigests(ticketmasterEventIds: string[]): Promise<Map<string, string>> {
  if (ticketmasterEventIds.length === 0) return new Map();
  const rows = (await sql`
    SELECT ticketmaster_event_id AS "ticketmasterEventId", body FROM event_deck_digest
     WHERE town_id = ${TOWN_ID} AND ticketmaster_event_id = ANY(${ticketmasterEventIds})
  `) as { ticketmasterEventId: string; body: string }[];
  return new Map(rows.map((r) => [r.ticketmasterEventId, r.body]));
}

/** En rad ur local_businesses -- se db/migrations/031_local_businesses.sql
 *  och ai_pipeline/new_in_town_digest.py. Bara needs_review=false rader
 *  läses här: en 'closed'-uppgift med bara en källa är avsiktligt osynlig
 *  för sajten tills en andra, oberoende källa bekräftat den (se den
 *  modulens moduldocstring för hela tvåkälls-regeln) -- denna funktion är
 *  den enda platsen render-vägen läser tabellen, så det finns bara ETT
 *  ställe att komma ihåg det filtret. */
export interface LocalBusiness {
  name: string;
  category: string | null;
  status: 'opened' | 'opening_soon' | 'closed';
  address: string | null;
  source_url: string;
  source_name: string;
  reported_date: string | null;
  first_seen: string;
}

export async function getLocalBusinesses(limit = 60): Promise<LocalBusiness[]> {
  return (await sql`
    SELECT name, category, status, address, source_url, source_name, reported_date, first_seen
      FROM local_businesses
     WHERE town_id = ${TOWN_ID} AND needs_review = false
     ORDER BY first_seen DESC
     LIMIT ${limit}
  `) as LocalBusiness[];
}

/** En rad ur traffic_incidents -- se db/migrations/011_traffic_incidents.sql
 *  och scrapers/parsers/traffic_v1.py. Strukturerad data, ingen AI. */
export interface TrafficIncident {
  incident_type: string;
  title: string;
  description: string | null;
  road: string | null;
  severity: string | null;
  lat: number | null;
  lon: number | null;
  ends_at: string | null;
  last_seen_at: string;
}

/** Trafikincidenter som fortfarande verkar aktuella -- (a) ingen känd
 *  sluttid ELLER sluttiden är i framtiden, OCH (b) källan har rapporterat
 *  incidenten nyligen (senaste 3 timmarna). Del (b) behövs eftersom många
 *  CHP-incidenter aldrig får en explicit sluttid -- utan den skulle en
 *  incident från igår kväll fortsätta visas som "aktuell" för evigt.
 *
 *  FAS 2: sorterar nu på severity (closure > injury > incident > planned,
 *  se traffic_v1.py:_classify_severity) före last_seen_at, så det
 *  allvarligaste ligger överst i stället för bara senast sedd. */
export async function getActiveTrafficIncidents(maxAgeHours = 3): Promise<TrafficIncident[]> {
  return (await sql`
    SELECT incident_type, title, description, road, severity, lat, lon, ends_at, last_seen_at
      FROM traffic_incidents
     WHERE town_id = ${TOWN_ID}
       AND (ends_at IS NULL OR ends_at >= now())
       AND last_seen_at >= now() - (${maxAgeHours} || ' hours')::interval
     ORDER BY
       CASE severity WHEN 'closure' THEN 0 WHEN 'injury' THEN 1 WHEN 'incident' THEN 2 WHEN 'planned' THEN 3 ELSE 4 END,
       last_seen_at DESC
  `) as TrafficIncident[];
}

/** FAS 2: rå CHP/Caltrans-text ("C74-R12 WB 91 FROM ADAMS TO VB 3/4 LNS
 *  CLOSED") är genuint svårläst för en vanlig läsare. Ordlistan expanderar
 *  bara TERMER VI ÄR SÄKRA PÅ (riktningsförkortningar, "LNS"->"lanes" osv)
 *  -- allt annat (vägnummer, tvetydiga förkortningar som "VB", gatunamn)
 *  lämnas orört i stället för att gissa vad de betyder (husregel: attribuera,
 *  påstå aldrig). Källtexten finns alltid kvar oförändrad bredvid (se
 *  traffic.astro:s "view source" expander) så ingen information göms. */
const _TRAFFIC_GLOSSARY: Record<string, string> = {
  WB: 'Westbound', EB: 'Eastbound', NB: 'Northbound', SB: 'Southbound',
  LNS: 'lanes', LN: 'lane', RAMP: 'ramp', XING: 'crossing', SHLDR: 'shoulder',
  TC: 'traffic collision', INJ: 'with injuries reported', VEH: 'vehicle',
  CONST: 'construction', MAINT: 'maintenance', DEBRIS: 'debris in roadway',
  OVERTURNED: 'overturned vehicle', SIGALERT: 'Sig-alert (major delay expected)',
};

export function plainLanguageTraffic(text: string | null): string | null {
  if (!text) return text;
  return text
    .split(/(\s+)/)
    .map((token) => {
      const bare = token.replace(/[.,;:]+$/, '');
      const upper = bare.toUpperCase();
      if (_TRAFFIC_GLOSSARY[upper]) {
        return token.replace(bare, _TRAFFIC_GLOSSARY[upper]);
      }
      return token;
    })
    .join('');
}

/** Samma som formatTime men med explicit tidszonsförkortning ("3:45 PM PDT")
 *  -- traffic.astro-specifikt (se husreglerna: "raw scanner jargon" gäller
 *  även en tyst, oetiketterad tidszon). Inte i formatTime självt: skulle
 *  ändra utseendet på bylines/datumstämplar sitewide utan att det bads om. */
export function formatTimeWithZone(value: string | null): string {
  if (!value) return '';
  return new Date(value).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: TZ, timeZoneName: 'short',
  });
}

/** En rad ur jobs -- se db/migrations/012_jobs.sql och
 *  scrapers/parsers/jobs_v1.py. Strukturerad data (Adzuna), ingen AI. */
export interface Job {
  external_job_id: string;
  title: string;
  company: string | null;
  location: string | null;
  category: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_is_predicted: boolean | null;
  description: string | null;
  redirect_url: string | null;
  posted_at: string | null;
}

// FAS 2: jobs ÄR append-only (se migration 012, ON CONFLICT DO NOTHING) --
// men det betyder INTE att en annons försvinner härifrån när Adzuna
// slutar lista den uppströms. Utan en egen åldersgräns låg annonser kvar
// synliga i upp till 7 månader (liveverifierat). MAX_AGE_DAYS matchar
// Adzunas egen ungefärliga "aktiv annons"-livslängd.
const JOBS_MAX_AGE_DAYS = 45;

/** Senaste jobbannonserna, nyast först, max JOBS_MAX_AGE_DAYS gamla (se
 *  ovan). posted_at IS NULL hålls kvar (Adzuna anger nästan alltid created,
 *  men om den saknas är det hellre synlig-utan-datum än tyst borttagen). */
export async function getRecentJobs(limit = 100): Promise<Job[]> {
  return (await sql`
    SELECT external_job_id, title, company, location, category,
           salary_min, salary_max, salary_is_predicted, description,
           redirect_url, posted_at
      FROM jobs
     WHERE town_id = ${TOWN_ID}
       AND (posted_at IS NULL OR posted_at >= now() - (${JOBS_MAX_AGE_DAYS} || ' days')::interval)
     ORDER BY posted_at DESC NULLS LAST
     LIMIT ${limit}
  `) as Job[];
}

/** En rad ur sdsu_events -- se db/migrations/013_sdsu_events.sql,
 *  db/migrations/015_sdsu_events_bucket.sql och
 *  scrapers/parsers/sdsu_events_v1.py. teaser är källans EGEN korta
 *  sammanfattning, aldrig en fullständig eventbeskrivning -- se parserns
 *  moduldocstring för upphovsrättsresonemanget.
 *
 *  bucket avgör vilken sida en rad hör hemma på ("university" -> /university,
 *  "arts_culture" -> /events, se sdsu_events_v1.py:s BUCKET_MAP) --
 *  is_filtered/filter_reason flaggar internt/icke-publikt brus (invite-only,
 *  pensionsmottagningar) som INTE ska visas någonstans men som ändå finns
 *  kvar i tabellen, se parserns moduldocstring "BORTFILTRERING". Alla
 *  frågor nedan filtrerar därför uttryckligen på bucket och
 *  `NOT is_filtered` -- ingen fråga mot den här tabellen ska glömma det. */
export interface SdsuEvent {
  external_event_id: string;
  title: string;
  teaser: string | null;
  location: string | null;
  starts_at: string | null;
  ends_at: string | null;
  categories: string[];
  primary_category: string | null;
  event_url: string;
}

/** Kommande SDSU-evenemang för /university (bucket="university": Athletics +
 *  Camps/Conferences -- se sdsu_events_v1.py:s BUCKET_MAP för
 *  arts_culture-uppdelningen). En liten "redan börjat men inte slut"-
 *  marginal (3 h) i stället för strikt now() -- annars försvinner ett
 *  pågående evenemang ur listan mitt under tiden det äger rum. */
export async function getUpcomingSdsuEvents(limit = 60): Promise<SdsuEvent[]> {
  return (await sql`
    SELECT external_event_id, title, teaser, location, starts_at, ends_at,
           categories, primary_category, event_url
      FROM sdsu_events
     WHERE town_id = ${TOWN_ID}
       AND bucket = 'university'
       AND NOT is_filtered
       AND starts_at >= now() - interval '3 hours'
     ORDER BY starts_at ASC
     LIMIT ${limit}
  `) as SdsuEvent[];
}

/** Kommande "Arts & Culture"-evenemang för /events (bucket="arts_culture":
 *  Music + Special Events + Theatre/Dance, plus museum-/trädgårdsvenue-
 *  överstyrning -- se sdsu_events_v1.py). Renderas där via samma
 *  StoryCard-komponent som stadens övriga events, med en href/kicker-
 *  override eftersom de inte har en egen /s/[slug]-sida (se StoryCard.astro). */
export async function getUpcomingArtsEvents(limit = 40): Promise<SdsuEvent[]> {
  return (await sql`
    SELECT external_event_id, title, teaser, location, starts_at, ends_at,
           categories, primary_category, event_url
      FROM sdsu_events
     WHERE town_id = ${TOWN_ID}
       AND bucket = 'arts_culture'
       AND NOT is_filtered
       AND starts_at >= now() - interval '3 hours'
     ORDER BY starts_at ASC
     LIMIT ${limit}
  `) as SdsuEvent[];
}

/** Every arts_culture SDSU event, no date floor -- unlike
 *  getUpcomingArtsEvents() above (upcoming-only, for /events), this is for
 *  /this-week/[week].astro's archive weeks, which need past SDSU events too.
 *  town-scoped as always -- naturally empty for towns with no SDSU feed
 *  (e.g. Moreno Valley), same pattern as getRegionalSports() being
 *  naturally empty for Brookings. Limit is generous headroom, not a real
 *  cap: confirmed live at 122 rows for Brookings' whole ~5-month feed. */
export async function getAllArtsEvents(limit = 1000): Promise<SdsuEvent[]> {
  return (await sql`
    SELECT external_event_id, title, teaser, location, starts_at, ends_at,
           categories, primary_category, event_url
      FROM sdsu_events
     WHERE town_id = ${TOWN_ID}
       AND bucket = 'arts_culture'
       AND NOT is_filtered
     ORDER BY starts_at ASC
     LIMIT ${limit}
  `) as SdsuEvent[];
}

/** En rad ur academic_calendar_dates -- se db/migrations/014_academic_calendar.sql
 *  och data/academic_calendar/<town_id>.json (handkuraterat, se
 *  scripts/seed_academic_calendar.py). */
export interface AcademicDate {
  label: string;
  term: string | null;
  category: string | null;
  starts_on: string;
  ends_on: string | null;
}

/** De närmaste akademiska nyckeldatumen -- bara "next up"-ribbon, inte en
 *  full terminskalender (se /university.astro). Ett datumintervall som
 *  redan börjat men inte slutat (t.ex. pågående lovvecka) räknas som
 *  fortfarande relevant, inte förbi. */
export async function getUpcomingAcademicDates(limit = 2): Promise<AcademicDate[]> {
  return (await sql`
    SELECT label, term, category, starts_on, ends_on
      FROM academic_calendar_dates
     WHERE town_id = ${TOWN_ID}
       AND COALESCE(ends_on, starts_on) >= CURRENT_DATE
     ORDER BY starts_on ASC
     LIMIT ${limit}
  `) as AcademicDate[];
}

/** Nästa "marquee"-evenemang -- ATHLETICS-ONLY (Music flyttades till
 *  arts_culture/-events i editorial-omorganiseringen, se
 *  sdsu_events_v1.py:s moduldocstring "EDITORIAL-OMORGANISERING") -- till
 *  förstasidans rail, samma roll som getNextRegionalGame() fyller för
 *  regional sport. Konkurrerar om SAMMA rail-slot som Jackrabbits nästa
 *  match för Brookings (se index.astro) -- ett eget, smalt query i stället
 *  för att hämta alla getUpcomingSdsuEvents() bara för förstasidans enda rad. */
export async function getNextSdsuMarqueeEvent(): Promise<SdsuEvent | null> {
  const rows = (await sql`
    SELECT external_event_id, title, teaser, location, starts_at, ends_at,
           categories, primary_category, event_url
      FROM sdsu_events
     WHERE town_id = ${TOWN_ID}
       AND bucket = 'university'
       AND NOT is_filtered
       AND primary_category = 'Athletics'
       AND starts_at >= now() - interval '3 hours'
     ORDER BY starts_at ASC
     LIMIT 1
  `) as SdsuEvent[];
  return rows[0] ?? null;
}

/** Nästa ospelade/pågående match bland primary-lagen -- till förstasidans
 *  högerfält (samma roll som getUpcomingGames(1) fyller för Jackrabbits,
 *  se index.astro). Ett separat, smalt query i stället för att hämta hela
 *  getRegionalSports() och filtrera i Astro-lagret -- förstasidan behöver
 *  bara en rad, inte hela ortens säsong. */
export async function getNextRegionalGame(): Promise<RegionalGame | null> {
  const rows = (await sql`
    SELECT league, team_name, team_abbr, opponent_name, home_away, game_date,
           game_time_utc, status, team_score, opponent_score, venue, relevance_tier
      FROM regional_sports_games
     WHERE town_id = ${TOWN_ID}
       AND relevance_tier = 'primary'
       AND status IN ('scheduled', 'live')
     ORDER BY game_date ASC
     LIMIT 1
  `) as RegionalGame[];
  return rows[0] ?? null;
}

export async function getWeather(): Promise<WeatherPeriod[]> {
  const rows = (await sql`
    SELECT payload
      FROM weather_snapshots
     WHERE town_id = ${TOWN_ID}
     ORDER BY observed_for DESC
     LIMIT 1
  `) as { payload: { periods?: WeatherPeriod[] } }[];
  return rows[0]?.payload?.periods ?? [];
}

/** FAS 2: timprognos (~24h framåt) -- se scrapers/parsers/noaa.py. Samma rad/
 *  snapshot som getWeather(), bara ett annat fält i samma payload -- ingen
 *  extra fråga mot en egen tabell. */
export async function getHourlyWeather(): Promise<HourlyWeatherPeriod[]> {
  const rows = (await sql`
    SELECT payload
      FROM weather_snapshots
     WHERE town_id = ${TOWN_ID}
     ORDER BY observed_for DESC
     LIMIT 1
  `) as { payload: { hourly?: HourlyWeatherPeriod[] } }[];
  return rows[0]?.payload?.hourly ?? [];
}

export async function getAgPrices(): Promise<AgPrice[]> {
  return (await sql`
    SELECT DISTINCT ON (commodity) commodity, price, unit, as_of
      FROM ag_prices
     WHERE town_id = ${TOWN_ID}
     ORDER BY commodity, as_of DESC
  `) as AgPrice[];
}

/** Month-difference between two "YYYY-MM-01"-shaped as_of values -- used
 *  only to find the real stored row 12 calendar months back, never to
 *  fabricate one. */
function monthsBetween(a: string, b: string): number {
  const da = new Date(a), db_ = new Date(b);
  return (db_.getUTCFullYear() - da.getUTCFullYear()) * 12 + (db_.getUTCMonth() - da.getUTCMonth());
}

/** Every stored monthly row per commodity, with direction/trend derived
 *  from real adjacent rows (never assumed) -- see AgPriceSeries and
 *  NEEDS-HUMAN-REVIEW.md "Brookings — Farm Report Depth". Previous fix
 *  (getAgPrices above) also corrected: that query picked the most
 *  recently-INSERTED row (created_at DESC), not the most recent REPORTING
 *  PERIOD (as_of DESC) -- harmless when only one row per commodity ever
 *  existed, a real bug once usda.py started storing full history in one
 *  batch, where insert order isn't guaranteed to match chronological order. */
export async function getAgPriceSeries(): Promise<AgPriceSeries[]> {
  const rows = (await sql`
    SELECT commodity, price, unit, as_of
      FROM ag_prices
     WHERE town_id = ${TOWN_ID} AND price IS NOT NULL AND as_of IS NOT NULL
     ORDER BY commodity, as_of ASC
  `) as { commodity: string; price: number; unit: string | null; as_of: string }[];

  const byCommodity = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!byCommodity.has(row.commodity)) byCommodity.set(row.commodity, []);
    byCommodity.get(row.commodity)!.push(row);
  }

  const series: AgPriceSeries[] = [];
  for (const [commodity, history] of byCommodity) {
    if (history.length === 0) continue;
    const latest = history[history.length - 1];
    const previous = history.length >= 2 ? history[history.length - 2] : null;
    const yearAgo = history.slice(0, -1).find((r) => monthsBetween(r.as_of, latest.as_of) === 12) ?? null;
    const prices = history.map((r) => Number(r.price));
    series.push({
      commodity,
      unit: latest.unit,
      latest: { price: Number(latest.price), as_of: latest.as_of },
      previous: previous ? { price: Number(previous.price), as_of: previous.as_of } : null,
      yearAgo: yearAgo ? { price: Number(yearAgo.price), as_of: yearAgo.as_of } : null,
      history: history.map((r) => ({ price: Number(r.price), as_of: r.as_of })),
      rangeMin: Math.min(...prices),
      rangeMax: Math.max(...prices),
    });
  }

  // Matchar usda.py:s DISPLAY_ORDER (SD-relevans, inte alfabetiskt) --
  // duplicerad här medvetet snarare än importerad, samma "liten delad
  // algoritm hellre än en cross-language modul"-avvägning som
  // venue_registry.py/db.ts redan gör på andra ställen i den här kodbasen.
  // Ett commodity som inte finns i listan (borde inte hända, men inte värt
  // att krascha på) hamnar sist snarare än att försvinna.
  const DISPLAY_ORDER = ["corn", "soybeans", "wheat", "sunflowers", "oats", "cattle", "hogs"];
  series.sort((a, b) => {
    const ia = DISPLAY_ORDER.indexOf(a.commodity);
    const ib = DISPLAY_ORDER.indexOf(b.commodity);
    return (ia === -1 ? DISPLAY_ORDER.length : ia) - (ib === -1 ? DISPLAY_ORDER.length : ib);
  });
  return series;
}

/**
 * Husförsäljningar -- STRUKTURERAD DATA, precis som sport/väder/råvarupriser
 * (se publish.py-docstringen, punkt 4): en story per rad hade gett tusentals
 * nästan identiska sidor, samma "scaled content"-signal som redan flaggades
 * där. property_sales läses därför direkt härifrån och renderas som tabell
 * på /home-sales, aldrig via ai_pipeline.publish/stories.
 *
 * sale_date är ett rent kalenderdatum (samma lagringsform som meeting_date)
 * -- formatera med formatCalendarDate(), inte formatDate(), annars skiftar
 * datumet bakåt en dag. Se kommentaren vid formatCalendarDate() nedan.
 */
export async function getRecentPropertySales(limit = 250): Promise<PropertySale[]> {
  return (await sql`
    SELECT address, sale_price, sale_date, pin
      FROM property_sales
     WHERE town_id = ${TOWN_ID}
     ORDER BY sale_date DESC
     LIMIT ${limit}
  `) as PropertySale[];
}

/** One row per distinct parcel (its most recently-recorded address
 *  spelling), for /home-sales/[slug].astro's getStaticPaths -- the full
 *  set of permalink pages to build. sale_date is that most recent sale's
 *  own date (DISTINCT ON (pin) + ORDER BY sale_date DESC already picks
 *  it) -- render-window handoff: the page-generation layer filters on it
 *  via isWithinRenderWindow(), this function stays an unfiltered fetch of
 *  every parcel regardless of window (see lib/render-window.ts's own
 *  module doc on why db.ts never applies this filter itself). */
export async function getPropertySaleParcels(): Promise<{ pin: string; address: string; sale_date: string | null }[]> {
  return (await sql`
    SELECT DISTINCT ON (pin) pin, address, sale_date
      FROM property_sales
     WHERE town_id = ${TOWN_ID} AND pin IS NOT NULL
     ORDER BY pin, sale_date DESC
  `) as { pin: string; address: string; sale_date: string | null }[];
}

/** A single parcel's full recorded sale history, most recent first -- the
 *  "sold March 2024; previously sold 2019" timeline an address page shows. */
export async function getPropertySalesByPin(pin: string): Promise<PropertySale[]> {
  return (await sql`
    SELECT address, sale_price, sale_date, pin, doc_number
      FROM property_sales
     WHERE town_id = ${TOWN_ID} AND pin = ${pin}
     ORDER BY sale_date DESC
  `) as PropertySale[];
}

/**
 * Lokala anläggningar (bibliotek, parker, city hall, ...) -- HANDKURERAD FAKTA,
 * inte skrapad. Se db/migrations/007_facilities.sql och scripts/seed_facilities.py
 * för varifrån datat kommer.
 *
 * Till skillnad från property_sales ovan FÅR varje anläggning en egen sida
 * (site/src/pages/facilities/[slug].astro). Det är medvetet, inte en
 * inkonsekvens med "en story per rad är scaled content"-principen: en
 * husförsäljning är en av tusentals identiska rader utan egen identitet,
 * men "Moreno Valley Main Library" är en specifik, namngiven plats som
 * folk faktiskt söker efter vid namn (bekräftat i Search Console: sökningar
 * som "moreno valley main library", "lasselle sports park", "mv library"
 * stod för nästan alla exponeringar sajten fick, men gav noll klick eftersom
 * ingen sida besvarade frågan). Fem-åtta sådana sidor med genuin, unik text
 * per anläggning är en normal katalogsida, inte skalat innehåll.
 *
 * Broomfield place-layer handoff, Step 2: the underlying table is now
 * `places` (renamed from `facilities`, db/migrations/045_facilities_to_places.sql)
 * -- this interface, getFacilities()/getFacilityBySlug() and every existing
 * /facilities/ route deliberately KEEP their current names. Brookings and
 * Moreno Valley's existing routes/columns are completely unaffected by the
 * rename; only Broomfield's new /place/[slug] template (see that handoff)
 * reads the place-layer-specific columns/tables this interface doesn't
 * carry (place_hours, place_hours_exceptions, is_free, ...).
 */
export interface Facility {
  slug: string;
  name: string;
  category: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  hours_text: string | null;
  description: string | null;
  source_url: string | null;
  verified_date: string | null;
  // Added by db/migrations/020_event_venue_resolution.sql for Event
  // JSON-LD venue resolution (see ai_pipeline/venue_registry.py) -- aliases
  // are every raw scraped venue string seen for this facility; street_address
  // + postal_code must BOTH be present for a resolved facility to count as
  // rich-result-eligible, see hasResolvedAddress().
  aliases: string[];
  street_address: string | null;
  postal_code: string | null;
  lat: number | null;
  lon: number | null;
  // Added by db/migrations/026_facility_images.sql for Venue & Category
  // Image Identity (see lib/images.ts) -- a DIFFERENT alias list than
  // `aliases` above: `aliases` matches a full scraped LOCATION string,
  // name_aliases matches a story title's colon-delimited venue PREFIX
  // specifically (see lib/images.ts's module docstring for why). Both
  // image_path/image_alt are NULL until a bespoke illustration has
  // actually been generated and seeded for that facility -- most
  // facilities (parks, community centers) never get one and fall through
  // to the category-image tier instead.
  image_path: string | null;
  image_alt: string | null;
  name_aliases: string[];
  // Added by db/migrations/028_facility_image_attribution.sql -- see that
  // migration's own comment. NULL for a facility with no image, same as
  // image_path/image_alt above.
  image_attribution_text: string | null;
  image_attribution_url: string | null;
  // Also added by db/migrations/028_facility_image_attribution.sql (see
  // that migration's own comment): true when a venue could NOT be matched
  // to a real photo of that specific building -- "a punch list for a human
  // to revisit later... not rendered anywhere on the site itself" per the
  // migration's own original scope. Sitewide presentation-layer pass:
  // exposed to the frontend for the first time so /facilities can honor it
  // directly (never render an unverified image, text-only instead) rather
  // than relying solely on image_path staying NULL for that case.
  image_needs_review: boolean;
  // Added by db/migrations/036_free_teasers.sql for the /events/free/
  // "Always free" facilities section -- a short, one-time-generated
  // paragraph (see ai_pipeline/free_teasers.py) framing this facility for
  // a free-family-outing reader. Only ever populated for the free-venue
  // categories that page cares about (library/park/community_center);
  // NULL for every other facility, and NULL until generation has run.
  free_teaser: string | null;
  // Added by db/migrations/038_facility_hours_structured.sql (Recurring-
  // traffic layer, Phase 2) -- backfilled from hours_text by
  // ai_pipeline/facility_hours.py's deterministic parser (see
  // scripts/migrate_facility_hours.py), never hand-written. NULL whenever
  // hours_text itself is NULL (no data at all) OR the parser couldn't
  // confidently read it (see hours_needs_review) -- callers must fall back
  // to rendering hours_text as plain text in both those cases, see
  // lib/facility-hours.ts's computeOpenStatus() for the "is it open right
  // now" computation this field actually powers.
  hours_structured: StructuredHours | null;
  // True only when hours_text is set but the parser flagged it (an
  // open-ended time, an unparsed caveat, ...) -- see facility_hours.py's
  // own docstring. False (the column's default) covers BOTH "no hours_text
  // at all" and "parsed successfully"; this field only distinguishes the
  // one state that actually wants a human's attention.
  hours_needs_review: boolean;
  // Facilities Traffic Pass, 2026-10-03: merged in from the former
  // Broomfield-only PlaceDetail interface (deleted) -- Search Console
  // showed no canonical conflict between /facilities/ and /place/ for
  // Broomfield, so /facilities/[slug] became the one template for all
  // three towns instead of the reverse. `id` was PlaceDetail-only
  // (place_hours/place_hours_exceptions are keyed on it); every /facilities/
  // route needs it now too, for the same reason /place/[slug] did.
  id: number;
  is_free: boolean | null;
  fee_note: string | null;
  accessibility_note: string | null;
  services: string[] | null;
  verification_method: string | null;
  hours_confidence: string | null;
}

/** One facility's whole week, 24h local "HH:MM" strings -- mirrors
 *  ai_pipeline/facility_hours.py's ParsedHours.structured shape exactly
 *  (JSON round-trips a Python tuple as a 2-element array). A day with no
 *  entry (null) means closed that day, not "unknown" -- see that module's
 *  own comment on why an unmentioned day defaults to closed. */
export interface StructuredHours {
  monday: [string, string] | null;
  tuesday: [string, string] | null;
  wednesday: [string, string] | null;
  thursday: [string, string] | null;
  friday: [string, string] | null;
  saturday: [string, string] | null;
  sunday: [string, string] | null;
}

/** Alla anläggningar för den aktuella orten, grupperat på category av
 *  anroparen (t.ex. /facilities/index.astro). Sorterat på category sen namn
 *  så renderingen blir stabil utan att varje sida behöver egen ORDER BY.
 *
 *  Facilities Traffic Pass, 2026-10-03: now selects the full place-layer
 *  column set too (id, is_free, services, ...) -- getAllPlaces()/
 *  getPlaceBySlug() and the PlaceDetail interface are deleted, this is the
 *  one query for all three towns now. See db/migrations/045's own comment
 *  for why those were ever separate (a Broomfield-only /place/ template
 *  the rest of this pass just retired, see redirects in place/[slug].astro
 *  and places/index.astro). */
export async function getFacilities(): Promise<Facility[]> {
  return (await sql`
    SELECT id, slug, name, category, address, phone, website,
           hours_text, description, source_url, verified_date,
           aliases, street_address, postal_code, lat, lon,
           image_path, image_alt, name_aliases,
           image_attribution_text, image_attribution_url, image_needs_review, free_teaser,
           hours_structured, hours_needs_review,
           is_free, fee_note, accessibility_note, services, verification_method, hours_confidence
      FROM places
     WHERE town_id = ${TOWN_ID}
     ORDER BY category, name
  `) as Facility[];
}

/** Whether this town has AT LEAST ONE story with a real, non-empty
 *  venue_raw -- the actual input signal resolveVenueSlugForImage() matches
 *  facilities.name_aliases against (see lib/images.ts). Backs
 *  build-checks.ts's venue-matching-reachable assertion: a town can have
 *  perfectly good, real aliases seeded (see scripts/
 *  seed_facility_name_aliases.py) and the venue tier can STILL be
 *  structurally dead if no story ever carries the raw signal to match them
 *  against -- exactly Broomfield's situation, found 2026-08-28 (AgendaLink
 *  meetings carry a real room/address in their raw scrape data, but
 *  ai_pipeline/publish.py doesn't yet surface it into stories.venue_raw).
 *  An aliases-only check would have missed this and gone green. */
export async function hasAnyStoryWithVenueRaw(): Promise<boolean> {
  const rows = (await sql`
    SELECT 1 FROM stories
     WHERE town_id = ${TOWN_ID} AND venue_raw IS NOT NULL AND venue_raw != ''
     LIMIT 1
  `) as unknown[];
  return rows.length > 0;
}

/** Just enough fields to check image coverage for every content-track row
 *  this town has published -- see build-checks.ts's
 *  assertContentTrackImagesComplete() and lib/images.ts's
 *  findContentTrackRowsMissingImage() (the pure part of this check). */
export interface ContentTrackImageRow {
  slug: string;
  source_type: SourceType;
  image_path: string | null;
}

/** CONTENT_TRACK_TYPES minus media_recension: the TMDB/pool handoff made
 *  reviews the one content-track type that deliberately never gets an
 *  image_path (see lib/images.ts's CATEGORY_BY_SOURCE_TYPE comment on
 *  'media_recension') -- it resolves through the movie_review category
 *  pool instead, same as any category-tier source_type, so it must NOT be
 *  flagged by assertContentTrackImagesComplete() as a missing-image row. */
const CONTENT_TRACK_TYPES_REQUIRING_IMAGE: SourceType[] =
  CONTENT_TRACK_TYPES.filter((t) => t !== 'media_recension');

export async function getContentTrackImageStatus(): Promise<ContentTrackImageRow[]> {
  return (await sql`
    SELECT slug, source_type, image_path
      FROM stories
     WHERE town_id = ${TOWN_ID} AND source_type = ANY(${CONTENT_TRACK_TYPES_REQUIRING_IMAGE})
  `) as ContentTrackImageRow[];
}

/** En anläggning via dess slug, för /facilities/[slug].astro. Slug är bara
 *  unikt inom en ort (UNIQUE(town_id, slug)), samma mönster som Story-slugs. */
export async function getFacilityBySlug(slug: string): Promise<Facility | null> {
  const rows = (await sql`
    SELECT id, slug, name, category, address, phone, website,
           hours_text, description, source_url, verified_date,
           aliases, street_address, postal_code, lat, lon,
           image_path, image_alt, name_aliases,
           image_attribution_text, image_attribution_url, image_needs_review, free_teaser,
           hours_structured, hours_needs_review,
           is_free, fee_note, accessibility_note, services, verification_method, hours_confidence
      FROM places
     WHERE town_id = ${TOWN_ID} AND slug = ${slug}
     LIMIT 1
  `) as Facility[];
  return rows[0] ?? null;
}

export interface PlaceHoursRow {
  // 0=Sunday..6=Saturday -- see scripts/seed_broomfield_places_batch1.py's
  // own comment for why (JS Date.getDay() convention, no prior precedent
  // in this codebase's day-numbering to follow instead).
  day_of_week: number;
  // Both null together is a real, sourced "closed that day" fact (migration
  // 045's own comment) -- distinct from no row at all for that weekday,
  // which means unknown/never asked. Widened from non-null `string` to
  // match (facilities/[slug].astro's hours_structured backfill, 2026-10-03,
  // is the first real data to ever populate this case -- place-hours.ts's
  // windowsForDate()/buildPlaceOpeningHoursSpecification() needed the same
  // null-guard place_hours_exceptions already had, see those functions'
  // own updated comments).
  opens: string | null;
  closes: string | null;
  valid_from: string | null;
  valid_to: string | null;
}

/** Every place_hours row for EVERY place in this town, in one query -- for
 *  /places/index.astro (handoff 5.3), which needs "today's status" for
 *  every place at once. Grouping by place_id is the caller's job (a plain
 *  Map build, not worth a second DB round trip); avoids an N+1 query
 *  pattern across what could be 40-60 places once seeding finishes. */
export async function getAllPlaceHoursForTown(): Promise<(PlaceHoursRow & { place_id: number })[]> {
  return (await sql`
    SELECT ph.place_id, ph.day_of_week, ph.opens, ph.closes, ph.valid_from, ph.valid_to
      FROM place_hours ph
      JOIN places p ON p.id = ph.place_id
     WHERE p.town_id = ${TOWN_ID}
  `) as (PlaceHoursRow & { place_id: number })[];
}

export async function getPlaceHours(placeId: number): Promise<PlaceHoursRow[]> {
  return (await sql`
    SELECT day_of_week, opens, closes, valid_from, valid_to
      FROM place_hours
     WHERE place_id = ${placeId}
     ORDER BY day_of_week
  `) as PlaceHoursRow[];
}

export interface PlaceHoursException {
  date: string;
  opens: string | null;
  closes: string | null;
  reason: string | null;
  source_url: string | null;
  last_verified_at: string | null;
}

/** Only exceptions in the next 60 days -- see the place page's own
 *  "Upcoming exceptions" section (handoff 5.1). A past exception has no
 *  reader value on a reference page (it's not a news archive), and Section
 *  8's own guardrail treats a past exception STILL being rendered as a
 *  build failure -- this query is what keeps that from ever happening,
 *  not a separate check bolted on after the fact. */
export async function getUpcomingPlaceHoursExceptions(placeId: number): Promise<PlaceHoursException[]> {
  return (await sql`
    SELECT date, opens, closes, reason, source_url, last_verified_at
      FROM place_hours_exceptions
     WHERE place_id = ${placeId}
       AND date >= CURRENT_DATE AND date <= CURRENT_DATE + INTERVAL '60 days'
     ORDER BY date
  `) as PlaceHoursException[];
}

export interface PlaceGuardrailRow {
  slug: string;
  source_url: string | null;
  verified_date: string | null;
  hours_confidence: string | null;
  place_hours_count: number;
}

/** Backs build-checks.ts's Section-8 place-layer guardrails (handoff
 *  "Guardrails / build-fails-loud"). One row per place for this town, with
 *  the place_hours row COUNT already joined in -- so "structured but zero
 *  hours rows" is a single, cheap comparison in the caller, not an N+1
 *  query per place. */
export async function getPlaceGuardrailData(): Promise<PlaceGuardrailRow[]> {
  return (await sql`
    SELECT p.slug, p.source_url, p.verified_date, p.hours_confidence,
           COUNT(ph.id)::int AS place_hours_count
      FROM places p
      LEFT JOIN place_hours ph ON ph.place_id = p.id
     WHERE p.town_id = ${TOWN_ID}
     GROUP BY p.slug, p.source_url, p.verified_date, p.hours_confidence
  `) as PlaceGuardrailRow[];
}

/** Läsbar rubrik per category-värde, för gruppering på /facilities. */
// Expanded 2026-08-22 (scripts/ingest_moval_facilities.py) from the
// original 5 to cover the City of Moreno Valley's real civic footprint --
// see db/migrations/007_facilities.sql and NEEDS-HUMAN-REVIEW.md, "3.1
// Facilities sourcing".
export const FACILITY_CATEGORY_LABELS: Record<string, string> = {
  library: 'Libraries',
  park: 'Parks',
  city_hall: 'City hall',
  community_center: 'Community centers',
  police: 'Public safety',
  // A separate label from police's "Public safety" -- both feeding the
  // SAME label string would render as two identical, duplicate section
  // headings on facilities/index.astro (grouped by raw category, not by
  // label), which reads as a bug, not a merged section.
  fire_station: 'Fire stations',
  animal_shelter: 'Animal shelter',
  post_office: 'Post offices',
  recycling: 'Recycling',
  medical: 'Medical',
  school_district: 'School district offices',
  // Broomfield place-layer handoff, Step 3: the first real place seeded
  // under this category (US 36 & Broomfield Station Park-n-Ride).
  transit: 'Transit',
  // Step 5: the Depot Museum and Veterans Museum -- genuinely distinct
  // from every other category (not a park, not a generic civic office),
  // and real enough (two seeded rows, both real destinations people
  // search hours for) to earn their own label rather than falling into
  // "Other" alongside unrelated landmarks.
  museum: 'Museums',
  other: 'Other',
};

// schema.org @type per facility category, for JSON-LD on the facility's own
// page (site/src/pages/facilities/[slug].astro). Deliberately conservative
// -- CivicStructure is schema.org's real fallback for a civic building
// whose more specific type isn't a clean fit, not a guess.
export const FACILITY_SCHEMA_TYPE: Record<string, string> = {
  library: 'Library',
  park: 'Park',
  city_hall: 'CityHall',
  community_center: 'CivicStructure',
  police: 'PoliceStation',
  fire_station: 'FireStation',
  animal_shelter: 'CivicStructure',
  post_office: 'PostOffice',
  // schema.org has no dedicated recycling-center type -- CivicStructure is
  // this file's own established conservative fallback for exactly that
  // case (see "medical"/"other" using it too), not a guess.
  recycling: 'CivicStructure',
  medical: 'Hospital',
  school_district: 'GovernmentOffice',
  // Broomfield place-layer handoff, Step 3: BusStation is a real,
  // dedicated schema.org type (not a CivicStructure fallback) -- the one
  // seeded transit place today (US 36 & Broomfield Station) is a bus
  // park-n-ride, not rail.
  transit: 'BusStation',
  // Step 5: also a real, dedicated schema.org type, not a fallback.
  museum: 'Museum',
  other: 'CivicStructure',
};

/**
 * Worker Pulse / Workplace Watch (site/src/pages/workplace-watch) -- Moreno
 * Valley-specifikt, se db/migrations/016_workplace_watch.sql. `employers` är
 * HANDKURERAD FAKTA (som facilities ovan, se scripts/seed_employers.py);
 * `employer_ratings` skrivs månadsvis av ai_pipeline/workplace_watch_digest.py
 * via sök-och-sammanfatta (Glassdoor/Indeed skrapas aldrig direkt).
 *
 * overall_rating är `number | null` -- null betyder "ingen siffra hittades i
 * sökträffarna den månaden", renderas som "rating pending", ALDRIG en
 * uppskattning. Samma "hellre ingen uppgift än en påhittad"-princip som
 * facilities.verified_date.
 */
export interface Employer {
  slug: string;
  name: string;
  facility_type: string;
  glassdoor_url: string | null;
  indeed_url: string | null;
  accent_color: string | null;
}

export interface EmployerRating extends Employer {
  /** "YYYY-MM", eller null om arbetsgivaren ännu inte fått en digest. Hämtas
   *  som text direkt från Postgres (to_char) -- se getLatestEmployerRatings
   *  för varför, ALDRIG via new Date(period) i frontend-koden. */
  period_ym: string | null;
  /** Läsbar "August 2026"-etikett, samma anledning som period_ym. */
  period_label: string | null;
  overall_rating: number | null;
  rating_source_note: string | null;
  theme_summary: string | null;
  rating_delta_vs_last_month: number | null;
  /** Slug för digestens /s/<digest_slug>-permalink (workplace_watch_digest.py:s
   *  slug-format), eller null om arbetsgivaren ännu inte fått en digest. */
  digest_slug: string | null;
}

export async function getEmployers(): Promise<Employer[]> {
  return (await sql`
    SELECT slug, name, facility_type, glassdoor_url, indeed_url, accent_color
      FROM employers
     WHERE town_id = ${TOWN_ID}
     ORDER BY name
  `) as Employer[];
}

/** Varje spårad arbetsgivare + dess SENASTE månads betyg/tema (LEFT JOIN
 *  LATERAL, så en nytillagd arbetsgivare utan digest än fortfarande syns,
 *  med overall_rating=null, i stället för att falla bort helt). Driver både
 *  /workplace-watch:s jämförelsetabell och startsido-widgeten.
 *
 *  period formateras till text MED to_char() I SQL, inte i JS: period är en
 *  ren kalenderdag (DATE, ingen klockslagsbetydelse), men neons drivrutin
 *  ger tillbaka DATE-kolumner som JS Date-objekt ankrade i den körande
 *  processens LOKALA tidszon -- new Date(period)/.toISOString() i frontend
 *  skiftar då kalendermånaden fel så fort byggmaskinens lokala tidszon inte
 *  är UTC (upptäckt live 2026-08: "2026-08-01" blev "July 2026" på en
 *  icke-UTC dev-maskin). to_char() i Postgres kringgår hela problemet --
 *  samma klass av bugg som _fmt()-kommentaren i sdsu_weekly_digest.py. */
export async function getLatestEmployerRatings(): Promise<EmployerRating[]> {
  const rows = (await sql`
    SELECT e.slug, e.name, e.facility_type, e.glassdoor_url, e.indeed_url, e.accent_color,
           to_char(r.period, 'YYYY-MM') AS period_ym,
           to_char(r.period, 'FMMonth YYYY') AS period_label,
           r.overall_rating, r.rating_source_note, r.theme_summary,
           r.rating_delta_vs_last_month
      FROM employers e
      LEFT JOIN LATERAL (
        SELECT * FROM employer_ratings er
         WHERE er.employer_id = e.id AND er.town_id = e.town_id
         ORDER BY er.period DESC
         LIMIT 1
      ) r ON true
     WHERE e.town_id = ${TOWN_ID}
     ORDER BY r.overall_rating DESC NULLS LAST, e.name
  `) as Record<string, any>[];

  return rows.map((row) => ({
    slug: row.slug,
    name: row.name,
    facility_type: row.facility_type,
    glassdoor_url: row.glassdoor_url,
    indeed_url: row.indeed_url,
    accent_color: row.accent_color,
    period_ym: row.period_ym,
    period_label: row.period_label,
    overall_rating: row.overall_rating === null ? null : Number(row.overall_rating),
    rating_source_note: row.rating_source_note,
    theme_summary: row.theme_summary,
    rating_delta_vs_last_month:
      row.rating_delta_vs_last_month === null ? null : Number(row.rating_delta_vs_last_month),
    digest_slug: row.period_ym
      ? `workplace-watch-${row.slug}-${row.period_ym}`
      : null,
  }));
}

/**
 * Fas 4a (Recurring-traffic layer, hiring layer) -- Adzuna job-posting
 * counts per tracked employer, see db/migrations/039_employer_job_stats.sql
 * and ai_pipeline/workplace_watch_digest.py (count_matching_postings()).
 * `postings_now`/`postings_change` are DERIVED IN SQL via a LAG() window
 * function over employer_job_stats, never computed in JS -- same "dates/
 * deltas belong in Postgres, not the frontend" convention as
 * getLatestEmployerRatings' own to_char() usage just below.
 *
 * postings_change is `null` for an employer's first tracked month (no prior
 * period to compare, not a real zero) -- same "New" vs "flat" distinction
 * getLatestEmployerRatings' rating_delta_vs_last_month already makes, so the
 * two features render consistently.
 */
export interface EmployerJobStats {
  slug: string;
  name: string;
  /** "YYYY-MM", or null if this employer has no posting-count snapshot yet
   *  (the monthly digest hasn't run since the hiring layer shipped). */
  period_ym: string | null;
  period_label: string | null;
  postings_now: number | null;
  postings_change: number | null;
}

export async function getEmployerJobStats(): Promise<EmployerJobStats[]> {
  const rows = (await sql`
    WITH ranked AS (
      SELECT employer_id, period, posting_count,
             LAG(posting_count) OVER (PARTITION BY employer_id ORDER BY period) AS prev_count
        FROM employer_job_stats
       WHERE town_id = ${TOWN_ID}
    )
    SELECT e.slug, e.name,
           to_char(r.period, 'YYYY-MM') AS period_ym,
           to_char(r.period, 'FMMonth YYYY') AS period_label,
           r.posting_count,
           CASE WHEN r.prev_count IS NULL THEN NULL ELSE r.posting_count - r.prev_count END AS postings_change
      FROM employers e
      LEFT JOIN LATERAL (
        SELECT * FROM ranked WHERE ranked.employer_id = e.id
         ORDER BY period DESC LIMIT 1
      ) r ON true
     WHERE e.town_id = ${TOWN_ID}
     ORDER BY e.name
  `) as Record<string, any>[];

  return rows.map((row) => ({
    slug: row.slug,
    name: row.name,
    period_ym: row.period_ym,
    period_label: row.period_label,
    postings_now: row.posting_count === null ? null : Number(row.posting_count),
    postings_change: row.postings_change === null ? null : Number(row.postings_change),
  }));
}

/**
 * Vail Resorts corporate newsroom feed -- Broomfield only (/vail-resorts,
 * VailNewsWidget.astro). See db/migrations/029_vail_news.sql and
 * scrapers/parsers/vail_news_v1.py -- a mirrored feed of the company's own
 * newsroom, NOT hyperlocal Broomfield reporting (Vail Resorts is
 * Broomfield's HQ employer-brand, hence the section existing at all).
 *
 * published_label formatted via to_char() IN THE QUERY, not new Date() in
 * frontend code -- published_at is a plain calendar DATE, and neon's driver
 * anchors DATE columns to the BUILD MACHINE's local timezone, which has
 * already produced wrong month/day labels elsewhere on this site (see
 * getLatestEmployerRatings' comment just above for the exact bug).
 *
 * is_translation=false is filtered here, in SQL, not in the .astro page --
 * so every caller (the page itself, the front-page widget) gets the same
 * "never show a detected Spanish duplicate" guarantee for free, with no
 * risk of one caller forgetting the filter.
 */
export interface VailNewsItem {
  external_url: string;
  title: string;
  published_label: string;
  categories: string[];
  teaser: string | null;
  image_url: string | null;
}

export async function getVailNews(limit = 30): Promise<VailNewsItem[]> {
  return (await sql`
    SELECT external_url, title, categories, teaser, image_url,
           to_char(published_at, 'FMMonth DD, YYYY') AS published_label
      FROM vail_news
     WHERE town_id = ${TOWN_ID} AND is_translation = false
     ORDER BY published_at DESC
     LIMIT ${limit}
  `) as VailNewsItem[];
}

export async function getLatestVailNewsItem(): Promise<VailNewsItem | null> {
  const rows = await getVailNews(1);
  return rows[0] ?? null;
}

/**
 * Skiftundersökning ("hur var skiftet idag?") -- fast fråga, fyra fasta
 * alternativ, ingen fritext (se db/migrations/017_shift_poll.sql och
 * site/functions/api/shift-poll-vote.ts, som är den enda platsen som
 * SKRIVER röster -- denna funktion läser bara dagens läge vid build-tid,
 * samma som allt annat på sajten). Röstningswidgeten uppdaterar sig sedan
 * LIVE i klienten från Function-anropets svar utan att sidan byggs om.
 */
export const SHIFT_POLL_OPTIONS = ['Calm', 'Okay', 'Tough', 'Really tough'] as const;

export interface ShiftPollResult {
  option: string;
  count: number;
}

export async function getShiftPollResults(): Promise<ShiftPollResult[]> {
  const rows = (await sql`
    SELECT option, count(*)::int AS count
      FROM shift_poll_votes
     WHERE town_id = ${TOWN_ID}
       AND poll_date = (now() AT TIME ZONE 'America/Los_Angeles')::date
     GROUP BY option
  `) as ShiftPollResult[];

  return SHIFT_POLL_OPTIONS.map((option) => ({
    option,
    count: rows.find((r) => r.option === option)?.count ?? 0,
  }));
}

/**
 * AI-modererade kommentarer på Worker Pulse-sidor (se db/migrations/
 * 018_worker_pulse_comments.sql och site/functions/api/comment.ts, som
 * modererar och SKRIVER -- denna funktion läser bara redan publicerade
 * rader vid build-tid). page_slug är antingen 'workplace-watch' (jämförelse-
 * sidan) eller en enskild digest-storys egen slug.
 */
export interface WorkerPulseComment {
  id: number;
  body: string;
  created_at: string;
}

export async function getWorkerPulseComments(pageSlug: string): Promise<WorkerPulseComment[]> {
  return (await sql`
    SELECT id, body, created_at
      FROM worker_pulse_comments
     WHERE town_id = ${TOWN_ID} AND page_slug = ${pageSlug} AND status = 'published'
     ORDER BY created_at ASC
  `) as WorkerPulseComment[];
}

/* ------------------------------------------------------------ skyltremsan -- */

export interface SignData {
  temp: number | null;
  unit: string;
  /** 2026-10-02, item E2: whether `temp` is a forecast HIGH (daytime
   *  period) or LOW (nighttime period) -- getWeather() is NWS forecast
   *  period data, never a live current reading, see getWeather()'s own
   *  callers for the full "no live-conditions feed exists" context. The
   *  sign strip renders this distinction rather than showing a bare number
   *  that reads as a current temperature it isn't. */
  isDaytime: boolean;
  conditions: string | null;
  alert: string | null;
  nextGame: Game | null;
  eventsToday: number;
}

/** Datan till skyltremsan högst upp. En fråga per fält, körs vid build. */
export async function getSignData(): Promise<SignData> {
  const [periods, alerts, games, todayRows] = await Promise.all([
    getWeather(),
    getActiveAlerts(),
    getUpcomingGames(1),
    sql`
      SELECT count(*)::int AS n
        FROM stories
       WHERE town_id = ${TOWN_ID}
         AND source_type = 'event'
         AND occurs_at::date = (now() AT TIME ZONE ${siteConfig.timezone})::date
    ` as unknown as Promise<{ n: number }[]>,
  ]);

  const current = periods.find((p) => p.is_daytime) ?? periods[0] ?? null;

  return {
    temp: current?.temp ?? null,
    unit: current?.unit ?? 'F',
    isDaytime: current?.is_daytime ?? true,
    conditions: current?.short ?? null,
    alert: alerts[0]?.title ?? null,
    nextGame: games[0] ?? null,
    eventsToday: todayRows[0]?.n ?? 0,
  };
}

/* ------------------------------------------------------------- formatering - */

// FAS 2-FIX (augusti 2026): var hårdkodat till 'America/Chicago' för BÅDA
// orterna -- varje tidsstämpel på Moreno Valley-sajten (events, traffic,
// möten) visades i fel tidszon, ~2 timmar fel jämfört med korrekt
// America/Los_Angeles. siteConfig.timezone är redan korrekt per ort
// (site-config.ts), bara aldrig använt här. formatCalendarDate() nedan är
// MEDVETET annorlunda (ingen tidszon alls) -- rör den inte, se dess egen
// kommentar för varför.
const TZ = siteConfig.timezone;

export function formatDate(value: string | null): string {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-US', {
    weekday: 'short', month: 'long', day: 'numeric', timeZone: TZ,
  });
}

export function formatTime(value: string | null): string {
  if (!value) return '';
  return new Date(value).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: TZ,
  });
}

export function formatDateTime(value: string | null): string {
  if (!value) return '';
  return `${formatDate(value)} at ${formatTime(value)}`;
}

/** Husförsäljningspris -- "$350,000", inga decimaler (öre är aldrig relevant här). */
export function formatPrice(value: number | null): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(value);
}

/**
 * meeting_date lagras som ett rent kalenderdatum (midnatt UTC) -- Legistar och
 * CivicEngage ger bara ETT datum, ingen tillförlitlig klockslag (Legistars
 * EventTime hämtas inte än). Körs ett sådant värde genom formatDate/formatTime
 * (som applicerar America/Chicago, UTC-5) skiftas det bakåt en dag: midnatt UTC
 * blir 19:00 föregående dag lokalt. Möten formateras därför direkt ur UTC-
 * komponenterna, ingen tidszon, inget klockslag som inte finns.
 *
 * Events och alerts har riktiga tidsstämplar och ska ALDRIG gå genom denna --
 * de använder formatDate/formatTime/formatDateTime som vanligt.
 */
export function formatCalendarDate(value: string | Date | null): string {
  if (!value) return '';
  // Drivern ger ibland en riktig sträng ("2026-08-03"), ibland redan ett
  // Date-objekt konstruerat med new Date(y, m, d) -- LOKAL tidszon, inte UTC.
  // new Date(value) + timeZone:'UTC' antar att value REPRESENTERAR UTC-midnatt,
  // vilket bara stämmer för strängfallet. Ett redan-konstruerat lokalt Date
  // tolkat om som UTC skiftar bakåt en dag så fort byggmaskinens lokala
  // tidszon ligger före UTC (upptäckt när verified_date visade "Sun, August 2"
  // för ett sparat 2026-08-03 på en UTC+2-maskin -- GitHub Actions kör i UTC
  // så det syns aldrig i produktion, men är samma latenta bugg som
  // meeting_date/sale_date riskerade). Läs därför ut år/månad/dag EXPLICIT ur
  // vad vi fick (sträng-split eller lokala Date-komponenter), och bygg om till
  // UTC-midnatt själva -- oberoende av byggmaskinens egen tidszon.
  const { y, m, d } = calendarDateParts(value)!;
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'long', day: 'numeric', timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m, d)));
}

/** "Sunday, September 13, 2026" -- the place-layer handoff's own explicit
 *  "explicit dates written out" rule (5.1), for the /place/[slug] answer-
 *  first paragraph and exceptions list specifically. A real, full weekday
 *  name and year, unlike formatCalendarDate()'s abbreviated "Sun, September
 *  13" (which every EXISTING caller -- facility verified_date, etc. --
 *  already depends on unchanged). Same UTC-midnight-safe date-parts
 *  extraction as formatCalendarDate(), not a separate, second-guessed
 *  implementation of that same fix. */
export function formatFullCalendarDate(value: string | Date | null): string {
  if (!value) return '';
  const { y, m, d } = calendarDateParts(value)!;
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m, d)));
}

/** "July 2026" -- for a value that represents a whole MONTH (e.g. ag_prices'
 *  as_of, always stored as the 1st of the reporting month), not a specific
 *  day. Same calendarDateParts()-based UTC-safe extraction as
 *  formatCalendarDate() above, just a different display format -- see that
 *  function's comment for why the day/month/year must be read out
 *  explicitly rather than trusted from a re-parsed Date. */
export function formatMonthYear(value: string | Date | null): string {
  if (!value) return '';
  const { y, m, d } = calendarDateParts(value)!;
  return new Intl.DateTimeFormat('en-US', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m, d)));
}

/** Delad extraktionslogik bakom formatCalendarDate -- se dess kommentar för
 *  varför sträng/Date måste hanteras olika. Egen export så andra sidor (t.ex.
 *  events.astro:s "matchar dagens datum mot en spelad hemmamatch") kan jämföra
 *  ett kalenderdatum mot "idag" utan att själva återuppfinna samma landmina. */
export function calendarDateParts(value: string | Date | null): { y: number; m: number; d: number } | null {
  if (!value) return null;
  if (value instanceof Date) {
    return { y: value.getFullYear(), m: value.getMonth(), d: value.getDate() };
  }
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  return { y, m: m - 1, d };
}

/** Meeting-date display, aware of siteConfig.meetingsHaveTime (see that
 *  flag's own comment on site-config.ts): Brookings/Legistar's meeting_date
 *  is a genuinely bare calendar date, so formatCalendarDate()'s no-tz-
 *  conversion UTC-read is correct and must stay unchanged there. Broomfield
 *  (AgendaLink) and Moreno Valley (eSCRIBE) meeting_date IS a real,
 *  tz-aware instant (as of their own 2026-09-30 scraper fixes) -- reading
 *  its raw UTC calendar date with NO conversion, the same way
 *  formatCalendarDate() does, lands on the WRONG local day for any evening
 *  meeting that crosses the UTC date boundary (confirmed live: id 11337's
 *  real Tue Oct 13 6pm Denver meeting stores as 2026-10-14T00:00:00Z, whose
 *  raw UTC date is Oct 14 -- a Wednesday). A real tz-aware day-read is
 *  needed for those two towns instead. Shared by formatOccursAt() below
 *  and every direct meeting-date display call site (StoryCard.astro,
 *  LeadStory.astro, SecondaryStory.astro, city-hall.astro). */
export function formatMeetingDate(value: string | Date | null): string {
  if (!siteConfig.meetingsHaveTime) return formatCalendarDate(value);
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-US', {
    weekday: 'short', month: 'long', day: 'numeric', timeZone: TZ,
  });
}

/** Rätt formatering av story.occurs_at givet KÄLLTYP -- enda stället den
 *  distinktionen behöver göras, så inget anropsställe kan glömma den. */
export function formatOccursAt(story: Pick<Story, 'source_type' | 'occurs_at'>): string {
  if (!story.occurs_at) return '';
  if (story.source_type === 'meeting' || story.source_type === 'meeting_followup') return formatMeetingDate(story.occurs_at);
  return formatDateTime(story.occurs_at);
}

/** "in 6 days" / "tomorrow" / "today" -- för skyltremsan.
 *
 *  Item B3 (fix): the original version divided raw elapsed milliseconds
 *  (`new Date(value).getTime() - Date.now()`) by 86,400,000 and
 *  Math.ceil()'d the result -- the exact same bug class formatMeetingDate()'s
 *  own comment above describes and this session has already fixed
 *  elsewhere (this-week.ts's module docstring has the full rundown): a
 *  raw-elapsed-time bucket is not the same question as "how many TOWN-LOCAL
 *  calendar days away is this." Concretely wrong case: at 00:30 local on
 *  game day itself, a 7pm local start is ~18.5 real hours away --
 *  Math.ceil(18.5 / 24) = 1, so the old code said "tomorrow" for a game
 *  happening LATER THAT SAME local day. Fixed by reusing time.ts's
 *  calendarDayDiff() -- the same town-timezone-aware whole-day arithmetic
 *  relativeTime() already relies on -- instead of a second, raw-elapsed-time
 *  implementation of "how many days away." `now`/`timeZone` are explicit
 *  parameters (not read from Date.now()/siteConfig internally) for the same
 *  testability reason relativeTime() takes them explicitly. */
export function countdown(value: string | null, now: Date, timeZone: string): string {
  if (!value) return '';
  const days = calendarDayDiff(new Date(value), now, timeZone);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

/* ---------------------------------------------------- event venue / JSON-LD */

// Venue resolution for Event JSON-LD reuses getFacilities()/Facility above
// (see db/migrations/020_event_venue_resolution.sql for the aliases/
// street_address/postal_code columns added for this) -- resolution happens
// fresh on every build against the live `facilities` table, so adding an
// alias re-resolves every previously-unmatched event on the next rebuild
// with no pipeline re-run. See ai_pipeline/venue_registry.py's module
// docstring for the full design.

/** Same algorithm as ai_pipeline.venue_registry.normalize_venue() -- kept as
 *  a small duplicated function rather than a cross-language shared module,
 *  same tradeoff this codebase already makes for OUTLIER_PRICE_FLOOR (see
 *  ai_pipeline/home_sales_digest.py + home-sales.astro). Scraped LOCATION
 *  strings are "Name,Street, City, ST ZIP, USA" -- only the name part
 *  (before the first comma) is ever what a curated alias would list. */
export function normalizeVenue(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null;
  const namePart = raw.split(',')[0].replace(/^[A-Z0-9 .'-]+:\s*/, '');
  const normalized = namePart.replace(/\s+/g, ' ').trim().toLowerCase();
  return normalized || null;
}

/** Build once per page render (or once per events-listing render) and reuse
 *  across many resolveVenue() calls -- avoids rebuilding the alias map per
 *  event. */
export function buildVenueIndex(facilities: Facility[]): Map<string, Facility> {
  const index = new Map<string, Facility>();
  for (const facility of facilities) {
    for (const candidate of [facility.name, ...(facility.aliases ?? [])]) {
      const norm = normalizeVenue(candidate);
      if (norm) index.set(norm, facility);
    }
  }
  return index;
}

export function resolveVenue(index: Map<string, Facility>, rawVenue: string | null | undefined): Facility | null {
  const norm = normalizeVenue(rawVenue);
  if (norm === null) return null;
  return index.get(norm) ?? null;
}

/** BOTH street_address and postal_code must be present for a resolved
 *  facility to count as rich-result-eligible -- a facility seeded without a
 *  verified structured address (see data/facilities/*.json) still resolves
 *  for display purposes elsewhere, but must never emit a Place claiming an
 *  address it doesn't actually have. */
export function hasResolvedAddress(facility: Facility | null): boolean {
  return Boolean(facility && facility.street_address && facility.postal_code);
}

const VIRTUAL_VENUE_KEYWORDS = [
  'virtual', 'online event', 'zoom', 'webinar', 'livestream', 'webex',
  'google meet', 'microsoft teams', 'teams meeting', 'via video',
];

/** Same keyword set as ai_pipeline.venue_registry.is_virtual() -- see that
 *  module for why this stays deliberately conservative (a false negative
 *  just falls through to normal venue resolution, never a wrong address). */
export function isVirtualVenue(...texts: (string | null | undefined)[]): boolean {
  const joined = texts.filter(Boolean).join(' ').toLowerCase();
  return VIRTUAL_VENUE_KEYWORDS.some((kw) => joined.includes(kw));
}

/**
 * Format a UTC ISO timestamp with an explicit local offset (e.g.
 * "2026-09-08T23:00:00-07:00") instead of "Z" -- Google's Event structured-
 * data guidance calls for an explicit offset on startDate/endDate. Postgres
 * TIMESTAMPTZ columns come back from Neon as UTC; both represent the same
 * instant, but an offset is what's actually asked for. Dependency-free
 * (no date library in this project) via Intl.DateTimeFormat, which has
 * IANA-zone support in both Node (build) and the Cloudflare Pages runtime.
 */
export function toZonedISOString(utcIso: string, timeZone: string): string {
  const date = new Date(utcIso);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZoneName: 'shortOffset',
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const offsetMatch = get('timeZoneName').match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  const offset = offsetMatch
    ? `${offsetMatch[1]}${offsetMatch[2].padStart(2, '0')}:${(offsetMatch[3] ?? '00').padStart(2, '0')}`
    : '+00:00';

  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}${offset}`;
}

/* ----------------------------------------------------- city hall projects */
// See db/migrations/023_city_hall_projects.sql and NEEDS-HUMAN-REVIEW.md,
// "Week 3 -- City Hall Project Pages". Projects are a hand-curated
// registry (data/projects/<town_id>.json, see scripts/seed_projects.py),
// threaded with real meeting outcomes by ai_pipeline/project_updates.py --
// this file only reads what that pipeline already verified, it never
// derives a status or outcome itself.

export interface Project {
  slug: string;
  title: string;
  description: string;
  status: string;
  location_text: string | null;
  lat: number | null;
  lon: number | null;
  home_sales_zip: string | null;
  updated_at: string;
  // Story Threads extension (db/migrations/032_project_threads.sql) -- see
  // projectActivityState() below for how these two combine into a display
  // state. rolling_summary is regenerated by ai_pipeline/project_threads.py
  // each time a new entry lands; null until a project has at least one.
  rolling_summary: string | null;
  resolved_at: string | null;
  // Story Threads Phase 2 cross-linking (db/migrations/040_project_
  // workplace_watch_link.sql) -- hand-curated, same pattern as
  // home_sales_zip above (never auto-matched by title text). slug is the
  // raw employers.slug value; name is resolved via a JOIN at read time
  // (see getProjects()/getProjectBySlug()) so the page can show a real
  // label ("Ball Corporation"), not a bare slug. Both null together means
  // "not curated / doesn't apply" -- same honest-empty convention as
  // home_sales_zip.
  workplace_watch_employer_slug: string | null;
  workplace_watch_employer_name: string | null;
}

export interface ProjectUpdate {
  source_type: string;
  entry_date: string;
  body: string | null;
  meeting_date: string | null;
  agenda_counter: string | null;
  agenda_title: string | null;
  agenda_url: string | null;
  outcome: string;
  vote_yes: number | null;
  vote_no: number | null;
  vote_abstain: number | null;
  vote_absent: number | null;
  source_url: string | null;
  // The short, source-grounded "what changed" line (Story Threads) --
  // null for older meeting-sourced rows that predate it and were never
  // backfilled. Callers should fall back to agenda_title when absent.
  synthesis: string | null;
}

// Mirrors ai_pipeline/project_threads.py's STALLED_AFTER_DAYS /
// thread_activity_state() exactly -- same duplicate-across-layers tradeoff
// this codebase already makes for OUTLIER_PRICE_FLOOR / normalize_venue().
export const STALLED_AFTER_DAYS = 90;

export function projectActivityState(project: Pick<Project, 'updated_at' | 'resolved_at'>): 'active' | 'stalled' | 'resolved' {
  if (project.resolved_at) return 'resolved';
  const daysSinceUpdate = (Date.now() - new Date(project.updated_at).getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceUpdate >= STALLED_AFTER_DAYS ? 'stalled' : 'active';
}

/** 'pending' isn't a real project status (it's an update-level outcome) --
 *  every project row itself is always one of these five, recomputed by
 *  ai_pipeline/project_updates.py from its most recent update's outcome. */
export const PROJECT_STATUS_LABELS: Record<string, string> = {
  under_review: 'Under review',
  approved: 'Approved',
  permitted: 'Permitted',
  under_construction: 'Under construction',
  complete: 'Complete',
  denied: 'Denied',
};

export async function getProjects(): Promise<Project[]> {
  return (await sql`
    SELECT p.slug, p.title, p.description, p.status, p.location_text, p.lat, p.lon,
           p.home_sales_zip, p.updated_at, p.rolling_summary, p.resolved_at,
           p.workplace_watch_employer_slug, e.name AS workplace_watch_employer_name
      FROM projects p
      LEFT JOIN employers e
        ON e.town_id = p.town_id AND e.slug = p.workplace_watch_employer_slug
     WHERE p.town_id = ${TOWN_ID}
     ORDER BY p.updated_at DESC
  `) as Project[];
}

export async function getProjectBySlug(slug: string): Promise<Project | null> {
  const rows = (await sql`
    SELECT p.slug, p.title, p.description, p.status, p.location_text, p.lat, p.lon,
           p.home_sales_zip, p.updated_at, p.rolling_summary, p.resolved_at,
           p.workplace_watch_employer_slug, e.name AS workplace_watch_employer_name
      FROM projects p
      LEFT JOIN employers e
        ON e.town_id = p.town_id AND e.slug = p.workplace_watch_employer_slug
     WHERE p.town_id = ${TOWN_ID} AND p.slug = ${slug}
     LIMIT 1
  `) as Project[];
  return rows[0] ?? null;
}

/** A project's full sourced timeline, oldest first -- the accumulating
 *  history a project page renders. Ordered by entry_date, not meeting_date
 *  -- a traffic-sourced row (Story Threads extension) has no meeting_date
 *  at all, see db/migrations/032_project_threads.sql. */
export async function getProjectUpdates(slug: string): Promise<ProjectUpdate[]> {
  return (await sql`
    SELECT u.source_type, u.entry_date, u.body, u.meeting_date, u.agenda_counter,
           u.agenda_title, u.agenda_url, u.outcome, u.vote_yes, u.vote_no,
           u.vote_abstain, u.vote_absent, u.source_url, u.synthesis
      FROM project_updates u
      JOIN projects p ON p.id = u.project_id
     WHERE p.town_id = ${TOWN_ID} AND p.slug = ${slug}
     ORDER BY u.entry_date ASC
  `) as ProjectUpdate[];
}

/** Recent milestones across every project, newest first -- for the
 *  homepage teaser (see index.astro). A "milestone" here is just any
 *  update within the window, pending or confirmed alike; the homepage
 *  itself decides how to word each state, this just supplies real rows. */
export async function getRecentProjectUpdates(limit = 3): Promise<(ProjectUpdate & { project_slug: string; project_title: string })[]> {
  return (await sql`
    SELECT u.source_type, u.entry_date, u.body, u.meeting_date, u.agenda_counter, u.agenda_title,
           u.agenda_url, u.outcome, u.vote_yes, u.vote_no, u.vote_abstain,
           u.vote_absent, u.source_url, u.synthesis, p.slug AS project_slug, p.title AS project_title
      FROM project_updates u
      JOIN projects p ON p.id = u.project_id
     WHERE p.town_id = ${TOWN_ID}
       AND u.meeting_date >= now() - interval '14 days'
     ORDER BY u.meeting_date DESC
     LIMIT ${limit}
  `) as (ProjectUpdate & { project_slug: string; project_title: string })[];
}

/** Every project update, oldest first, no date window -- unlike
 *  getRecentProjectUpdates() above (14 days, DESC, capped), this is for
 *  /this-week/[week].astro's day-by-day view, which needs to reach
 *  arbitrarily far back into the archive (see lib/this-week.ts). Same
 *  "fetch broad once, filter in TS" pattern as getSeasonGames/
 *  getRegionalSports -- the table is small enough (one row per real,
 *  hand-curated project's real meeting outcomes) that a second per-week
 *  query per project would be pure overhead for no accuracy gain. */
export async function getAllProjectUpdatesForWeekly(): Promise<(ProjectUpdate & { project_slug: string; project_title: string })[]> {
  return (await sql`
    SELECT u.source_type, u.entry_date, u.body, u.meeting_date, u.agenda_counter, u.agenda_title,
           u.agenda_url, u.outcome, u.vote_yes, u.vote_no, u.vote_abstain,
           u.vote_absent, u.source_url, u.synthesis, p.slug AS project_slug, p.title AS project_title
      FROM project_updates u
      JOIN projects p ON p.id = u.project_id
     WHERE p.town_id = ${TOWN_ID}
       AND u.meeting_date IS NOT NULL
     ORDER BY u.meeting_date ASC
  `) as (ProjectUpdate & { project_slug: string; project_title: string })[];
}

/** CityStatus's `next_meeting` module (lib/cityStatus.ts) -- the soonest
 *  upcoming meeting of any body, town-wide. `body` is the meeting type
 *  ("City Council", "Planning Commission", ...).
 *
 *  Bug fixed 2026-09-30: this used to format a clock time in SQL via
 *  AT TIME ZONE + to_char, on the stated assumption that meeting_date
 *  always carries a genuine time-of-day. True for Moreno Valley (eSCRIBE)
 *  and Broomfield (AgendaLink) as of this fix, but NEVER true for
 *  Brookings: Legistar's EventDate has no time component (EventTime not
 *  fetched, see legistar_v1.py), so meeting_date there is a bare calendar
 *  date stored at UTC midnight. AT TIME ZONE 'America/Chicago' on a bare
 *  date shifts it to ~7 PM the PREVIOUS evening (confirmed live: a
 *  Thursday meeting rendered as "Wed 7:00 PM") -- exactly the "UTC
 *  midnight != local calendar day" bug formatCalendarDate() already
 *  guards against everywhere else on the site. `siteConfig.meetingsHaveTime`
 *  (site-config.ts) records which towns' source genuinely has a time, so
 *  this can show a real time where one exists instead of either
 *  fabricating one (the old bug) or hiding a real one everywhere (an
 *  earlier, too-broad fix attempt).
 *
 *  The 5-row window + in-JS filtering (rather than a single SQL WHERE
 *  clause) exists because "is this meeting still upcoming" needs a
 *  DIFFERENT comparison per town: a real instant (meetingsHaveTime) vs. a
 *  local calendar date read straight from meeting_date's own UTC
 *  components, never tz-converted (bare date) -- the same two rules
 *  formatMeetingWhen() below applies for display, kept in sync by sharing
 *  the same flag instead of duplicating the distinction in raw SQL.
 *
 *  Returns null when this town has no meeting scheduled in the future at
 *  all -- a real, honest state (see check_no_prediction-adjacent
 *  principle: no meeting found is not the same as "on recess", so the
 *  caller shows an omitted row, not a guessed one). */
export interface NextMeeting {
  body: string;
  meeting_date: string;
  agenda_url: string | null;
}

// A Legistar "Notice of Quorum" posting (SDCL 1-25-1.1) announces that
// enough members of a body MIGHT attend some unrelated public event (a
// ribbon-cutting, a parade, a BBQ) to technically constitute a quorum --
// explicitly "no official city business will be acted upon." Confirmed
// live 2026-10-01: 24 of Brookings' published meeting stories were
// actually one of these, not a real meeting -- e.g. the "Next meeting"
// hero showed "City Council, Thu, October 1" for what was really a solar
// farm ribbon-cutting. Mirrors ai_pipeline/publish.py's
// is_quorum_notice_only() exactly (same two-phrase requirement -- a real
// meeting's own agenda routinely includes a "determination of a quorum"
// step without being a notice-only posting, confirmed live that phrasing
// never co-occurs with "no official city business").
function isQuorumNoticeOnly(rawData: Record<string, unknown> | null): boolean {
  const agendaText = (rawData?.agenda_text as string) ?? '';
  return /notice of quorum/i.test(agendaText) && /no official city business/i.test(agendaText);
}

export async function getNextMeeting(): Promise<NextMeeting | null> {
  // `- interval '1 day'` buffer: a bare-date meeting_date is anchored to
  // UTC midnight, which is already several hours in the PAST in UTC while
  // its real local calendar date hasn't started yet in a negative-UTC-
  // offset town -- without this buffer a same-day Brookings meeting could
  // be excluded from this window hours before it actually happens locally.
  // LIMIT 10 (not 5): a notice-of-quorum row can occupy an early slot in
  // this window and gets filtered out below, so a slightly wider candidate
  // pool avoids running out of rows on a quorum-notice-heavy stretch.
  const rows = (await sql`
    SELECT body, meeting_date, agenda_url, raw_data
      FROM meetings
     WHERE town_id = ${TOWN_ID}
       AND body IS NOT NULL
       AND meeting_date >= now() - interval '1 day'
     ORDER BY meeting_date ASC
     LIMIT 10
  `) as (NextMeeting & { raw_data: Record<string, unknown> | null })[];

  const realMeetings = rows.filter((r) => !isQuorumNoticeOnly(r.raw_data));

  if (siteConfig.meetingsHaveTime) {
    const now = Date.now();
    return realMeetings.find((r) => new Date(r.meeting_date).getTime() >= now) ?? null;
  }
  const todayLocalYmd = new Intl.DateTimeFormat('en-CA', {
    timeZone: siteConfig.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  return realMeetings.find((r) => {
    // neon returns a timestamptz as a string in some code paths and an
    // already-parsed Date in others (see calendarDateParts()'s own comment
    // above) -- reuse that same helper rather than assuming .slice() works.
    const { y, m, d } = calendarDateParts(r.meeting_date)!;
    const ymd = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return ymd >= todayLocalYmd;
  }) ?? null;
}

/** Display string for a NextMeeting -- "Tue, Oct 14, 6:00 PM" when the
 *  town's source has a real time (siteConfig.meetingsHaveTime), else just
 *  the bare calendar date ("Wed, Oct 1") via formatCalendarDate. See
 *  getNextMeeting()'s own comment for why this can't be one formatter for
 *  every town. */
export function formatMeetingWhen(meeting: NextMeeting): string {
  if (!siteConfig.meetingsHaveTime) return formatCalendarDate(meeting.meeting_date);
  const date = new Date(meeting.meeting_date);
  const weekday = date.toLocaleDateString('en-US', { weekday: 'short', timeZone: TZ });
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
  return `${weekday}, ${time}`;
}

/** Broomfield's AgendaLink `agendaUrl` (copied verbatim into meetings.agenda_url
 *  and, at publish time, into stories.source_url -- see publish.py's
 *  build_source_url()) comes back from the vendor's own API pointing at
 *  sandbox.agendalink.app, not a horizon.agendalink.app/production host --
 *  confirmed 2026-08-27 this is the API's OWN returned field, not something
 *  this codebase guesses or constructs. Whether that host is genuinely
 *  Broomfield's real public portal (oddly named) or a non-production
 *  environment couldn't be confirmed live (2026-09-30: the page is a
 *  JS-rendered SPA a text fetch can't evaluate) -- horizon.agendalink.app
 *  looks like the real production host (same meeting IDs are Google-indexed
 *  there), but that's one coincidental match, not a verified rewrite rule,
 *  so this doesn't guess at a replacement URL. Given the uncertainty, no
 *  outbound link on this site should point at sandbox.* -- see every call
 *  site of this function for the fallback used instead. */
export function isSandboxUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname.startsWith('sandbox.');
  } catch {
    return false;
  }
}

/** Build-time safety net for isSandboxUrl() -- every render site that emits
 *  story.source_url (s/[slug].astro, article-jsonld.ts, city-hall/projects/
 *  [slug].astro) already gates on isSandboxUrl(), but this queries the raw
 *  DB directly so a FUTURE render site that forgets that gate still gets
 *  caught here instead of silently leaking a sandbox URL into published
 *  output. See build-checks.ts's runBuildTimeChecks(). */
export async function getSandboxSourceUrlSlugs(): Promise<string[]> {
  const rows = (await sql`
    SELECT slug FROM stories
     WHERE town_id = ${TOWN_ID} AND source_url LIKE 'https://sandbox.%'
  `) as { slug: string }[];
  return rows.map((r) => r.slug);
}

/** "Part of an ongoing story" banner support (Story Threads) -- a meeting
 *  STORY (s/[slug].astro) doesn't carry meetings.id as its own column, but
 *  the id is already the stable suffix of every meeting slug ("meeting-123"
 *  or the dated "meeting-2026-08-27-123") -- same established pattern this
 *  codebase already uses for alert stories (see getUpcomingAlerts()'s own
 *  `s.slug = 'alert-' || e.id` join). Returns null (not an error) whenever
 *  this meeting was never threaded onto a project -- the common case. */
export async function getProjectForMeetingId(meetingId: number): Promise<{ slug: string; title: string } | null> {
  const rows = (await sql`
    SELECT p.slug, p.title
      FROM project_updates u
      JOIN projects p ON p.id = u.project_id
     WHERE p.town_id = ${TOWN_ID} AND u.meeting_id = ${meetingId}
     LIMIT 1
  `) as { slug: string; title: string }[];
  return rows[0] ?? null;
}
