/**
 * Curated public source links for /about -- see NEEDS-HUMAN-REVIEW.md
 * "Liveliness Spec" §5: "An actual list, per town, with links... Generate
 * it from config so it cannot drift."
 *
 * Display name and public-facing URL are hand-curated here (configs/
 * <town>.json's own url/endpoint fields are frequently API roots or raw
 * ICS/KML feeds -- exactly the wrong thing to hand a reader), but each
 * entry is gated against that config's data_sources[key].enabled at build
 * time. Disable a source in config and it silently drops off this list on
 * the next build -- no separate edit here, so the two can't drift apart on
 * the "is this source actually live" question, which is the drift that
 * actually matters for reader trust.
 */
import brookingsConfig from '../../../configs/brookings_sd.json';
import morenoValleyConfig from '../../../configs/moreno_valley_ca.json';

export interface AboutSource { name: string; url: string; }

interface CuratedSource { configKey: string; name: string; url: string; }

// URLs verified live elsewhere in this codebase (data/facilities/*.json,
// or the config's own already-human-facing url/endpoint field) -- never
// guessed here.
const BROOKINGS_CURATED: CuratedSource[] = [
  { configKey: 'city_meetings', name: 'City Council agendas (Legistar)', url: 'https://cityofbrookings.legistar.com' },
  { configKey: 'county_meetings', name: 'Brookings County Commission agendas', url: 'https://www.brookingscountysd.gov/AgendaCenter' },
  { configKey: 'events', name: 'Brookings Public Library events calendar', url: 'https://www.brookingslibrary.org/' },
  { configKey: 'sdsu_events', name: 'SDSU campus events calendar', url: 'https://www.sdstate.edu/event-calendar' },
  { configKey: 'sdsu_athletics', name: 'SDSU Jackrabbits athletics', url: 'https://gojacks.com' },
  { configKey: 'weather_alerts', name: 'National Weather Service alerts', url: 'https://alerts.weather.gov' },
  { configKey: 'county_alerts', name: 'Brookings County alerts', url: 'https://www.brookingscountysd.gov' },
  { configKey: 'ag_markets', name: 'USDA market prices', url: 'https://www.ams.usda.gov/market-news' },
  { configKey: 'jobs', name: 'Adzuna job listings', url: 'https://www.adzuna.com' },
];

const MORENO_VALLEY_CURATED: CuratedSource[] = [
  { configKey: 'city_meetings', name: 'City Council & Planning Commission agendas (eSCRIBE)', url: 'https://pub-morenovalley.escribemeetings.com' },
  { configKey: 'events', name: "City of Moreno Valley and library event calendars", url: 'https://www.moval.org/mymoval/calendar.html' },
  { configKey: 'property_sales', name: "Riverside County Assessor's property sales report", url: 'https://www.rivcoacr.org/property-sales-report' },
  { configKey: 'weather_alerts', name: 'National Weather Service alerts', url: 'https://alerts.weather.gov' },
  { configKey: 'school_alerts', name: 'Moreno Valley Unified School District news', url: 'https://www.mvusd.net/engage/news' },
  { configKey: 'traffic', name: 'Caltrans QuickMap', url: 'https://quickmap.dot.ca.gov' },
  { configKey: 'pro_sports', name: 'MLB Stats API (Angels, Dodgers, Inland Empire 66ers)', url: 'https://www.mlb.com' },
  { configKey: 'jobs', name: 'Adzuna job listings', url: 'https://www.adzuna.com' },
  { configKey: 'workplace_watch', name: 'Glassdoor and Indeed (via aggregated search summaries)', url: 'https://www.glassdoor.com' },
];

function enabledSources(config: any, curated: CuratedSource[]): AboutSource[] {
  const dataSources = config.data_sources ?? {};
  return curated
    .filter((c) => dataSources[c.configKey]?.enabled === true)
    .map((c) => ({ name: c.name, url: c.url }));
}

export function aboutSourcesFor(townId: 'brookings_sd' | 'moreno_valley_ca'): AboutSource[] {
  return townId === 'brookings_sd'
    ? enabledSources(brookingsConfig, BROOKINGS_CURATED)
    : enabledSources(morenoValleyConfig, MORENO_VALLEY_CURATED);
}
