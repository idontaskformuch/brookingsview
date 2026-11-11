// Sportmonks' written terms (ticket Sportmonks-114845, .claude/sources/sportmonks.md): raw data may be shown on pages, never passed on.
// Rule (owner 2026-11-11): an export or feed (ICS, JSON, RSS, a public API route, a sitemap-like .ts route) may get sport_events rows ONLY from
// db.ts's getExportableSportEvents(), which filters through lib/sport-export.ts. Any other way of reading sport_events in a feed builder fails here.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exportableSportEvents } from './sport-export';
import { isRedistributable, NO_REDISTRIBUTION } from './sports-registry.generated';

const SRC = join(__dirname, '..');
const READS_SPORT_EVENTS = /sport_events|getSportEvents|getClubGames|getSeasonGames|getUpcomingGames|sport-events|sport-games|club-games|SportEventRow/;
/** The only identifiers a feed builder may use to touch sport events. */
const FILTERED_PATH = /getExportableSportEvents|exportableSportEvents|ExportableSportEvent|['"]\.\/sport-export['"]|['"]\.\.\/lib\/sport-export['"]/g;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** True when `code` reaches sport_events by any route other than the filtered one. */
export function readsSportEventsUnfiltered(code: string): boolean {
  return READS_SPORT_EVENTS.test(code.replace(FILTERED_PATH, ''));
}

/** Every file that builds a feed or export: .ts/.js routes under pages/ (ICS, RSS, JSON, sitemap, manifest ...) and lib modules named like one. */
function feedBuilders(): string[] {
  const routes = walk(join(SRC, 'pages')).filter((f) => /\.(ts|js)$/.test(f) && !/\.test\./.test(f));
  const libs = readdirSync(join(SRC, 'lib')).filter((n) => /(ics|rss|feed|export|sitemap)/i.test(n) && /\.(ts|js|mjs)$/.test(n) && !/\.test\./.test(n) && n !== 'sport-export.ts');
  return [...routes, ...libs.map((n) => join(SRC, 'lib', n))];
}

describe('sports data from sources that forbid redistribution', () => {
  it('sportmonks is listed and filtered', () => {
    expect(NO_REDISTRIBUTION).toContain('sportmonks');
    expect(isRedistributable('sportmonks')).toBe(false);
    expect(isRedistributable('internal')).toBe(true);
  });

  it('exportableSportEvents drops Sportmonks rows and fails closed on a missing source', () => {
    const rows = [{ id: 1, source: 'sportmonks' }, { id: 2, source: 'sidearm' }, { id: 3, source: 'internal' }, { id: 4, source: '' }, { id: 5, source: null }, { id: 6 }];
    expect(exportableSportEvents(rows).map((r) => r.id)).toEqual([2, 3]);
  });

  it('no feed or export builder reaches sport_events except through getExportableSportEvents', () => {
    const builders = feedBuilders();
    expect(builders.length).toBeGreaterThan(5); // the scan really sees the routes
    const offenders = builders.filter((f) => readsSportEventsUnfiltered(readFileSync(f, 'utf8'))).map((f) => f.slice(SRC.length + 1));
    expect(offenders).toEqual([]);
  });

  it('the scan catches an unfiltered reader and lets the filtered one through (self-check of the rule)', () => {
    expect(readsSportEventsUnfiltered("import { getSportEvents } from '../lib/db';")).toBe(true);
    expect(readsSportEventsUnfiltered("import { getClubGames } from '../../lib/db';")).toBe(true);
    expect(readsSportEventsUnfiltered("const r = await sql`SELECT * FROM sport_events`;")).toBe(true);
    expect(readsSportEventsUnfiltered("import { getSeasonGames } from '../lib/db';")).toBe(true);
    expect(readsSportEventsUnfiltered("import { getExportableSportEvents } from '../lib/db'; const rows = await getExportableSportEvents('sdsu');")).toBe(false);
    // using the filtered call must not excuse an additional raw read in the same file
    expect(readsSportEventsUnfiltered("import { getExportableSportEvents, getSportEvents } from '../lib/db';")).toBe(true);
  });

  it('getExportableSportEvents in db.ts selects the source and runs the rows through the filter before returning', () => {
    const db = readFileSync(join(SRC, 'lib', 'db.ts'), 'utf8');
    const start = db.indexOf('export async function getExportableSportEvents');
    expect(start).toBeGreaterThan(0);
    const body = db.slice(start, db.indexOf('\n}\n', start));
    expect(body).toMatch(/SELECT id, source, source_uid/);
    expect(body).toMatch(/return exportableSportEvents\(/);
  });
});
