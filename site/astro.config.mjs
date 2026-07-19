import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Statiskt bygge: all data hämtas från Neon vid build-time, sedan serveras rena
// HTML-filer från Cloudflares edge. GitHub Actions pingar deploy-hooken efter
// varje scrape+publish-körning, så innehållet är som mest en timme gammalt.
export default defineConfig({
  site: 'https://brookingsview.com',
  output: 'static',
  integrations: [sitemap()],
});
