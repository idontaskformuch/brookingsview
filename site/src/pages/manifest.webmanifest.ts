/**
 * PWA-manifest, genererat vid build i stället för en statisk fil under public/ --
 * en statisk fil kopieras byte-för-byte oavsett SITE_CITY, vilket lät appnamnet
 * en Moreno Valley-besökare ser vid "Lägg till på hemskärmen" fortfarande säga
 * "Brookings View". Ikonerna är delade (samma navy "B"-märke) tills en stad
 * vill ha en egen ikonuppsättning.
 */
import type { APIRoute } from 'astro';
import { siteConfig } from '../lib/site-config';

export const GET: APIRoute = () => {
  const manifest = {
    name: siteConfig.siteName,
    short_name: siteConfig.siteName,
    description: siteConfig.description,
    start_url: '/?source=pwa',
    id: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f4f6f7',
    theme_color: '#0b2e55',
    lang: 'en-US',
    orientation: 'portrait-primary',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: { 'Content-Type': 'application/manifest+json' },
  });
};
