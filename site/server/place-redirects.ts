/**
 * Facilities Traffic Pass, 2026-10-03: 301s the retired Broomfield-only
 * /place/[slug] + /places/ URLs to the unified /facilities/[slug] +
 * /facilities/ template every town now uses. Search Console showed no
 * canonical conflict between the two for Broomfield's existing pages, so
 * /facilities/ (the path already live for all three towns) won by this
 * project's own default-to-current-URL rule, not /place/.
 *
 * A pure path-prefix swap, same shape as content-slug-redirects.ts's
 * resolveContentSlugRedirect() -- and for the same reason that file exists
 * rather than importing site/src/lib's equivalent: server/*.ts bundles
 * separately from site/src/* (wrangler's own esbuild vs. Astro/Vite), so
 * there is no site/src counterpart to duplicate here; /place/[slug].astro
 * and /places/index.astro are deleted outright, not just redirected from
 * a surviving Astro page.
 */
export function resolvePlaceRedirect(pathname: string): string | null {
  if (pathname === '/places' || pathname === '/places/') return '/facilities/';
  const match = pathname.match(/^\/place\/([a-z0-9][a-z0-9-]*)\/?$/);
  if (!match) return null;
  return `/facilities/${match[1]}/`;
}
