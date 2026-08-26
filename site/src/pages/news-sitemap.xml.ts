/**
 * Google News sitemap -- see NEEDS-HUMAN-REVIEW.md "Google News sitemap"
 * and lib/news-sitemap.ts's own module docstring for the full spec/
 * reasoning. Separate from the general sitemap (@astrojs/sitemap,
 * sitemap-index.xml) -- News sitemaps are their own file by Google's own
 * spec, never merged into the general one.
 *
 * Regenerated on every site build (this repo's site rebuilds hourly, see
 * .github/workflows/scrape.yml) -- no separate cron job needed, and no
 * risk of ever serving a stale/expired entry, since the 48-hour window is
 * recomputed fresh against real `published_at` values at every build.
 */
import type { APIRoute } from 'astro';
import { getStoriesForNewsSitemap } from '../lib/db';
import { buildNewsSitemapXml } from '../lib/news-sitemap';
import { siteConfig } from '../lib/site-config';

export const GET: APIRoute = async ({ site }) => {
  const siteUrl = (site?.href ?? siteConfig.siteUrl).replace(/\/$/, '');
  const stories = await getStoriesForNewsSitemap();

  const xml = buildNewsSitemapXml(stories, {
    siteUrl,
    publicationName: siteConfig.siteName,
    timezone: siteConfig.timezone,
    cityName: siteConfig.cityName,
  });

  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
};
