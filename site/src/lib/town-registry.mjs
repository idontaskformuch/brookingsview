/**
 * Town registry (audit Fas 3a, P4-1): the identity values more than one layer needs, in one place. No imports, so astro.config.mjs (Node),
 * the site build (Vite), the Worker (wrangler) and vitest all load it as is. Types: town-registry.d.mts.
 * id, cityName, domain, timezone, country and nation mirror configs/<town>.json (town_id, display_name, domain, timezone, country, nation),
 * which Python reads; town-registry.test.ts fails if they disagree. siteName and noindexSite live only here.
 * Rich town data that only the site reads (nav, evening regions, sources) stays in site-config.ts.
 */
const towns = {
  brookings_sd: {
    townId: 'brookings_sd',
    cityName: 'Brookings',
    siteName: 'Brookings View',
    domain: 'brookingsview.com',
    timezone: 'America/Chicago',
    country: 'us',
    noindexSite: false,
  },
  moreno_valley_ca: {
    townId: 'moreno_valley_ca',
    cityName: 'Moreno Valley',
    siteName: 'Moreno Valley View',
    domain: 'morenovalleyview.com',
    timezone: 'America/Los_Angeles',
    country: 'us',
    noindexSite: false,
  },
  broomfield_co: {
    townId: 'broomfield_co',
    cityName: 'Broomfield',
    siteName: 'Broomfield View',
    domain: 'broomfieldview.com',
    timezone: 'America/Denver',
    country: 'us',
    noindexSite: false,
  },
  glasgow: {
    townId: 'glasgow',
    cityName: 'Glasgow',
    siteName: 'Glasgow Loop',
    domain: 'glasgowloop.co.uk',
    timezone: 'Europe/London',
    country: 'gb',
    nation: 'scotland',
    noindexSite: false,
  },
};

/** siteUrl is always https:// + domain. */
export const TOWN_REGISTRY = Object.fromEntries(
  Object.entries(towns).map(([id, t]) => [id, { ...t, siteUrl: `https://${t.domain}` }]),
);
