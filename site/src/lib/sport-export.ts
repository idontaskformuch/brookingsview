/** The ONLY way sport_events rows may reach an export or feed (ICS, JSON, RSS, a public API route). Sportmonks' written terms
 *  (ticket Sportmonks-114845, .claude/sources/sportmonks.md) forbid passing its raw data on; config/sports.json `noRedistribution` lists
 *  such sources. Fail closed: a row with no source, or a source on that list, never gets through. Pages may still show every row.
 *  Feed builders get rows from db.ts's getExportableSportEvents(), which calls this; no-redistribution.test.ts fails on any other route. */
import { isRedistributable } from './sports-registry.generated';

export function exportableSportEvents<T extends { source?: string | null }>(rows: T[]): T[] {
  return rows.filter((r) => typeof r.source === 'string' && r.source !== '' && isRedistributable(r.source));
}
