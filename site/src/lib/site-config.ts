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
}

const CITIES: Record<string, SiteConfig> = {
  brookings_sd: {
    townId: 'brookings_sd',
    cityName: 'Brookings',
    stateName: 'South Dakota',
    stateAbbr: 'SD',
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
  },

  moreno_valley_ca: {
    townId: 'moreno_valley_ca',
    cityName: 'Moreno Valley',
    stateName: 'California',
    stateAbbr: 'CA',
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
  },
};

// Astro exposer env via import.meta.env vid byggtid. SITE_CITY sätts i varje
// stads byggmiljö (GitHub Action / Cloudflare Pages). Utelämnad -> Brookings.
const active = (import.meta.env.SITE_CITY as string | undefined) ?? 'brookings_sd';

export const siteConfig: SiteConfig = CITIES[active] ?? CITIES.brookings_sd;

export function getSiteConfig(): SiteConfig {
  return siteConfig;
}
