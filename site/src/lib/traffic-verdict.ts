/** /traffic/ with no current incidents (Broomfield AdSense plan F4, 2026-11-11): the indexable page was an H1 and a source line. Now it
 *  is noindex while nothing is reported and says so in one line with the time of the latest read; with incidents it is indexable.
 *  The page writes its verdict for the sitemap filter in astro.config.mjs (same hand-off file pattern as lib/evening-verdict.ts). */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const TRAFFIC_VERDICT_FILE = '.traffic-verdict.json';

export interface TrafficPageState {
  noindex: boolean;
  /** The plain line shown instead of the table, or null when there are incidents to list. */
  statusLine: string | null;
}

/** `lastReadLabel` is the formatted time of the latest successful read ("4:02 AM MST"), or null when there is none. */
export function trafficPageState(incidentCount: number, cityName: string, lastReadLabel: string | null, quiet = false): TrafficPageState {
  if (incidentCount > 0) return { noindex: quiet, statusLine: null };
  const when = lastReadLabel ? ` as of ${lastReadLabel}` : '';
  return { noindex: true, statusLine: `No crashes or closures reported on state highways in or near ${cityName}${when}.` };
}

export function writeTrafficVerdict(townId: string, indexable: boolean): void {
  try { writeFileSync(resolve(process.cwd(), TRAFFIC_VERDICT_FILE), JSON.stringify({ townId, indexable })); } catch { /* read-only dist: the filter then treats the page as noindex */ }
}
