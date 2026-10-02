/**
 * Ticketmaster image proxy-and-cache. 2026-10-01 cleanup round, item 3:
 * this site used to put Ticketmaster's own `s1.ticketm.net` URL directly
 * into rendered <img src> (see lib/images.ts's resolveImage(), tier 1) --
 * a reader's browser hit Ticketmaster's CDN directly, every page view.
 *
 * Ticketmaster's own Developer Terms of Use (checked 2026-10-01,
 * developer.ticketmaster.com/support/terms-of-use/), under "You shall
 * not": "Cache or store any Event Content other than for reasonable
 * periods in order to provide the service you are providing." -- this
 * reads as permission to cache FOR THE PURPOSE OF SERVING THE EVENT, not a
 * blanket ban, but it rules out an unbounded, permanent local copy. A
 * bounded-TTL edge cache (CACHE_TTL_SECONDS below) is exactly "a
 * reasonable period in order to provide the service" -- long enough to
 * stop re-fetching their CDN on every single page view, short enough to
 * self-expire rather than becoming a permanent archive. The same terms
 * also separately forbid "Use Ticketmaster as a generic image hosting
 * service for banner advertisements, graphics, etc." -- irrelevant here,
 * since this only ever serves the SAME event's own image back for that
 * event's own card, never repurposed elsewhere. No attribution/branding
 * clause was found anywhere in that document for Event Content images.
 *
 * ALLOWED_HOSTS is a hard allowlist, not a convenience check: without it
 * this endpoint would be an open proxy that fetches ANY attacker-supplied
 * URL server-side (SSRF) just because it was handed a `u=` query param.
 *
 * 2026-10-02: TTL cut from 7 days to 24 hours, and a single-image purge
 * route added -- found, re-reading Ticketmaster's terms for this follow-up,
 * a SEPARATE affirmative obligation alongside the caching clause: "You
 * shall... Remove from your application within 24 hours any Event Content
 * or other information or tickets that the owner asks you to remove." A
 * 7-day TTL with no purge path could leave a removal-requested image
 * cached for up to a week past that deadline; 24 hours is the actual
 * contractual ceiling, and handleTicketmasterImagePurge() below lets an
 * operator clear one image immediately on request rather than waiting out
 * even that.
 */
import type { Env } from './_shared';
import { townFromHostname } from './_shared';

const ALLOWED_HOSTS = new Set(['s1.ticketm.net']);

// 24 hours: Ticketmaster's own 24-hour removal-on-request deadline (see
// module docstring) is the real ceiling here, not just "reasonable
// periods" in the abstract -- a cached image must never outlive a removal
// request by more than this TTL even if the purge route (below) is never
// called for it.
const CACHE_TTL_SECONDS = 60 * 60 * 24;

// Reuses each town's own real, already-Pexels-attributed "events" category
// image (site/src/config/category-images.ts's first entry per town) rather
// than commissioning a separate generic placeholder graphic -- served via
// the ASSETS binding, so it's just as real a file as any other page image,
// not a synthesized/blank graphic. Broomfield's own events pool reuses
// Brookings' same two images (see category-images.ts), so the fallback
// mirrors that existing choice rather than inventing a third option.
const PLACEHOLDER_PATH_BY_TOWN: Record<string, string> = {
  brookings_sd: '/assets/images/categories/brookings_sd-events-1.png',
  moreno_valley_ca: '/assets/images/categories/moreno_valley_ca-events-1.png',
  broomfield_co: '/assets/images/categories/brookings_sd-events-1.png',
};
const DEFAULT_PLACEHOLDER_PATH = PLACEHOLDER_PATH_BY_TOWN.brookings_sd;

interface AssetsBinding { fetch(request: Request): Promise<Response>; }
interface TicketmasterImageEnv extends Env { ASSETS: AssetsBinding; }

async function servePlaceholder(request: Request, env: TicketmasterImageEnv): Promise<Response> {
  const townId = townFromHostname(request.url, env.DEV_TOWN_ID);
  const path = (townId && PLACEHOLDER_PATH_BY_TOWN[townId]) ?? DEFAULT_PLACEHOLDER_PATH;
  const assetUrl = new URL(path, request.url);
  const response = await env.ASSETS.fetch(new Request(assetUrl.toString(), request));
  // A placeholder is a normal, expected outcome (an expired/removed
  // Ticketmaster image), not an error -- real 200, not a 502/404 passed
  // through to the <img> tag.
  return new Response(response.body, {
    status: 200,
    headers: { 'Content-Type': response.headers.get('Content-Type') ?? 'image/png' },
  });
}

