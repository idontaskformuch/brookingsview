/** Shared home-sales logic: address slugging, ZIP extraction, the outlier
 *  threshold, and digest-slug construction -- used by both the existing
 *  /home-sales listing page and the new per-address permalink pages (see
 *  NEEDS-HUMAN-REVIEW.md, "Week 4 -- Home Sales Address Pages") so they
 *  never compute the same facts two different ways.
 */

/** Matches ai_pipeline/home_sales_digest.py's OUTLIER_PRICE_FLOOR --
 *  duplicated across languages deliberately, same tradeoff this codebase
 *  already makes for venue_registry.py/db.ts's normalize_venue(). */
export const OUTLIER_PRICE_FLOOR = 150_000;

export function isOutlierSale(price: number | null): boolean {
  return price != null && price > 0 && price < OUTLIER_PRICE_FLOOR;
}

/** 6 of 2,610 real rows (0.2%) came in mixed-case from the same import
 *  batch ("10426 Sparrow CT" instead of "10426 SPARROW CT") -- normalized
 *  at render time rather than a data migration for so small a share. */
export function titleCaseAddress(address: string | null): string {
  if (!address) return '—';
  return address.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

export function extractZip(address: string | null): string {
  const match = address?.match(/\b(\d{5})\b\s*$/);
  return match ? match[1] : '';
}

/**
 * A stable, human-readable slug from the street-address portion only (the
 * city/ZIP tail after the first comma is dropped -- it's redundant with the
 * page's own town scoping and the ZIP is already shown separately). Checked
 * against all 2,409 real distinct-PIN addresses in Moreno Valley's data
 * before shipping: zero collisions -- a real street address is unique
 * within a town by construction (how mail delivery and property records
 * both already rely on it), so no PIN suffix is appended for readability.
 */
export function slugifyAddress(address: string): string {
  return address
    .toLowerCase()
    .replace(/,.*$/, '')
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The monthly digest story slug for a given sale_date -- matches
 *  ai_pipeline/home_sales_digest.py's `f"home-sales-digest-{year}-{month:02d}"`
 *  exactly. Callers must still confirm the story exists (not every month
 *  in the raw sales data necessarily has a published digest) before
 *  linking to it -- this only computes the slug it WOULD have. */
export function digestSlugForSaleDate(saleDate: string): string {
  const d = new Date(saleDate);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `home-sales-digest-${year}-${month}`;
}

/** Individual per-parcel sale pages age out of indexing after this many
 *  months -- Moreno Valley's sitemap was carrying 3,756 URLs (vs.
 *  Brookings' 471) almost entirely from these pages. A named constant, not
 *  a magic number inline in the page/sitemap logic, so the threshold can
 *  be found and tuned in one place. Mirrored (duplicated, not imported --
 *  see astro.config.mjs) in the sitemap filter, since that file runs
 *  before Vite's module graph exists. Keep both in sync. */
export const HOME_SALES_INDEXABLE_MONTHS = 6;

/**
 * Whether a per-parcel sale page should stay indexable, based on its MOST
 * RECENT recorded sale (a parcel page shows full sale history, not one
 * page per sale -- see home-sales/[slug].astro's own doc comment -- so
 * "age" is the age of the newest sale at that address, not the oldest).
 * Computed fresh from sale_date vs. now on every build/request -- never a
 * static flag stored at insert time, which would go stale as the page ages
 * without a corresponding rebuild-time recheck.
 */
export function isSaleDateIndexable(saleDate: string | Date | null, now: Date = new Date()): boolean {
  if (!saleDate) return false;
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - HOME_SALES_INDEXABLE_MONTHS);
  return new Date(saleDate) >= cutoff;
}
