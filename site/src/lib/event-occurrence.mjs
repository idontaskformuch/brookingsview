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

function localDayKey(instant, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instant));
}

/**
 * The event rows a LIST of days shows (/this-week/<week>/ and its thin-week count, /events/past/; owner 2026-11-19 "rätta med
 * lib/event-occurrence.mjs"). The counted occurrences above, plus a series row only where none of its own occurrences falls on the
 * series' date (local day in `timeZone`): a series whose scraper never wrote dated occurrences (Brookings 13 of 24 series, Glasgow
 * 10 of 10, 19 Nov 2026) would otherwise vanish from the week it happens in, while a series dated at its next occurrence that IS
 * an occurrence row (Moreno event-series-420a9ebc7c2214bd 23 Nov = event-6216) would be listed twice. /month/ keeps the stricter
 * isCountedOccurrence (series rows never), since a series' date is its NEXT occurrence, never a past month.
 * Order is kept. Rows without occurs_at are kept as they are (callers decide: /events/past/ lists them as undated).
 */
export function listedEventRows(rows, timeZone) {
  const covered = new Set();
  for (const r of rows) {
    if (r.occurs_at && isCountedOccurrence(r) && typeof r.superseded_by_slug === 'string') {
      covered.add(`${r.superseded_by_slug}|${localDayKey(r.occurs_at, timeZone)}`);
    }
  }
  return rows.filter((r) => {
    if (isCountedOccurrence(r)) return true;
    if (typeof r.slug !== 'string' || !r.slug.startsWith(SERIES_SLUG_PREFIX) || r.superseded_by_slug) return false;
    return !r.occurs_at || !covered.has(`${r.slug}|${localDayKey(r.occurs_at, timeZone)}`);
  });
}
