import { describe, expect, it } from 'vitest';
import { resolveCluster, validateClusterConfig, computeTownGraph, buildClusterBreadcrumbTrail, resolveHubNavItems, resolveHubBacklink } from './clusters';

const BROOKINGS = { townId: 'brookings_sd', cityName: 'Brookings', siteName: 'Brookings View' } as any;
const MORENO_VALLEY = { townId: 'moreno_valley_ca', cityName: 'Moreno Valley', siteName: 'Moreno Valley View', hasWorkplaceWatch: true, hasClosureWatch: true, hasWhatsOn: true, hasHousingMarket: true } as any;
const BROOMFIELD = { townId: 'broomfield_co', cityName: 'Broomfield', siteName: 'Broomfield View', hasWorkplaceWatch: true, hasWhatsOn: true } as any;

describe('validateClusterConfig', () => {
  it('has no dangling references, duplicate primaries, or over-shared spokes', () => {
    // The real regression this catches: config/clusters.ts's own
    // CLUSTERS/CLUSTER_TOWN_OVERRIDES referencing a route key with no
    // matching ROUTE_AVAILABILITY entry -- a typo'd key would otherwise
    // silently resolve to "always unavailable" everywhere instead of
    // failing loud.
    expect(validateClusterConfig()).toEqual([]);
  });
});

describe('resolveCluster', () => {
  it('resolves a hub to itself with role "hub" and its available spokes as siblings', () => {
    const result = resolveCluster('city-hall', BROOKINGS);
    expect(result?.primary).toEqual({ clusterKey: 'civic', clusterLabel: 'City hall', role: 'hub' });
    expect(result?.siblingSpokes).toContain('city-hall/archive');
  });

  it('resolves a primary spoke with the hub included among its siblings', () => {
    const result = resolveCluster('city-hall/archive', BROOKINGS);
    expect(result?.primary.clusterKey).toBe('civic');
    expect(result?.primary.role).toBe('primary-spoke');
    expect(result?.siblingSpokes).toContain('city-hall');
  });

  it("resolves home-sales' primary cluster as work_and_money with civic as secondary (the handoff's own cross-cluster example)", () => {
    const result = resolveCluster('home-sales', MORENO_VALLEY);
    expect(result?.primary.clusterKey).toBe('work_and_money');
    expect(result?.secondary.map((s) => s.clusterKey)).toContain('civic');
  });

  it('returns null for home-sales in a town where it is not available (Brookings)', () => {
    expect(resolveCluster('home-sales', BROOKINGS)).toBeNull();
  });

  it('returns null for a genuinely unregistered route key (a trust page)', () => {
    expect(resolveCluster('about', BROOKINGS)).toBeNull();
  });

  it("resolves local_life's hub per town identity, not a single shared route", () => {
    expect(resolveCluster('jackrabbits', BROOKINGS)?.primary.clusterKey).toBe('local_life');
    expect(resolveCluster('sports', MORENO_VALLEY)?.primary.clusterKey).toBe('local_life');
    expect(resolveCluster('vail-resorts', BROOMFIELD)?.primary.clusterKey).toBe('local_life');
    // Each hub is exclusively its own town's -- never resolvable as a
    // cluster member for a different town.
    expect(resolveCluster('jackrabbits', MORENO_VALLEY)).toBeNull();
    expect(resolveCluster('sports', BROOKINGS)).toBeNull();
  });

  it('drops a whole cluster for a town whose hub is disabled (work_and_money for Brookings)', () => {
    const graph = computeTownGraph(BROOKINGS);
    expect(graph.clusters.find((c) => c.key === 'work_and_money')).toBeUndefined();
    expect(resolveCluster('workplace-watch', BROOKINGS)).toBeNull();
  });

  it('keeps a cluster whose hub always renders even when locally empty (whats_happening for Broomfield)', () => {
    // events.astro has no gate -- Broomfield having no local events source
    // makes it empty, not disabled. This is the real, code-verified
    // correction to the handoff's own assumption that missing event
    // sources would make a whole cluster fall away.
    const graph = computeTownGraph(BROOMFIELD);
    expect(graph.clusters.find((c) => c.key === 'whats_happening')).toBeDefined();
  });

  it('drops the closures spoke for a town with no Closure Watch (Broomfield) without dropping the getting_around hub', () => {
    const graph = computeTownGraph(BROOMFIELD);
    const gettingAround = graph.clusters.find((c) => c.key === 'getting_around');
    expect(gettingAround).toBeDefined();
    expect(gettingAround?.spokes.some((s) => s.routeKey === 'closures')).toBe(false);
  });

  it('drops Brookings-only local_life spokes (university, play, farm-report) for other towns', () => {
    const graph = computeTownGraph(MORENO_VALLEY);
    const localLife = graph.clusters.find((c) => c.key === 'local_life');
    for (const brookingsOnly of ['university', 'play', 'farm-report']) {
      expect(localLife?.spokes.some((s) => s.routeKey === brookingsOnly)).toBe(false);
    }
  });

  it('never resolves free-things-to-do for any town (no real page exists anywhere)', () => {
    expect(resolveCluster('free-things-to-do', BROOKINGS)).toBeNull();
    expect(resolveCluster('free-things-to-do', MORENO_VALLEY)).toBeNull();
    expect(resolveCluster('free-things-to-do', BROOMFIELD)).toBeNull();
  });
});

