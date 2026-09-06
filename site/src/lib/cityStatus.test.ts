import { describe, expect, it } from 'vitest';
import { applyVisibilityRules, oldestAsOf, validateStatusModules, type CityStatusModule } from './cityStatus';
import type { SiteConfig } from './site-config';

/** validateStatusModules()/applyVisibilityRules()/oldestAsOf() are the pure
 *  parts of CityStatus (lib/cityStatus.ts) -- the resolvers themselves need
 *  a live DB and aren't unit-tested here, same convention as this
 *  codebase's other DB-touching lib/db.ts functions (see getEmployerJobStats
 *  etc., which also have no dedicated test file).
 */

function m(id: string, tone: CityStatusModule['tone'], asOf = new Date('2026-09-06T12:00:00Z')): CityStatusModule {
  return { id, icon: 'x', label: id, value: 'v', tone, asOf };
}

function baseCfg(overrides: Partial<SiteConfig> = {}): SiteConfig {
  return {
    townId: 'brookings_sd', cityName: 'Brookings', stateName: 'South Dakota', stateAbbr: 'SD',
    brandLead: 'Brookings', brandTail: 'View', siteName: 'Brookings View', domain: 'brookingsview.com',
    siteUrl: 'https://brookingsview.com', timezone: 'America/Chicago', description: 'd', sourceBlurb: 's',
    removalEmail: 'hello@brookingsview.com',
    ...overrides,
  } as SiteConfig;
}

describe('validateStatusModules', () => {
  it('accepts a real, fully-backed module list', () => {
    expect(() => validateStatusModules(baseCfg({ statusModules: ['weather', 'alerts', 'next_meeting'] })))
      .not.toThrow();
  });

  it('an unknown module id fails loudly', () => {
    expect(() => validateStatusModules(baseCfg({ statusModules: ['weather', 'made_up_module'] })))
      .toThrow(/unknown module id/);
  });

  it('an always-rendered module configured with no real source fails loudly', () => {
    // events_today is always-rendered and needs hasEventsSource -- omitted here.
    expect(() => validateStatusModules(baseCfg({ statusModules: ['weather', 'events_today'] })))
      .toThrow(/no real source/);
  });

  it('a conditional module needs no capability flag to be listed', () => {
    // alerts/traffic are conditional -- they don't gate the ALWAYS_RENDERED
    // check even without trafficSource/hasClosureWatch set.
    expect(() => validateStatusModules(baseCfg({ statusModules: ['weather', 'alerts', 'traffic'] })))
      .not.toThrow();
  });

  it('an empty or missing statusModules array is always valid (component disabled)', () => {
    expect(() => validateStatusModules(baseCfg({ statusModules: [] }))).not.toThrow();
    expect(() => validateStatusModules(baseCfg({}))).not.toThrow();
  });
});

describe('applyVisibilityRules', () => {
  it('always-rendered modules pass through regardless of tone', () => {
    const result = applyVisibilityRules([m('weather', 'quiet'), m('next_meeting', 'quiet')]);
    expect(result.map((r) => r.id)).toEqual(['weather', 'next_meeting']);
  });

  it('a non-quiet conditional module is rendered on its own', () => {
    const result = applyVisibilityRules([m('weather', 'quiet'), m('alerts', 'alert')]);
    expect(result.map((r) => r.id)).toEqual(['weather', 'alerts']);
  });

  it('a quiet conditional module is dropped when at least one other conditional module is non-quiet', () => {
    const result = applyVisibilityRules([m('alerts', 'quiet'), m('traffic', 'notice')]);
    expect(result.map((r) => r.id)).toEqual(['traffic']);
  });

  it('renders exactly one consolidated line when EVERY conditional module is quiet', () => {
    const result = applyVisibilityRules([m('weather', 'quiet'), m('alerts', 'quiet'), m('traffic', 'quiet')]);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('weather');
    expect(result[1].id).toBe('consolidated');
    expect(result[1].value).toBe('No alerts or traffic incidents');
  });

  it('the consolidated line never renders when no conditional module is present at all', () => {
    const result = applyVisibilityRules([m('weather', 'quiet'), m('next_meeting', 'quiet')]);
    expect(result.some((r) => r.id === 'consolidated')).toBe(false);
  });

  it('the consolidated line joins three quiet nouns with a final "or", not an Oxford comma', () => {
    const result = applyVisibilityRules([
      m('alerts', 'quiet'), m('closures', 'quiet'), m('traffic', 'quiet'),
    ]);
    expect(result[0].value).toBe('No alerts, closures or traffic incidents');
  });
});

describe('oldestAsOf', () => {
  it('returns the earliest asOf among the given modules', () => {
    const early = new Date('2026-09-06T08:00:00Z');
    const late = new Date('2026-09-06T14:00:00Z');
    expect(oldestAsOf([m('weather', 'quiet', late), m('alerts', 'quiet', early)])).toEqual(early);
  });

  it('returns null for an empty module list', () => {
    expect(oldestAsOf([])).toBeNull();
  });
});
