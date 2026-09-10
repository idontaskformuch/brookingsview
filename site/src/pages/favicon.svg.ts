/**
 * favicon.svg, genererad vid build-time i stället för en statisk fil under
 * public/ -- en statisk fil visade bokstaven "B" oavsett SITE_CITY (samma
 * klass av bugg som robots.txt/manifest.webmanifest, se de filerna för
 * bakgrund; fixat där i commit 9fc548c). Bokstaven är utbytt mot
 * siteConfig.brandLead:s första tecken.
 *
 * Consistency pass (2026-09-10): fill/text-färgerna (#1a4e7a/#eff3f5) hade
 * aldrig uppdaterats när BaseLayout.astro:s tokens en gång retuned till
 * --navy (#0b2e55) -- helt egna, drivna värden ingen annanstans i sajten.
 * Denna fil kan inte läsa CSS custom properties (ren SVG-textrespons, inget
 * stylesheet), så värdena är hårdkodade här -- men nu SAMMA hex som
 * --navy/--paper, med denna kommentar som länk mellan dem om de tokens
 * någonsin ändras igen.
 */
import type { APIRoute } from 'astro';
import { siteConfig } from '../lib/site-config';

export const GET: APIRoute = () => {
  const letter = siteConfig.brandLead.charAt(0).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="#0b2e55"/>
  <text x="16" y="23" font-family="Georgia, serif" font-size="19" font-weight="600"
        fill="#fbfaf7" text-anchor="middle">${letter}</text>
</svg>
`;
  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};
