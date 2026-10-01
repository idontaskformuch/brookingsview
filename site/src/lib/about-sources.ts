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
  // 2026-10-01 cleanup round, item 2: 'events' bundles THREE real, distinct
  // feeds in config (library/chamber/chamber_business -- see
  // configs/brookings_sd.json's own events.sources array), but only the
  // library was ever listed here. Same configKey on purpose -- several
  // curated rows can share one config gate (see BROOMFIELD_CURATED's own
  // precedent), so all three appear/disappear together with the one real
  // enabled flag that actually governs them.
  { configKey: 'events', name: 'Brookings Area Chamber of Commerce events (GrowthZone)', url: 'https://brookingsareachamberofcommerce.growthzoneapp.com/events/Search' },
  { configKey: 'events', name: 'Visit Brookings events calendar', url: 'https://visitbrookingssd.com/events/' },
  { configKey: 'sdsu_events', name: 'SDSU campus events calendar', url: 'https://www.sdstate.edu/event-calendar' },
  { configKey: 'sdsu_athletics', name: 'SDSU Jackrabbits athletics', url: 'https://gojacks.com' },
  { configKey: 'weather', name: 'National Weather Service forecast', url: 'https://www.weather.gov' },
  { configKey: 'weather_alerts', name: 'National Weather Service alerts', url: 'https://alerts.weather.gov' },
  { configKey: 'county_alerts', name: 'Brookings County alerts', url: 'https://www.brookingscountysd.gov' },
  { configKey: 'ag_markets', name: 'USDA market prices', url: 'https://www.ams.usda.gov/market-news' },
  { configKey: 'jobs', name: 'Adzuna job listings', url: 'https://www.adzuna.com' },
  { configKey: 'business_licenses', name: 'City of Brookings business & liquor licenses (SmartGov)', url: 'https://ci-brookings-sd.smartgovcommunity.com/' },
  { configKey: 'whats_on_ticketmaster', name: 'Ticketmaster (concerts & tickets)', url: 'https://www.ticketmaster.com' },
];

const MORENO_VALLEY_CURATED: CuratedSource[] = [
  { configKey: 'city_meetings', name: 'City Council & Planning Commission agendas (eSCRIBE)', url: 'https://pub-morenovalley.escribemeetings.com' },
  { configKey: 'events', name: "City of Moreno Valley and library event calendars", url: 'https://www.moval.org/mymoval/calendar.html' },
  { configKey: 'property_sales', name: "Riverside County Assessor's property sales report", url: 'https://www.rivcoacr.org/property-sales-report' },
  { configKey: 'weather', name: 'National Weather Service forecast', url: 'https://www.weather.gov' },
  { configKey: 'weather_alerts', name: 'National Weather Service alerts', url: 'https://alerts.weather.gov' },
  { configKey: 'school_alerts', name: 'Moreno Valley Unified School District news', url: 'https://www.mvusd.net/engage/news' },
  { configKey: 'traffic', name: 'Caltrans QuickMap', url: 'https://quickmap.dot.ca.gov' },
  { configKey: 'pro_sports', name: 'MLB Stats API (Angels, Dodgers, Inland Empire 66ers)', url: 'https://www.mlb.com' },
  { configKey: 'jobs', name: 'Adzuna job listings', url: 'https://www.adzuna.com' },
  { configKey: 'workplace_watch', name: 'Glassdoor and Indeed (via aggregated search summaries)', url: 'https://www.glassdoor.com' },
  { configKey: 'whats_on_ticketmaster', name: 'Ticketmaster (concerts & tickets)', url: 'https://www.ticketmaster.com' },
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
  { configKey: 'weather', name: 'National Weather Service forecast', url: 'https://www.weather.gov' },
  { configKey: 'weather_alerts', name: 'National Weather Service alerts', url: 'https://alerts.weather.gov' },
  { configKey: 'traffic', name: 'CDOT / COtrip', url: 'https://www.cotrip.org' },
  { configKey: 'jobs', name: 'Adzuna job listings', url: 'https://www.adzuna.com' },
  { configKey: 'workplace_watch', name: 'Glassdoor and Indeed (via aggregated search summaries)', url: 'https://www.glassdoor.com' },
  { configKey: 'vail_news', name: 'Vail Resorts news & stories (regional roundup)', url: 'https://news.vailresorts.com/news-and-stories' },
  { configKey: 'whats_on_ticketmaster', name: 'Ticketmaster (concerts & tickets)', url: 'https://www.ticketmaster.com' },
];

const CURATED_BY_TOWN: Record<string, { config: any; curated: CuratedSource[] }> = {
  brookings_sd: { config: brookingsConfig, curated: BROOKINGS_CURATED },
  moreno_valley_ca: { config: morenoValleyConfig, curated: MORENO_VALLEY_CURATED },
  broomfield_co: { config: broomfieldConfig, curated: BROOMFIELD_CURATED },
};

// 'whats_on_ticketmaster' isn't a data_sources entry at all -- Ticketmaster
// is gated under features.whats_on.ticketmaster.enabled instead (see
// configs/<town>.json's own "features" block). A plain dataSources[key]
// lookup would silently never match it and the curated row would just
// never appear -- this one special case keeps that gate real instead of
// hardcoding "always show Ticketmaster," so a town that ever disables it
// drops it here too.
function isEnabled(config: any, configKey: string): boolean {
  if (configKey === 'whats_on_ticketmaster') {
    return config.features?.whats_on?.ticketmaster?.enabled === true;
  }
  return config.data_sources?.[configKey]?.enabled === true;
}

function enabledSources(config: any, curated: CuratedSource[]): AboutSource[] {
  return curated
    .filter((c) => isEnabled(config, c.configKey))
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
