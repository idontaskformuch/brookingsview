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

const sql = neon(import.meta.env.DATABASE_URL);

// Härleds från siteConfig (SITE_CITY), inte en egen env-variabel -- en separat
// TOWN_ID att komma ihåg att sätta i synk med SITE_CITY är precis den sortens
// fallgrop som gör att en stads build visar en annan stads branding över en
// tredje stads data. Ett enda reglage (SITE_CITY) styr både identitet och data.
export const TOWN_ID = siteConfig.townId;

export type SourceType =
  | 'meeting' | 'event' | 'alert' | 'weekly'
  | 'culture_essay' | 'editorial' | 'vetenskap_kronika' | 'kvick_essa'
  | 'media_recension' | 'vardagsmiddag' | 'home_sales_digest' | 'sports_digest' | 'university_digest'
  | 'announcement' | 'workplace_watch_digest';

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
  university_digest: 'University digest',
  // Handskrivet, inte skrapat eller AI-genererat -- t.ex. sajtnyheter som
  // "vi lanserade ett arkadspel". byline sätts (se StoryCard.astro:s
  // hasByline-villkor) så den här kickern faktiskt används i stället för
  // att falla tillbaka på "Events".
  announcement: 'Announcement',
  workplace_watch_digest: 'Worker Pulse',
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

/** Vilken kategori-sida en Content Track-story hör hemma på när den arkiveras
 *  bort från förstasidan. culture_essay/vetenskap_kronika/kvick_essa delar
 *  /columns -- tre krönike-varianter i en sektion, inte tre tunna sidor.
 *  home_sales_digest/sports_digest pekar till sina respektive tabellsidor
 *  trots att de inte är i CONTENT_TRACK_TYPES ovan -- href-uppslaget är
 *  oberoende av rotationslistan. */
