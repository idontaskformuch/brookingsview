/** Render-window handoff (2026-09). Three concepts that must NEVER
 *  collapse into one:
 *
 *    RETENTION      how long a record is kept in the database.
 *                   Unbounded. This module never touches it -- it has no
 *                   write access to anything, it's a pure predicate.
 *    RENDER WINDOW   how recent a record must be to get a BUILT page.
 *                   SiteConfig.renderWindow, read ONLY here.
 *    INDEX POLICY   whether a built page is indexable (lib/noindex.ts).
 *                   Completely unchanged by this module.
 *
 *  The failure mode this is designed against: a time filter that starts
 *  as a page-generation concern and later gets copied into an ingestion
 *  or backfill script, silently narrowing what ever gets stored. That
 *  can't happen here by construction -- isWithinRenderWindow() is a pure
 *  TypeScript function with no database access, called ONLY from Astro
 *  page frontmatter (getStaticPaths, and -- per the render-window
 *  handoff's own merged Phase 3+4 requirement -- the listing pages that
 *  link into those built pages, e.g. home-sales.astro and its ZIP
 *  facets). Every lib/db.ts query function (getRecentPropertySales(),
 *  getPropertySaleParcels(), etc.) fetches the FULL set, unfiltered --
 *  this module is never imported by db.ts, and can't be imported by any
 *  Python ingestion/backfill/reconcile script at all (different
 *  language, different runtime). A future article-from-the-record-mining
 *  feature reads the database directly, the same as it does today; this
 *  changes what gets built into a page, nothing upstream of that.
 *
 *  KNOWN IMPROVEMENT, not yet built (flagged 2026-09-12, do this before
 *  extending the mechanism to more towns or page types): `cutoff` below
 *  is measured from `new Date()` (the BUILD's own clock), not from the
 *  data's own most recent record. Home sales' first real value (12
 *  months) was tried and reverted the same day it shipped: Riverside
 *  County's own data carries ~11-13 months of built-in reporting lag, so
 *  a window measured against "today" landed almost exactly where the
 *  county's own data runs out, not where a genuinely useful cutoff would
 *  be (see site-config.ts's own comment on homeSales' value for the full
 *  incident). 24 months papers over today's specific lag amount, but
 *  it's a static guess about a data-source property that can itself
 *  drift -- correct fix is to compute the cutoff relative to the record
 *  set's own MAX(date) (or a per-source configured "as of" date) instead
 *  of the wall clock, so it stays correct automatically as a source's
 *  real-world lag changes, rather than repeating this exact incident for
 *  every page type this mechanism is ever extended to.
 */
import type { RenderWindow, SiteConfig } from './site-config';

export type RenderWindowType = keyof RenderWindow;

/** `date` is the record's own relevant date (sale_date for home sales,
 *  meeting_date for meetings, occurs_at for events) -- deliberately not
 *  the whole heterogeneous record, so this stays one small pure function
 *  instead of needing to know every table's shape. A record with no date
 *  at all (data quality gap, not a render-window concern) always passes:
 *  failing OPEN here matches this codebase's "never silently drop real
 *  content" convention elsewhere (resolveImage()'s own never-imageless
 *  fallback, the category-pool hash pick, etc.) -- an unknown date isn't
 *  evidence the record is old, so it isn't grounds to stop building it.
 */
export function isWithinRenderWindow(
  date: string | Date | null | undefined,
  type: RenderWindowType,
  config: Pick<SiteConfig, 'renderWindow'>,
): boolean {
  const months = config.renderWindow[type];
  if (months === null) return true;
  if (!date) return true;

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  return new Date(date) >= cutoff;
}
