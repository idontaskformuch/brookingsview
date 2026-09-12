// Render-window handoff, Phase 5: 410 Gone (not 404) for a home-sales
// parcel page that USED to build and no longer does, because its most
// recent recorded sale fell outside the render window (see
// lib/render-window.ts and NEEDS-HUMAN-REVIEW.md #47). A 410 tells Google
// the removal is intentional and gets it deregistered faster than a 404,
// which Google treats as possibly-temporary.
//
// DESIGN: a LIVE query at request time, not a precomputed/diffed list
// generated at deploy time. The spec's own suggested approach (diff the
// previous build manifest against the new one) needs a "previous build"
// to persist across CI runs, which this project's workflows don't cache
// or retain -- a live query instead needs no new deploy-time step, no new
// generated-file-staying-in-sync concern (see wrangler.jsonc's own scars
// from exactly that pattern with BRAND_TOKENS etc.), and is naturally
// self-correcting as the window keeps moving forward every day, not just
// on the one day it was enabled. Only runs on the (rare) 404 case for a
// /home-sales/<slug>/ path -- every real, currently-in-window page is
// served straight from ASSETS with zero extra query.
//
// slugifyAddress mirrors site/src/lib/home-sales.ts's own function
// exactly -- same duplication tradeoff as astro.config.mjs's own copy of
// it (this server/ Worker bundle is built independently of the Astro
// site, see _shared.ts's own comment on why importing across that
// boundary isn't done here).
export function slugifyAddress(address: string): string {
  return address
    .toLowerCase()
    .replace(/,.*$/, '')
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const NON_PARCEL_SEGMENTS = new Set(['', 'archive', 'zip']);

/** Returns the requested slug if `pathname` looks like a parcel detail
 *  route (/home-sales/<slug>/), or null for the aggregate table, the
 *  archive, or a ZIP facet -- none of those are ever "gone" in the sense
 *  this module cares about (they always render, even with zero results
 *  in the window, per home-sales.astro's own empty-state handling). Pure,
 *  no request/DB involved -- the actual DB check only runs for a real
 *  candidate slug. */
export function homeSalesParcelSlugFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/home-sales\/([^/]+)\/?$/);
  if (!match) return null;
  const [, segment] = match;
  return NON_PARCEL_SEGMENTS.has(segment) ? null : segment;
}

/** `querySales` is injected (not a bare `env` param) so this stays testable
 *  with a fake in-memory data set -- same dependency-injection shape this
 *  module's own test file uses, rather than needing a real Neon
 *  connection to exercise the matching logic. Checks ALL distinct
 *  addresses ever recorded for the town (not just ones inside the
 *  window): a slug that never existed at all is a genuine 404, not a 410
 *  -- this function answers "did this parcel exist at some point," the
 *  caller already knows the window excluded it today (that's WHY the
 *  static asset 404'd in the first place). */
export async function wasHomeSalesParcelEverRecorded(
  slug: string,
  townId: string,
  querySales: (townId: string) => Promise<{ address: string | null }[]>,
): Promise<boolean> {
  const rows = await querySales(townId);
  return rows.some((r) => r.address && slugifyAddress(r.address) === slug);
}