/** `cacheStorage` defaults to the real Workers `caches` global in
 *  production; tests inject a fake (the Node vitest environment this repo
 *  runs under has no Cache API global at all). */
export async function handleTicketmasterImage(
  request: Request,
  env: TicketmasterImageEnv,
  ctx: ExecutionContext,
  cacheStorage: CacheStorage = caches,
): Promise<Response> {
  const requestUrl = new URL(request.url);
  const originalUrl = requestUrl.searchParams.get('u');
  if (!originalUrl) {
    return new Response('Missing u parameter', { status: 400 });
  }

  let parsedOriginal: URL;
  try {
    parsedOriginal = new URL(originalUrl);
  } catch {
    return new Response('Invalid u parameter', { status: 400 });
  }
  if (!ALLOWED_HOSTS.has(parsedOriginal.hostname)) {
    return new Response('Host not allowed', { status: 400 });
  }

  const cache = cacheStorage.default;
  // The incoming request URL (our own /img/ticketmaster?u=... path) is
  // already a stable, unique cache key per original image -- no separate
  // key construction needed, same as Cloudflare's own documented pattern.
  const cached = await cache.match(request);
  if (cached) return cached;

  let upstream: Response;
  try {
    upstream = await fetch(parsedOriginal.toString());
  } catch {
    return servePlaceholder(request, env);
  }
  if (!upstream.ok) {
    return servePlaceholder(request, env);
  }

  const cacheableResponse = new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'image/jpeg',
      'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
    },
  });
  // Store a copy before returning -- cache.put() consumes the body stream,
  // so the caller gets a separate clone, not the same (now-drained) object.
  ctx.waitUntil(cache.put(request, cacheableResponse.clone()));
  return cacheableResponse;
}

/** POST /img/ticketmaster/purge?u=<original Ticketmaster URL> -- clears one
 *  cached image immediately, for Ticketmaster's own 24-hour
 *  removal-on-request deadline (see module docstring) rather than waiting
 *  out CACHE_TTL_SECONDS. Operator-triggered (a human runs this when asked
 *  to remove an image), not called by CI, so it's gated on a Workers
 *  secret (TICKETMASTER_PURGE_SECRET) rather than the GitHub-Actions-only
 *  DEPLOY_CHECK_SECRET pattern used elsewhere in this file's neighbors.
 *  Builds the SAME cache key handleTicketmasterImage() would have used
 *  (the full /img/ticketmaster?u=... request URL) so cache.delete() finds
 *  the right entry without needing a second lookup table. */
export async function handleTicketmasterImagePurge(
  request: Request,
  env: TicketmasterImageEnv,
  cacheStorage: CacheStorage = caches,
): Promise<Response> {
  if (!env.TICKETMASTER_PURGE_SECRET) {
    return new Response('Purge not configured', { status: 403 });
  }
  if (request.headers.get('X-BV-Purge-Secret') !== env.TICKETMASTER_PURGE_SECRET) {
    return new Response('Forbidden', { status: 403 });
  }

  const originalUrl = new URL(request.url).searchParams.get('u');
  if (!originalUrl) {
    return new Response('Missing u parameter', { status: 400 });
  }
  let parsedOriginal: URL;
  try {
    parsedOriginal = new URL(originalUrl);
  } catch {
    return new Response('Invalid u parameter', { status: 400 });
  }
  if (!ALLOWED_HOSTS.has(parsedOriginal.hostname)) {
    return new Response('Host not allowed', { status: 400 });
  }

  const cacheKeyUrl = new URL(request.url);
  cacheKeyUrl.pathname = '/img/ticketmaster';
  cacheKeyUrl.search = `?u=${encodeURIComponent(parsedOriginal.toString())}`;
  const deleted = await cacheStorage.default.delete(new Request(cacheKeyUrl.toString()));
  return new Response(deleted ? 'Purged' : 'Not cached', { status: deleted ? 200 : 404 });
}
