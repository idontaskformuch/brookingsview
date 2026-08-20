/**
 * IAB ads.txt for morenovalleyview.com's AdSense account. Stadsspecifik
 * (deklarerar en säljarrelation för just det AdSense-kontot), så den här
 * serveras bara för Moreno Valley-bygget i stället för att ligga som en
 * statisk fil under public/ som annars skulle kopieras in i alla städers
 * byggen oavsett SITE_CITY -- samma försiktighet som robots.txt/manifest/
 * ikonerna/google1f70310a17e1b00a.html.ts redan tillämpar. En felaktig
 * ads.txt-post på brookingsview.com vore inte bara kosmetiskt fel, det
 * skulle felaktigt hävda en säljarrelation för en domän utanför det kontot.
 */
import type { APIRoute } from 'astro';
import { siteConfig } from '../lib/site-config';

export const GET: APIRoute = () => {
  if (siteConfig.townId !== 'moreno_valley_ca') {
    return new Response('Not found', { status: 404 });
  }
  return new Response('google.com, pub-9173970727436631, DIRECT, f08c47fec0942fa0\n', {
    headers: { 'Content-Type': 'text/plain' },
  });
};
