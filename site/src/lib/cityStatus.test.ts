import { describe, expect, it } from 'vitest';
import {
  applyVisibilityRules, oldestAsOf, validateStatusModules, buildWhatsOnStatus, type CityStatusModule,
} from './cityStatus';
import type { SiteConfig } from './site-config';
import type { TicketmasterFeedItem, TicketmasterEvent } from './ticketmaster';

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

  it('whats_on needs no capability flag to be listed -- unlike events_today, it is not always-rendered, since its real capability (hasWhatsOn) is false everywhere today', () => {
    expect(() => validateStatusModules(baseCfg({ statusModules: ['weather', 'whats_on'] })))
      .not.toThrow();
    expect(() => validateStatusModules(baseCfg({ statusModules: ['weather', 'whats_on'], hasWhatsOn: true })))
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

/** buildWhatsOnStatus() is pure (takes an already-fetched feed, never
 *  touches the network/DB itself) -- unlike this file's other resolvers
 *  (see this file's own module comment above), that makes it directly
 *  unit-testable with synthetic data, the same way collapseMarqueeRuns()/
 *  splitMarquee() in whats-on.test.ts are. */
describe('buildWhatsOnStatus (What\'s On Phase 6a)', () => {
  function tmEvent(overrides: Partial<TicketmasterEvent> = {}): TicketmasterEvent {
    return {
      id: 'tm-1', title: 'Untitled Event', attractionId: null, venueId: null, venueName: null,
      venueLatitude: null, venueLongitude: null, venueAddress: null,
      venueCity: null, venueStateCode: null, venuePostalCode: null,
      venueDistanceMiles: null, ticketUrl: 'https://ticketmaster.com/event/x',
      imageUrl: null, imageWidth: null, imageHeight: null,
      priceRangeText: null, priceMin: null, priceMax: null, priceCurrency: null,
      ...overrides,
    };
  }

  function tmItem(occurs_at: string | null, overrides: Partial<TicketmasterEvent> = {}): TicketmasterFeedItem {
    return { sourceKind: 'ticketmaster', occurs_at, ticketmasterEvent: tmEvent(overrides) };
  }

  it('renders nothing when hasWhatsOn is off, even with a real feed -- the same flag /whats-on/ itself checks, not a second one', () => {
    const items = [tmItem('2026-10-24T19:00:00Z', { id: 'a', title: 'Zac Brown Band' })];
    expect(buildWhatsOnStatus(items, baseCfg({ hasWhatsOn: false }))).toBeNull();
    expect(buildWhatsOnStatus(items, baseCfg({}))).toBeNull();
  });

  it('renders nothing when hasWhatsOn is on but the feed is empty -- no placeholder, no heading with nothing under it', () => {
    expect(buildWhatsOnStatus([], baseCfg({ hasWhatsOn: true }))).toBeNull();
  });

  it('renders the single top-ranked event with hasWhatsOn on and a real feed', () => {
    const items = [
      tmItem('2026-10-10T18:00:00Z', {
        id: 'small', title: 'DECAYSTATE', venueName: 'Icon Events & Dada Gastropub', venueId: 'rZ7HnEZ178xxA',
      }),
      tmItem('2026-10-24T19:00:00Z', {
        id: 'large', title: 'Zac Brown Band', venueName: 'Denny Sanford PREMIER Center', venueId: 'KovZpZAJAl7A',
      }),
    ];
    const mod = buildWhatsOnStatus(items, baseCfg({ hasWhatsOn: true }));
    expect(mod).not.toBeNull();
    expect(mod!.id).toBe('whats_on');
    expect(mod!.label).toBe("What's On");
    expect(mod!.tone).toBe('quiet');
    expect(mod!.href).toBe('/whats-on/');
    // large-tier Zac Brown Band outranks small-tier DECAYSTATE regardless of date --
    // and only ONE event shows, a true marquee (see buildWhatsOnStatus()'s own
    // comment on why this was revised down from a 3-entry joined line).
    expect(mod!.value).toBe('Zac Brown Band');
  });

  it('shows exactly one event even when several are ranked', () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      tmItem(`2026-10-1${i}T18:00:00Z`, { id: `e${i}`, title: `Event ${i}`, venueName: 'Denny Sanford PREMIER Center', venueId: 'KovZpZAJAl7A' }));
    const mod = buildWhatsOnStatus(items, baseCfg({ hasWhatsOn: true }));
    expect(mod!.value).toBe('Event 0'); // soonest of the tied-tier events
  });

  it('when the top-ranked item belongs to a multi-date run, shows the run\'s SOONEST member -- proving buildWhatsOnStatus is wired through collapseMarqueeRuns(), not a bare ranked[0]', () => {
    const runStops = [
      tmItem('2026-12-06T19:00:00Z', {
        id: 'stop2', title: 'Disney On Ice presents Find Your Hero',
        attractionId: 'K8vZ9172HM0', venueId: 'KovZpZAJAl7A', venueName: 'Denny Sanford PREMIER Center',
      }),
      tmItem('2026-12-05T16:00:00Z', {
        id: 'stop1', title: 'Disney On Ice presents Find Your Hero',
        attractionId: 'K8vZ9172HM0', venueId: 'KovZpZAJAl7A', venueName: 'Denny Sanford PREMIER Center',
      }),
    ];
    const mod = buildWhatsOnStatus(runStops, baseCfg({ hasWhatsOn: true }));
    expect(mod!.value).toBe('Disney On Ice presents Find Your Hero');
    expect(mod!.asOf).toEqual(new Date('2026-12-05T16:00:00Z')); // stop1, the soonest -- not stop2
  });

  it('shows a real distance label for an out-of-town venue -- the anti-doorway-pattern requirement', () => {
    const items = [tmItem('2026-10-24T19:00:00Z', {
      id: 'a', title: 'Washington Pavilion Show', venueDistanceMiles: 50.06,
    })];
    const mod = buildWhatsOnStatus(items, baseCfg({ hasWhatsOn: true, cityName: 'Brookings' }));
    expect(mod!.value).toBe('Washington Pavilion Show (~50 miles away)');
  });

  it('shows "In <city>" for a venue within the in-town threshold, never a fabricated small mileage', () => {
    const items = [tmItem('2026-10-24T19:00:00Z', {
      id: 'a', title: 'Dana J. Dykhouse Stadium Show', venueDistanceMiles: 3.57,
    })];
    const mod = buildWhatsOnStatus(items, baseCfg({ hasWhatsOn: true, cityName: 'Brookings' }));
    expect(mod!.value).toBe('Dana J. Dykhouse Stadium Show (In Brookings)');
  });

  it('omits the distance suffix entirely when Discovery API had no venue distance at all -- never fabricates one', () => {
    const items = [tmItem('2026-10-24T19:00:00Z', { id: 'a', title: 'No Venue Data Show', venueDistanceMiles: null })];
    const mod = buildWhatsOnStatus(items, baseCfg({ hasWhatsOn: true }));
    expect(mod!.value).toBe('No Venue Data Show');
  });
});
