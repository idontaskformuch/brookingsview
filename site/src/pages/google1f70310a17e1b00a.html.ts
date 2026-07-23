/**
 * Google Search Console-verifiering för morenovalleyview.com. Stadsspecifik
 * (tokenet i filnamnet hör till just den Search Console-egendomen), så den
 * här serveras bara för Moreno Valley-bygget i stället för att ligga som en
 * statisk fil under public/ som annars skulle kopieras in i alla städers
 * byggen oavsett SITE_CITY -- samma försiktighet som robots.txt/manifest/
 * ikonerna redan tillämpar.
 */
import type { APIRoute } from 'astro';
import { siteConfig } from '../lib/site-config';

export const GET: APIRoute = () => {
  if (siteConfig.townId !== 'moreno_valley_ca') {
    return new Response('Not found', { status: 404 });
  }
  return new Response('google-site-verification: google1f70310a17e1b00a.html', {
    headers: { 'Content-Type': 'text/html' },
  });
};
