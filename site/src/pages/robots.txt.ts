/**
 * robots.txt, genererat vid build i stället för en statisk fil under public/ --
 * en statisk fil pekade Sitemap-raden på brookingsview.com oavsett SITE_CITY,
 * vilket för en Moreno Valley-build skulle skicka sökmotorer till fel domäns
 * sitemap. Detta är en riktig funktionell SEO-bugg, inte bara kosmetisk text.
 */
import type { APIRoute } from 'astro';
import { siteConfig } from '../lib/site-config';

export const GET: APIRoute = ({ site }) => {
  const siteUrl = (site?.href ?? siteConfig.siteUrl).replace(/\/$/, '');
  const body = `# ${siteConfig.siteName} — ${siteConfig.domain}
# All content is intended to be indexed. The site aggregates public information
# and always links back to the primary source.

User-agent: *
Allow: /

Sitemap: ${siteUrl}/sitemap-index.xml
`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain' } });
};
