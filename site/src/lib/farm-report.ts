/** Pure logic behind /farm-report's direction/trend display -- split out
 *  from the .astro file so it's unit-testable independent of Astro's build
 *  pipeline (same pattern as event-jsonld.ts/article-jsonld.ts). See
 *  NEEDS-HUMAN-REVIEW.md "Brookings — Farm Report Depth".
 */
import type { AgPriceSeries } from './db';

export const COMMODITY_LABELS: Record<string, string> = {
  corn: 'Corn',
  soybeans: 'Soybeans',
  wheat: 'Wheat',
  sunflowers: 'Sunflowers',
  oats: 'Oats',
  cattle: 'Cattle',
  hogs: 'Hogs',
};

export function commodityLabel(commodity: string): string {
  return COMMODITY_LABELS[commodity] ?? commodity;
}

export interface DeltaDisplay {
  direction: 'up' | 'down' | 'flat';
  text: string;
}

/** current/previous are real stored prices -- never computed against a
 *  guessed or interpolated point. Rounds to the same 2-decimal precision
 *  the price itself displays at, so a true but sub-cent difference doesn't
 *  render as a misleading "no change" -- see NEEDS-HUMAN-REVIEW.md for the
 *  brief's explicit ask that a real 0.00 delta reads as "no change," not a
 *  fake up/down arrow. */
export function formatDelta(current: number, previous: number): DeltaDisplay {
  const diff = Math.round((current - previous) * 100) / 100;
  if (diff === 0) return { direction: 'flat', text: 'no change' };
  const sign = diff > 0 ? '+' : '';
  return {
    direction: diff > 0 ? 'up' : 'down',
    text: `${sign}${diff.toFixed(2)}`,
  };
}

/** A compact SVG <path> `d` string for a simple line sparkline over
 *  `prices` (chronological). No library -- a sparkline is just a polyline
 *  over normalized points, and pulling in a charting dependency for this
 *  would be the kind of premature machinery this project avoids elsewhere.
 *  Returns null for fewer than 2 points (nothing to draw a line between). */
export function sparklinePath(prices: number[], width: number, height: number): string | null {
  if (prices.length < 2) return null;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min;
  const points = prices.map((p, i) => {
    const x = (i / (prices.length - 1)) * width;
    // range===0 (a perfectly flat series) would divide by zero -- draw a
    // flat middle line instead, an honest representation of "no movement."
    const y = range === 0 ? height / 2 : height - ((p - min) / range) * height;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  return `M${points.join(' L')}`;
}

export interface SeriesDisplay {
  commodity: string;
  label: string;
  price: string;
  unit: string | null;
  asOf: string;
  momDelta: (DeltaDisplay & { comparedTo: string }) | null;
  yoyDelta: (DeltaDisplay & { comparedTo: string }) | null;
  rangeText: string | null;
  sparkline: { path: string | null; points: number[] };
}

/** Builds everything the template needs for one commodity card from a raw
 *  AgPriceSeries -- keeps the .astro frontmatter to just calling this and
 *  rendering, same "logic out, markup stays thin" split as the rest of the
 *  codebase's testable-module pattern. `monthYearFormatter` is injected
 *  (rather than imported directly) so this module has no dependency on
 *  Astro's import.meta.env-touching db.ts, matching event-jsonld.ts's own
 *  approach to staying testable without a live DATABASE_URL. */
export function buildSeriesDisplay(
  series: AgPriceSeries,
  monthYearFormatter: (value: string) => string
): SeriesDisplay | null {
  if (!series.latest) return null;  // no real data at all -- nothing to show, never a placeholder
  const latest = series.latest;

  const momDelta = series.previous
    ? { ...formatDelta(latest.price, series.previous.price),
        comparedTo: monthYearFormatter(series.previous.as_of) }
    : null;
  const yoyDelta = series.yearAgo
    ? { ...formatDelta(latest.price, series.yearAgo.price),
        comparedTo: monthYearFormatter(series.yearAgo.as_of) }
    : null;
  const prices = series.history.map((h) => h.price);

  return {
    commodity: series.commodity,
    label: commodityLabel(series.commodity),
    price: latest.price.toFixed(2),
    unit: series.unit,
    asOf: monthYearFormatter(latest.as_of),
    momDelta,
    yoyDelta,
    rangeText: series.rangeMin !== null && series.rangeMax !== null && series.history.length >= 2
      ? `${series.rangeMin.toFixed(2)}–${series.rangeMax.toFixed(2)}`
      : null,
    sparkline: { path: sparklinePath(prices, 120, 32), points: prices },
  };
}
