import type { APIRoute } from 'astro';
import { renderAppIconPng } from '../lib/app-icon';

export const GET: APIRoute = async () => {
  const png = await renderAppIconPng(512, true);
  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};
