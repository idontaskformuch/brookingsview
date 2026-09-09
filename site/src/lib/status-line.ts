/** Shared "collapse quiet items into one sentence" helper -- sitewide
 *  presentation-layer pass, rule R1 ("all-clear collapses to one line").
 *  Extracted from lib/cityStatus.ts's own joinWithOr(), which built this
 *  exact shape for the front page's CityStatus strip first ("No alerts,
 *  closures or traffic incidents"). Pulled out here so TodayBlock.astro
 *  (and any future page that needs the same "several quiet things -> one
 *  clause" behavior) doesn't reimplement it a second time -- see
 *  cityStatus.ts's own applyVisibilityRules() for the fuller pattern this
 *  is one piece of (drop quiet items unless ALL are quiet, then
 *  consolidate). Pure string formatting, no I/O -- safe to share across
 *  both call sites without pulling in cityStatus.ts's DB-backed resolvers. */

/** Joins 1+ noun phrases into one clause: "a"; "a or b"; "a, b or c". */
export function joinWithOr(items: string[]): string {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} or ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}
