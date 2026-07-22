import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Statiskt bygge: all data hämtas från Neon vid build-time, sedan serveras rena
// HTML-filer från Cloudflares edge. GitHub Actions pingar deploy-hooken efter
// varje scrape+publish-körning, så innehållet är som mest en timme gammalt.
//
// site: väljs per SITE_CITY, samma variabel som site/src/lib/site-config.ts
// läser. Utelämnad -> Brookings, så befintliga byggen är oförändrade.
const SITE_URLS = {
  brookings_sd: 'https://brookingsview.com',
  moreno_valley_ca: 'https://morenovalleyview.com',
};
const activeCity = process.env.SITE_CITY ?? 'brookings_sd';

export default defineConfig({
  site: SITE_URLS[activeCity] ?? SITE_URLS.brookings_sd,
  output: 'static',
  integrations: [sitemap()],
});