describe('buildClusterBreadcrumbTrail', () => {
  it('inserts the cluster hub as a middle crumb for a primary spoke', () => {
    const trail = buildClusterBreadcrumbTrail('city-hall/archive', BROOKINGS, { label: 'Meeting archive', href: '/city-hall/archive/' });
    expect(trail).toEqual([
      { label: 'Home', href: '/' },
      { label: 'City hall', href: '/city-hall/' },
      { label: 'Meeting archive', href: '/city-hall/archive/' },
    ]);
  });

  it('does not insert a redundant middle crumb for a hub page itself', () => {
    const trail = buildClusterBreadcrumbTrail('city-hall', BROOKINGS, { label: 'City hall', href: '/city-hall/' });
    expect(trail).toEqual([
      { label: 'Home', href: '/' },
      { label: 'City hall', href: '/city-hall/' },
    ]);
  });

  it("resolves each town's own local_life hub as the middle crumb, not a shared /sports/ link", () => {
    const trail = buildClusterBreadcrumbTrail('university', BROOKINGS, { label: 'SDSU', href: '/university/' });
    expect(trail[1]).toEqual({ label: 'Local life', href: '/jackrabbits/' });

    const mvTrail = buildClusterBreadcrumbTrail('burro-bonanza', MORENO_VALLEY, { label: 'Burro Bonanza', href: '/burro-bonanza/' });
    expect(mvTrail[1]).toEqual({ label: 'Local life', href: '/sports/' });
  });

  it('leaves an orphan page (trust page, homepage, unavailable route) with the plain two-crumb trail', () => {
    const trail = buildClusterBreadcrumbTrail('about', BROOKINGS, { label: 'About', href: '/about/' });
    expect(trail).toEqual([
      { label: 'Home', href: '/' },
      { label: 'About', href: '/about/' },
    ]);
  });

  it('a page unavailable for this town (home-sales for Brookings) also gets the plain two-crumb trail', () => {
    const trail = buildClusterBreadcrumbTrail('home-sales', BROOKINGS, { label: 'Home sales', href: '/home-sales/' });
    expect(trail).toEqual([
      { label: 'Home', href: '/' },
      { label: 'Home sales', href: '/home-sales/' },
    ]);
  });
});

describe('resolveHubNavItems', () => {
  it("returns a hub's own spokes that have real nav copy, in config authoring order", () => {
    const items = resolveHubNavItems('city-hall', BROOKINGS);
    expect(items.map((i) => i.label)).toEqual(['Meeting archive', 'Active projects']);
  });

  it('skips spokes with no single-page nav copy (detail/story groups) without erroring', () => {
    // civic's primarySpokes also include city-hall/projects/detail,
    // story:meeting and story:meeting_followup -- none of those are in
    // SPOKE_NAV_COPY, and resolveHubNavItems must silently skip them
    // rather than rendering a broken/blank card.
    const items = resolveHubNavItems('city-hall', BROOKINGS);
    expect(items.length).toBe(2);
  });

  it("returns [] for a town's hub that isn't rendering (work_and_money for Brookings)", () => {
    expect(resolveHubNavItems('workplace-watch', BROOKINGS)).toEqual([]);
  });

  it("filters out a town-gated spoke that doesn't apply here (home-sales for Brookings' work_and_money -- N/A; check local_life instead)", () => {
    // Moreno Valley's local_life spokes must not include Brookings-only
    // university/play/farm-report.
    const items = resolveHubNavItems('sports', MORENO_VALLEY);
    const labels = items.map((i) => i.label);
    expect(labels).not.toContain('SDSU');
    expect(labels).not.toContain('Play Jackrabbit');
    expect(labels).toContain('Play Burro Bonanza');
  });

  it("resolves each town's own local_life hub key independently (jackrabbits/sports/vail-resorts)", () => {
    expect(resolveHubNavItems('jackrabbits', BROOKINGS).length).toBeGreaterThan(0);
    expect(resolveHubNavItems('sports', MORENO_VALLEY).length).toBeGreaterThan(0);
    expect(resolveHubNavItems('vail-resorts', BROOMFIELD).length).toBeGreaterThan(0);
    // A local_life hub key that ISN'T this town's own resolves to nothing.
    expect(resolveHubNavItems('sports', BROOKINGS)).toEqual([]);
  });

  it('work_and_money nav for Moreno Valley includes home-sales (available there)', () => {
    const items = resolveHubNavItems('workplace-watch', MORENO_VALLEY);
    expect(items.map((i) => i.label)).toContain('Home sales');
  });
});

describe('resolveHubBacklink', () => {
  it("resolves a spoke's own hub label and href", () => {
    const backlink = resolveHubBacklink('city-hall/archive', BROOKINGS);
    expect(backlink).toEqual({ clusterLabel: 'City hall', hubHref: '/city-hall/' });
  });

  it('returns null for a hub page itself (nothing to link back to)', () => {
    expect(resolveHubBacklink('city-hall', BROOKINGS)).toBeNull();
  });

  it('returns null for an orphan or unavailable route', () => {
    expect(resolveHubBacklink('about', BROOKINGS)).toBeNull();
    expect(resolveHubBacklink('home-sales', BROOKINGS)).toBeNull();
  });

  it("resolves each town's own local_life hub as the backlink target", () => {
    expect(resolveHubBacklink('recipes', BROOKINGS)?.hubHref).toBe('/jackrabbits/');
    expect(resolveHubBacklink('recipes', MORENO_VALLEY)?.hubHref).toBe('/sports/');
    expect(resolveHubBacklink('recipes', BROOMFIELD)?.hubHref).toBe('/vail-resorts/');
  });
});
