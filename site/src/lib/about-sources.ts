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
import broomfieldConfig from '../../../configs/broomfield_co.json';

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

// CONFIRMED 2026-08-26 (Broomfield launch research) -- only listed for
// sources this config actually marks enabled:true will these show up (see
// enabledSources() below); entries for still-disabled sources (city_meetings,
// school_alerts_*, events, traffic) are pre-written here so they appear
// automatically the moment their config flips to enabled, same "can't drift"
// guarantee the module docstring describes.
const BROOMFIELD_CURATED: CuratedSource[] = [
  { configKey: 'city_meetings', name: 'City Council agendas (AgendaLink)', url: 'https://horizon.agendalink.app/engage/broomfield/' },
  { configKey: 'school_alerts_adams12', name: 'Adams 12 Five Star Schools closures', url: 'https://www.adams12.org/our-district/communications/weather-delays-and-closures' },
  { configKey: 'school_alerts_bvsd', name: 'Boulder Valley School District', url: 'https://www.bvsd.org' },
  { configKey: 'events', name: 'Broomfield recreation & library events (WebTrac)', url: 'https://broomfield.org/ProgramGuide' },
  { configKey: 'weather_alerts', name: 'National Weather Service alerts', url: 'https://alerts.weather.gov' },
  { configKey: 'traffic', name: 'CDOT / COtrip', url: 'https://www.cotrip.org' },
  { configKey: 'jobs', name: 'Adzuna job listings', url: 'https://www.adzuna.com' },
  { configKey: 'workplace_watch', name: 'Glassdoor and Indeed (via aggregated search summaries)', url: 'https://www.glassdoor.com' },
];

const CURATED_BY_TOWN: Record<string, { config: any; curated: CuratedSource[] }> = {
  brookings_sd: { config: brookingsConfig, curated: BROOKINGS_CURATED },
  moreno_valley_ca: { config: morenoValleyConfig, curated: MORENO_VALLEY_CURATED },
  broomfield_co: { config: broomfieldConfig, curated: BROOMFIELD_CURATED },
};

function enabledSources(config: any, curated: CuratedSource[]): AboutSource[] {
  const dataSources = config.data_sources ?? {};
  return curated
    .filter((c) => dataSources[c.configKey]?.enabled === true)
    .map((c) => ({ name: c.name, url: c.url }));
}

// A binary (townId === 'brookings_sd' ? A : B) ternary here would silently
// hand a THIRD town whichever list happens to be the ":" branch -- exactly
// the class of bug found during Broomfield's launch survey (would have
// misattributed Moreno Valley's Riverside County/Caltrans sources to
// Broomfield's /about page). A real per-town lookup instead, so an unlisted
// town_id gets an empty list rather than someone else's sources.
export function aboutSourcesFor(townId: string): AboutSource[] {
  const entry = CURATED_BY_TOWN[townId];
  return entry ? enabledSources(entry.config, entry.curated) : [];
}