export const CATEGORY_HREFS: Partial<Record<SourceType, string>> = {
  culture_essay: '/columns',
  kvick_essa: '/columns',
  vetenskap_kronika: '/columns',
  editorial: '/editorials',
  media_recension: '/reviews',
  vardagsmiddag: '/recipes',
  home_sales_digest: '/home-sales',
  sports_digest: '/sports',
  university_digest: '/university',
  workplace_watch_digest: '/workplace-watch',
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
  rating: number | null;
  // Endast vardagsmiddag (recept) sätter detta -- strukturerad ingredienslista,
  // en rad per ingrediens. NULL för allt annat innehåll, se db/migrations/005.
  ingredients: string[] | null;
  // Endast vardagsmiddag, samma mönster som ingredients men för steg-för-steg-
  // instruktionerna. NULL för allt annat innehåll, se db/migrations/008.
  instructions: string[] | null;
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

export interface AgPrice {
  commodity: string;
  price: number | null;
  unit: string | null;
  as_of: string | null;
}

export interface PropertySale {
  address: string | null;
  sale_price: number | null;
  sale_date: string | null;
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
           byline, image_path, rating, ingredients, instructions
      FROM stories
     WHERE town_id = ${TOWN_ID}
       AND source_type = ANY(${sourceTypes})
       AND occurs_at >= now() - interval '12 hours'
     ORDER BY occurs_at ASC
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
           byline, image_path, rating, ingredients, instructions
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
 * sedan midnatt lokal tid (America/Chicago, samma som resten av sajten).
 *
 * Visas pushigt på förstasidan bara publiceringsdagen. Efter det hittas den
 * bara via sin kategori-sida (getContentByType) -- precis som andra
 * nyhetssajter kör "dagens ledare/recension" på ettan och arkiverar den till
 * en sektion när nästa dags innehåll tar över.
 */
export async function getTodaysFeature(): Promise<Story | null> {
  const rows = (await sql`
    SELECT id, title, slug, body, source_type, source_url, occurs_at, published_at, generated_by,
           byline, image_path, rating, ingredients, instructions
      FROM stories
     WHERE town_id = ${TOWN_ID}
       AND source_type = ANY(${CONTENT_TRACK_TYPES})
       AND published_at::date = (now() AT TIME ZONE 'America/Chicago')::date
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
           byline, image_path, rating, ingredients, instructions
      FROM stories
     WHERE town_id = ${TOWN_ID}
       AND source_type = ANY(${sourceTypes})
     ORDER BY published_at DESC
     LIMIT ${limit}
  `) as Story[];
}

export async function getStoryBySlug(slug: string): Promise<Story | null> {
  const rows = (await sql`
    SELECT id, title, slug, body, source_type, source_url, occurs_at, published_at, generated_by,
           byline, image_path, rating, ingredients, instructions
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
           byline, image_path, rating, ingredients, instructions
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
           byline, image_path, rating, ingredients, instructions
      FROM stories
     WHERE town_id = ${TOWN_ID}
       AND source_type = 'weekly'
       AND occurs_at >= now() - interval '8 days'
     ORDER BY occurs_at DESC
     LIMIT 1
  `) as Story[];
  return rows[0] ?? null;
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
           byline, image_path, rating, ingredients, instructions
      FROM stories
     WHERE town_id = ${TOWN_ID}
       AND slug <> ${story.slug}
       AND source_type = ${story.source_type}
       AND occurs_at IS NOT NULL
     ORDER BY abs(extract(epoch FROM (occurs_at - ${anchor}::timestamptz)))
     LIMIT ${limit}
  `) as Story[];

  if (sameType.length >= limit) return sameType;

  const seen = [story.slug, ...sameType.map((s) => s.slug)];
  const filler = (await sql`
    SELECT id, title, slug, body, source_type, source_url, occurs_at, published_at, generated_by,
           byline, image_path, rating, ingredients, instructions
      FROM stories
     WHERE town_id = ${TOWN_ID}
       AND slug <> ALL(${seen})
       AND occurs_at IS NOT NULL
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
export type RelatedPageType = 'traffic' | 'events' | 'university' | 'workplace_watch';

export interface RelatedItem {
  href: string;
  title: string;
  kicker: string;
  description?: string | null;
}

async function latestStoryByType(sourceType: SourceType): Promise<RelatedItem | null> {
  const rows = (await sql`
    SELECT title, slug, body, published_at
      FROM stories
     WHERE town_id = ${TOWN_ID} AND source_type = ${sourceType}
     ORDER BY published_at DESC
     LIMIT 1
  `) as { title: string; slug: string; body: string }[];
  const row = rows[0];
  if (!row) return null;
  return {
    href: `/s/${row.slug}`,
    title: row.title,
    kicker: CATEGORY_LABELS[sourceType] ?? sourceType,
    description: row.body.length > 90 ? row.body.slice(0, 90) + '…' : row.body,
  };
}

export async function getRelatedContent(pageType: RelatedPageType): Promise<RelatedItem[]> {
  const isBrookings = TOWN_ID === 'brookings_sd';
  const isMorenoValley = TOWN_ID === 'moreno_valley_ca';
  const items: RelatedItem[] = [];

  // Arkadspelet -- olika spel per ort (Fas 1/2-arbetet denna session), inte
  // via CATEGORY_HREFS eftersom spelen inte är egna stories.
  const gameItem: RelatedItem | null = isBrookings
    ? { href: '/play', title: 'Play Jackrabbit', kicker: 'Play', description: 'Our free arcade game — how far can you get?' }
    : isMorenoValley
      ? { href: '/burro-bonanza', title: 'Play Burro Bonanza', kicker: 'Play', description: "Our free match-3 game — help Dusty clear the trail." }
      : null;

  if (pageType === 'traffic') {
    const [nextEvent] = await getUpcomingStories(['event'], 1);
    if (nextEvent) {
      items.push({ href: `/s/${nextEvent.slug}`, title: nextEvent.title, kicker: 'Events', description: formatOccursAt(nextEvent) });
    }
    const [closure] = await getActiveSchoolAlerts();
    if (closure) {
      items.push({ href: closure.url || '/events', title: closure.title || 'School closure alert', kicker: 'School alert', description: closure.district });
    }
    if (gameItem) items.push(gameItem);
  } else if (pageType === 'events') {
    items.push({ href: '/traffic', title: 'Traffic', kicker: 'Traffic', description: 'Current road incidents and closures.' });
    const weekly = await getLatestWeekly();
    if (weekly) items.push({ href: `/s/${weekly.slug}`, title: weekly.title, kicker: 'This week', description: null });
    if (isBrookings) {
      items.push({ href: '/university', title: "What's on at SDSU", kicker: 'University', description: 'Athletics, music and more.' });
    } else if (isMorenoValley) {
      items.push({ href: '/workplace-watch', title: 'Worker Pulse', kicker: 'Worker Pulse', description: 'Employer review trends for Moreno Valley.' });
    }
  } else if (pageType === 'university') {
    const [nextEvent] = await getUpcomingStories(['event'], 1);
    if (nextEvent) {
      items.push({ href: `/s/${nextEvent.slug}`, title: nextEvent.title, kicker: 'Events', description: formatOccursAt(nextEvent) });
    }
    items.push({ href: '/traffic', title: 'Traffic', kicker: 'Traffic', description: 'Current road incidents and closures.' });
    if (gameItem) items.push(gameItem);
  } else if (pageType === 'workplace_watch') {
    const homeSales = await latestStoryByType('home_sales_digest');
    if (homeSales) items.push(homeSales);
    items.push({ href: '/events', title: "What's on", kicker: 'Events', description: 'This week in Moreno Valley.' });
    if (gameItem) items.push(gameItem);
  }

  return items;
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

/** En rad ur traffic_incidents -- se db/migrations/011_traffic_incidents.sql
 *  och scrapers/parsers/traffic_v1.py. Strukturerad data, ingen AI. */
export interface TrafficIncident {
  incident_type: string;
  title: string;
  description: string | null;
  road: string | null;
  lat: number | null;
  lon: number | null;
  ends_at: string | null;
  last_seen_at: string;
}

/** Trafikincidenter som fortfarande verkar aktuella -- (a) ingen känd
 *  sluttid ELLER sluttiden är i framtiden, OCH (b) källan har rapporterat
 *  incidenten nyligen (senaste 3 timmarna). Del (b) behövs eftersom många
 *  CHP-incidenter aldrig får en explicit sluttid -- utan den skulle en
 *  incident från igår kväll fortsätta visas som "aktuell" för evigt. */
export async function getActiveTrafficIncidents(maxAgeHours = 3): Promise<TrafficIncident[]> {
  return (await sql`
    SELECT incident_type, title, description, road, lat, lon, ends_at, last_seen_at
      FROM traffic_incidents
     WHERE town_id = ${TOWN_ID}
       AND (ends_at IS NULL OR ends_at >= now())
       AND last_seen_at >= now() - (${maxAgeHours} || ' hours')::interval
     ORDER BY last_seen_at DESC
  `) as TrafficIncident[];
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

/** Senaste jobbannonserna, nyast först. Ingen "aktiv"-filtrering som
 *  trafik/skolvarningar -- Adzuna slutar själv lista en annons när den tas
 *  bort, så allt som finns i tabellen är redan det senaste kända läget. */
export async function getRecentJobs(limit = 100): Promise<Job[]> {
  return (await sql`
    SELECT external_job_id, title, company, location, category,
           salary_min, salary_max, salary_is_predicted, description,
           redirect_url, posted_at
      FROM jobs
     WHERE town_id = ${TOWN_ID}
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

export async function getAgPrices(): Promise<AgPrice[]> {
  return (await sql`
    SELECT DISTINCT ON (commodity) commodity, price, unit, as_of
      FROM ag_prices
     WHERE town_id = ${TOWN_ID}
     ORDER BY commodity, created_at DESC
  `) as AgPrice[];
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
    SELECT address, sale_price, sale_date
      FROM property_sales
     WHERE town_id = ${TOWN_ID}
     ORDER BY sale_date DESC
     LIMIT ${limit}
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
}

/** Alla anläggningar för den aktuella orten, grupperat på category av
 *  anroparen (t.ex. /facilities/index.astro). Sorterat på category sen namn
 *  så renderingen blir stabil utan att varje sida behöver egen ORDER BY. */
export async function getFacilities(): Promise<Facility[]> {
  return (await sql`
    SELECT slug, name, category, address, phone, website,
           hours_text, description, source_url, verified_date
      FROM facilities
     WHERE town_id = ${TOWN_ID}
     ORDER BY category, name
  `) as Facility[];
}

/** En anläggning via dess slug, för /facilities/[slug].astro. Slug är bara
 *  unikt inom en ort (UNIQUE(town_id, slug)), samma mönster som Story-slugs. */
export async function getFacilityBySlug(slug: string): Promise<Facility | null> {
  const rows = (await sql`
    SELECT slug, name, category, address, phone, website,
           hours_text, description, source_url, verified_date
      FROM facilities
     WHERE town_id = ${TOWN_ID} AND slug = ${slug}
     LIMIT 1
  `) as Facility[];
  return rows[0] ?? null;
}

/** Läsbar rubrik per category-värde, för gruppering på /facilities. */
export const FACILITY_CATEGORY_LABELS: Record<string, string> = {
  library: 'Libraries',
  park: 'Parks',
  city_hall: 'City hall',
  community_center: 'Community centers',
  other: 'Other',
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
         AND occurs_at::date = (now() AT TIME ZONE 'America/Chicago')::date
    ` as unknown as Promise<{ n: number }[]>,
  ]);

  const current = periods.find((p) => p.is_daytime) ?? periods[0] ?? null;

  return {
    temp: current?.temp ?? null,
    unit: current?.unit ?? 'F',
    conditions: current?.short ?? null,
    alert: alerts[0]?.title ?? null,
    nextGame: games[0] ?? null,
    eventsToday: todayRows[0]?.n ?? 0,
  };
}

/* ------------------------------------------------------------- formatering - */

const TZ = 'America/Chicago';

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
  let year: number, month: number, day: number;
  if (value instanceof Date) {
    year = value.getFullYear();
    month = value.getMonth();
    day = value.getDate();
  } else {
    const [y, m, d] = value.slice(0, 10).split('-').map(Number);
    year = y; month = m - 1; day = d;
  }
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'long', day: 'numeric', timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month, day)));
}

/** Rätt formatering av story.occurs_at givet KÄLLTYP -- enda stället den
 *  distinktionen behöver göras, så inget anropsställe kan glömma den. */
export function formatOccursAt(story: Pick<Story, 'source_type' | 'occurs_at'>): string {
  if (!story.occurs_at) return '';
  if (story.source_type === 'meeting') return formatCalendarDate(story.occurs_at);
  return formatDateTime(story.occurs_at);
}

/** "in 6 days" / "tomorrow" / "today" -- för skyltremsan. */
export function countdown(value: string | null): string {
  if (!value) return '';
  const days = Math.ceil(
    (new Date(value).getTime() - Date.now()) / 86_400_000,
  );
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}
