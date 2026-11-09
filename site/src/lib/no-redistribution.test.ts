// Sportmonks' written terms (ticket Sportmonks-114845, .claude/sources/sportmonks.md): raw data may be shown on pages, never passed on.
// Until an ICS/JSON/RSS export of sport_events exists, no feed file may read sport_events at all; when one is built it must filter with
// isRedistributable() and this test is where that is changed on purpose.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isRedistributable, NO_REDISTRIBUTION } from './sports-registry.generated';

const SRC = join(__dirname, '..');
const READS_SPORT_EVENTS = /sport_events|getSportEvents|getClubGames|sport-events|sport-games|club-games/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('sports data from sources that forbid redistribution', () => {
  it('sportmonks is listed and filtered', () => {
    expect(NO_REDISTRIBUTION).toContain('sportmonks');
    expect(isRedistributable('sportmonks')).toBe(false);
    expect(isRedistributable('internal')).toBe(true);
  });

  it('no feed or endpoint (ICS, JSON, RSS, sitemap-like .ts routes) reads sport_events', () => {
    const feeds = walk(join(SRC, 'pages')).filter((f) => /\.(ts|js)$/.test(f) && !/\.test\./.test(f));
    feeds.push(join(SRC, 'lib', 'ics.ts'));
    const offenders = feeds.filter((f) => READS_SPORT_EVENTS.test(readFileSync(f, 'utf8'))).map((f) => f.slice(SRC.length + 1));
    expect(offenders).toEqual([]);
  });
});
