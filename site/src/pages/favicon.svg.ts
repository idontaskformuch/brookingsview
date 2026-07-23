/**
 * favicon.svg, genererad vid build-time i stället för en statisk fil under
 * public/ -- en statisk fil visade bokstaven "B" oavsett SITE_CITY (samma
 * klass av bugg som robots.txt/manifest.webmanifest, se de filerna för
 * bakgrund; fixat där i commit 9fc548c). Markup/färger är oförändrade från
 * den tidigare statiska filen, bara bokstaven är utbytt mot
 * siteConfig.brandLead:s första tecken.
 */
import type { APIRoute } from 'astro';
import { siteConfig } from '../lib/site-config';

export const GET: APIRoute = () => {
  const letter = siteConfig.brandLead.charAt(0).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="#1a4e7a"/>
  <text x="16" y="23" font-family="Georgia, serif" font-size="19" font-weight="600"
        fill="#eff3f5" text-anchor="middle">${letter}</text>
</svg>
`;
  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};
