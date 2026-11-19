/**
 * Which event stories count as an event that took place (owner Beslut 8, 2026-11-19). A recurring event is merged into a series story
 * (event-series-<hash>) and every dated occurrence (event-<id>) gets superseded_by_slug = that series; the series' own occurs_at is its
 * NEXT occurrence. Counting "superseded_by_slug IS NULL" therefore dropped every past occurrence and put the series once in the
 * current week (Moreno Valley 3 Aug-6 Sep 2026: 142 of 143 published event stories superseded, the week of 9 Nov 8 counted and 23
 * dropped).
 *   counted: event-<id> not superseded, or superseded by a series (it is one occurrence of that series);
 *   not counted: event-<id> superseded by another event-<id> (a cross-source duplicate, scripts/merge_cross_source_event_duplicates.py),
 *                and every series row itself (its occurrences are counted instead).
 * Counts only: what a page LISTS is not changed by this (owner: "Rätta bara räkningen nu").
 * No imports, so astro.config.mjs (the /month/ sitemap mirror) and lib/db.ts use the same rule. Types: event-occurrence.d.mts.
 */
export const SERIES_SLUG_PREFIX = 'event-series-';

export function isCountedOccurrence(row) {
  if (typeof row.slug !== 'string' || row.slug.startsWith(SERIES_SLUG_PREFIX)) return false;
  const by = row.superseded_by_slug;
  return by == null || (typeof by === 'string' && by.startsWith(SERIES_SLUG_PREFIX));
}
