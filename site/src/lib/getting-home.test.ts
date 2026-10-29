import { describe, expect, it } from 'vitest';
import { GETTING_HOME, GETTING_HOME_MAX_AGE_DAYS, gettingHomeFor } from './getting-home';

describe('gettingHomeFor', () => {
  it('has a block for Glasgow only, with an official source link and a checked date', () => {
    expect(GETTING_HOME.map((g) => g.townId)).toEqual(['glasgow']);
    const g = GETTING_HOME[0];
    expect(g.subway.sourceUrl).toMatch(/^https:\/\/www\.spt\.co\.uk\//);
    expect(g.rail.plannerUrl).toMatch(/^https:\/\/www\.scotrail\.co\.uk\//);
    expect(g.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(g.subway.lastTrains.length).toBeGreaterThan(0);
  });
  it('returns the block while it is fresh and drops it when it is stale', () => {
    expect(gettingHomeFor('glasgow', new Date('2026-11-05T12:00:00Z'))?.townId).toBe('glasgow');
    const stale = new Date(Date.parse('2026-10-29T12:00:00Z') + (GETTING_HOME_MAX_AGE_DAYS + 1) * 86_400_000);
    expect(gettingHomeFor('glasgow', stale)).toBeNull();
  });
  it('is null for towns without a block', () => {
    expect(gettingHomeFor('brookings_sd', new Date('2026-10-30T00:00:00Z'))).toBeNull();
  });
});
