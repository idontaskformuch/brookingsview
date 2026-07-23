/**
 * favicon.ico -- den tidigare statiska filen var inte ens den navy "B"-ikonen
 * (det var en orelaterad kvarglömd platshållarikon), så det här är både
 * stadsfixet och en riktig bugg-fix. Precis som originalfilen är detta i
 * praktiken en PNG som serveras under .ico-namnet/content-typen -- moderna
 * webbläsare kräver inte en riktig ICO-container för att visa den i fliken.
 */
import type { APIRoute } from 'astro';
import { renderAppIconPng } from '../lib/app-icon';

export const GET: APIRoute = async () => {
  const png = await renderAppIconPng(32);
  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/x-icon',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};
