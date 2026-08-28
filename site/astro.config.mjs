import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { neon } from '@neondatabase/serverless';
import { loadEnv } from 'vite';

// Statiskt bygge: all data hämtas från Neon vid build-time, sedan serveras rena
// HTML-filer från Cloudflares edge. GitHub Actions pingar deploy-hooken efter
// varje scrape+publish-körning, så innehållet är som mest en timme gammalt.
//
// site: väljs per SITE_CITY, samma variabel som site/src/lib/site-config.ts
// läser. Utelämnad -> Brookings, så befintliga byggen är oförändrade.
const SITE_URLS = {
  brookings_sd: 'https://brookingsview.com',
  moreno_valley_ca: 'https://morenovalleyview.com',
  broomfield_co: 'https://broomfieldview.com',
};

// astro.config.mjs itself loads BEFORE Vite's own env pipeline populates
// import.meta.env (that's how lib/db.ts normally reads DATABASE_URL) --
// confirmed live: a plain `process.env.DATABASE_URL` read here is empty
// even in a local build that has a real `.env`, and CI sets DATABASE_URL
// as a real process env var on the build step regardless (see scrape.yml),
// so this only matters for local verification -- but the fallback matters
// there too. loadEnv() is Vite's own documented way to read `.env` from
// inside a config file specifically because of this timing gap.
const env = { ...loadEnv('', process.cwd(), ''), ...process.env };
const activeCity = env.SITE_CITY ?? 'brookings_sd';

// Mirrors lib/home-sales.ts's slugifyAddress() exactly -- deliberately
// duplicated rather than imported, since this file runs before Vite's
// module graph (and import.meta.env) exist, the same "duplicate across
// layers" tradeoff this codebase already makes for OUTLIER_PRICE_FLOOR /
// normalize_venue() / QUORUM_NOTICE_RE.
function slugifyAddress(address) {
  return address
    .toLowerCase()
    .replace(/,.*$/, '')
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Mirrors lib/home-sales.ts's HOME_SALES_INDEXABLE_MONTHS /
// isSaleDateIndexable() exactly -- same duplication tradeoff as
// slugifyAddress above. Keep both in sync: this is what decides which
// /home-sales/<slug>/ URLs are excluded from the sitemap, and it must
// agree with what the page itself puts in its own <meta name="robots">,
// or a page could end up noindexed but still listed in the sitemap (or
// the reverse).
const HOME_SALES_INDEXABLE_MONTHS = 6;
function isSaleDateIndexable(saleDate, now = new Date()) {
  if (!saleDate) return false;
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - HOME_SALES_INDEXABLE_MONTHS);
  return new Date(saleDate) >= cutoff;
}

/**
 * Real per-page lastmod dates for the sitemap (SEO Fas 1.1). A bare
 * sitemap() with no serialize() either omits lastmod or -- worse --
 * @astrojs/sitemap can stamp every URL with the CURRENT BUILD time, which
 * actively lies to Google: a project page untouched for two months looks
 * freshly edited on every hourly rebuild. Queried directly here rather
 * than via lib/db.ts (which assumes import.meta.env, not available in this
 * plain-Node config context) -- one broad query per table, same
 * "fetch once, look up per URL" shape as the rest of this codebase's
 * "fetch broad once" pattern (see lib/events.ts).
 */
async function buildLastmodMap(townId, databaseUrl) {
  const map = new Map();
  // Individual home-sale parcel pages older than the threshold above are
  // excluded from the sitemap entirely (SEO: age out old home-sales pages)
  // -- built alongside lastmod since it reuses the exact same parcels
  // query below. The aggregate /home-sales table, its ZIP facets, and the
  // monthly digest are untouched -- only per-parcel URLs ever land here.
  const noindexHomeSaleUrls = new Set();
  // e.g. `astro check`'s CI job deliberately runs with no DATABASE_URL
  // (see tests.yml) -- an empty map just means no lastmod hints, never a
  // build failure.
  if (!databaseUrl) return { map, noindexHomeSaleUrls };
  const sql = neon(databaseUrl);

  const stories = await sql`SELECT slug, published_at FROM stories WHERE town_id = ${townId}`;
  for (const s of stories) map.set(`/s/${s.slug}/`, s.published_at);

  const projects = await sql`SELECT slug, updated_at FROM projects WHERE town_id = ${townId}`;
  for (const p of projects) map.set(`/city-hall/projects/${p.slug}/`, p.updated_at);

  const facilities = await sql`
    SELECT slug, verified_date FROM facilities
     WHERE town_id = ${townId} AND verified_date IS NOT NULL
  `;
  for (const f of facilities) map.set(`/facilities/${f.slug}/`, f.verified_date);

  // property_sales only exists for Moreno Valley (Riverside County's
  // assessor report doesn't cover South Dakota) -- same naturally-empty-
  // elsewhere pattern as getPropertySaleParcels() in lib/db.ts.
  if (townId === 'moreno_valley_ca') {
    const parcels = await sql`
      SELECT DISTINCT ON (pin) pin, address, sale_date
        FROM property_sales
       WHERE town_id = ${townId} AND pin IS NOT NULL
       ORDER BY pin, sale_date DESC
    `;
    for (const p of parcels) {
      if (!p.address) continue;
      const pathname = `/home-sales/${slugifyAddress(p.address)}/`;
      if (p.sale_date) map.set(pathname, p.sale_date);
      if (!isSaleDateIndexable(p.sale_date)) noindexHomeSaleUrls.add(pathname);
    }
  }

  return { map, noindexHomeSaleUrls };
}

const { map: lastmodMap, noindexHomeSaleUrls } = await buildLastmodMap(activeCity, env.DATABASE_URL);

export default defineConfig({
  site: SITE_URLS[activeCity] ?? SITE_URLS.brookings_sd,
  output: 'static',
  integrations: [
    sitemap({
      filter: (page) => !noindexHomeSaleUrls.has(new URL(page).pathname),
      serialize(item) {
        const lastmod = lastmodMap.get(new URL(item.url).pathname);
        return lastmod ? { ...item, lastmod: new Date(lastmod).toISOString() } : item;
      },
    }),
  ],
});
