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

const sql = neon(import.meta.env.DATABASE_URL);

export const TOWN_ID = import.meta.env.TOWN_ID ?? 'brookings_sd';

export type SourceType =
  | 'meeting' | 'event' | 'alert' | 'weekly'
  | 'kultur_essa' | 'ledare' | 'vetenskap_kronika' | 'kvick_essa'
  | 'media_recension' | 'vardagsmiddag';

/** Presentation-layer label per source_type, för Byline-raden. Ingen egen DB-kolumn --
 *  category är en ren funktion av source_type, inget som behöver lagras separat. */
export const CATEGORY_LABELS: Partial<Record<SourceType, string>> = {
  kultur_essa: 'Kulturessä',
  ledare: 'Ledare',
  vetenskap_kronika: 'Vetenskap',
  kvick_essa: 'Kåseri',
  media_recension: 'Recension',
  vardagsmiddag: 'Recept',
};

/** De sex innehållstyperna från Content Track v1 -- en sammanhållen lista så att
 *  nya sidor/frågor inte behöver skriva om den varje gång. */
export const CONTENT_TRACK_TYPES: SourceType[] = [
  'kultur_essa', 'ledare', 'vetenskap_kronika', 'kvick_essa', 'media_recension', 'vardagsmiddag',
];

/** Vilken kategori-sida en Content Track-story hör hemma på när den arkiveras
 *  bort från förstasidan. kultur_essa/vetenskap_kronika/kvick_essa delar
 *  /columns -- tre krönike-varianter i en sektion, inte tre tunna sidor. */
export const CATEGORY_HREFS: Partial<Record<SourceType, string>> = {
  kultur_essa: '/columns',
  kvick_essa: '/columns',
  vetenskap_kronika: '/columns',
  ledare: '/editorials',
  media_recension: '/reviews',
  vardagsmiddag: '/recipes',
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

/* ------------------------------------------------------------------ stories */

/** Kommande och pågående -- det startsidan och sektionssidorna visar. */
export async function getUpcomingStories(
  sourceTypes: SourceType[],
  limit = 20,
): Promise<Story[]> {
  return (await sql`
    SELECT id, title, slug, body, source_type, source_url, occurs_at, published_at, generated_by,
           byline, image_path, rating
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
           byline, image_path, rating
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
           byline, image_path, rating
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
           byline, image_path, rating
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
           byline, image_path, rating
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
           byline, image_path, rating
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
           s.byline, s.image_path, s.rating
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
           byline, image_path, rating
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
           byline, image_path, rating
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
           byline, image_path, rating
      FROM stories
     WHERE town_id = ${TOWN_ID}
       AND slug <> ALL(${seen})
       AND occurs_at IS NOT NULL
     ORDER BY abs(extract(epoch FROM (occurs_at - ${anchor}::timestamptz)))
     LIMIT ${limit - sameType.length}
  `) as Story[];

  return [...sameType, ...filler];
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
export function formatCalendarDate(value: string | null): string {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'long', day: 'numeric', timeZone: 'UTC',
  }).format(new Date(value));
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
