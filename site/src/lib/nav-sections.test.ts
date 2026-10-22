import { describe, expect, it } from 'vitest';
import { enabledSections, resolveNav, SECTIONS, type NavConfig, type NavGate } from './nav-sections';
import { ALL_CONFIGS, ALL_SITES } from './site-config';

const BROOKINGS: NavGate = { townId: 'brookings_sd', hasWhatsOn: true, hasClosureWatch: true };
const MORENO: NavGate = { townId: 'moreno_valley_ca', hasWhatsOn: true, hasClosureWatch: true, hasWorkplaceWatch: true };
const BROOMFIELD: NavGate = { townId: 'broomfield_co', hasWhatsOn: true, hasWorkplaceWatch: true };

const BROOKINGS_NAV: NavConfig = {
  tabs: ['today', 'events', 'university', 'jacks', 'cityhall', 'traffic', 'jobs'],
  groups: {
    Now: ['today', 'events', 'whatson', 'thisweek', 'weather', 'vote'],
    Campus: ['university', 'jacks'],
    City: ['cityhall', 'traffic', 'closures', 'facilities'],
    More: ['jobs', 'play', 'farm'],
  },
};

describe('registry == the old nav array (footer links must not change)', () => {
  const hrefs = (c: NavGate) => enabledSections(c).map((s) => s.href);
  it('Brookings', () => expect(hrefs(BROOKINGS)).toEqual(['/today/', '/this-week/', '/events/', '/whats-on/', '/university/', '/jackrabbits/', '/play/',
    '/city-hall/', '/closures/', '/facilities/', '/farm-report/', '/traffic/', '/jobs/', '/weather/', '/vote/']));
  it('Moreno Valley', () => expect(hrefs(MORENO)).toEqual(['/today/', '/this-week/', '/events/', '/whats-on/', '/burro-bonanza/', '/city-hall/', '/closures/',
    '/facilities/', '/home-sales/', '/month/', '/sports/', '/workplace-watch/', '/traffic/', '/jobs/', '/weather/', '/vote/']));
  it('Broomfield', () => expect(hrefs(BROOMFIELD)).toEqual(['/today/', '/this-week/', '/events/', '/whats-on/', '/city-hall/', '/facilities/',
    '/workplace-watch/', '/vail-resorts/', '/traffic/', '/jobs/', '/weather/', '/vote/']));
  it('footer labels keep their old capitalisation', () => {
    const l = enabledSections(BROOKINGS).map((s) => s.label);
    expect(l).toContain('City hall');
    expect(l).toContain('Farm report');
  });
});

describe('resolveNav', () => {
  it('accepts the Brookings config and keeps tab order', () => {
    const r = resolveNav(BROOKINGS_NAV, BROOKINGS);
    expect(r.tabs.map((t) => t.id)).toEqual(BROOKINGS_NAV.tabs);
    expect(r.groups.map((g) => g.title)).toEqual(['Now', 'Campus', 'City', 'More']);
  });
  it('every enabled section is reachable from the sheet', () => {
    const r = resolveNav(BROOKINGS_NAV, BROOKINGS);
    const inSheet = new Set(r.groups.flatMap((g) => g.items.map((i) => i.href)));
    for (const s of enabledSections(BROOKINGS)) expect(inSheet.has(s.href), s.href).toBe(true);
  });
  it('FAILS when a tab is missing from groups', () => {
    expect(() => resolveNav({ ...BROOKINGS_NAV, groups: { ...BROOKINGS_NAV.groups, More: ['play', 'farm'] } }, BROOKINGS)).toThrow(/"jobs".*missing from groups|"jobs" is missing/);
  });
  it('FAILS when a section is listed twice', () => {
    expect(() => resolveNav({ ...BROOKINGS_NAV, groups: { ...BROOKINGS_NAV.groups, More: ['jobs', 'play', 'farm', 'weather'] } }, BROOKINGS)).toThrow(/"weather" is listed twice/);
    expect(() => resolveNav({ ...BROOKINGS_NAV, tabs: ['today', 'today'] }, BROOKINGS)).toThrow(/tabs: "today" is listed twice/);
  });
  it('FAILS when an id points at a route disabled for the town', () => {
    const moreno: NavConfig = { tabs: ['today'], groups: { Now: ['today', 'university'] } };
    expect(() => resolveNav(moreno, MORENO)).toThrow(/"university" is disabled for moreno_valley_ca/);
    expect(() => resolveNav({ tabs: ['today'], groups: { Now: ['today', 'closures'] } }, BROOMFIELD)).toThrow(/"closures" is disabled for broomfield_co/);
  });
  it('FAILS on an unknown id and on an enabled section nobody lists', () => {
    expect(() => resolveNav({ tabs: ['today'], groups: { Now: ['today', 'nope'] } }, BROOKINGS)).toThrow(/unknown section id "nope"/);
    expect(() => resolveNav({ tabs: ['today'], groups: { Now: ['today'] } }, BROOKINGS)).toThrow(/enabled section "events"/);
  });
  it('omits groups with no sections', () => {
    const cfg: NavConfig = { tabs: ['today'], groups: { ...BROOKINGS_NAV.groups, Empty: [] } };
    expect(resolveNav(cfg, BROOKINGS).groups.map((g) => g.title)).not.toContain('Empty');
  });
});

describe('real town configs', () => {
  it('every town in site-config resolves against the registry, and its sheet reaches every enabled section', () => {
    expect(ALL_CONFIGS.length).toBe(4); // brookings, moreno, broomfield, glasgow
    for (const c of ALL_CONFIGS) {
      const r = resolveNav(c.nav, c);
      const inSheet = new Set(r.groups.flatMap((g) => g.items.map((i) => i.href)));
      for (const s of enabledSections(c)) expect(inSheet.has(s.href), `${c.townId} ${s.href}`).toBe(true);
      expect(r.tabs.length, c.townId).toBeLessThanOrEqual(7);
    }
  });
  it('no cross-town sections: University/Jackrabbits only Brookings, Worker Pulse never Brookings, Vail only Broomfield', () => {
    const hrefs = (id: string) => ALL_CONFIGS.filter((c) => resolveNav(c.nav, c).groups.some((g) => g.items.some((i) => i.id === id))).map((c) => c.townId);
    expect(hrefs('university')).toEqual(['brookings_sd']);
    expect(hrefs('jacks')).toEqual(['brookings_sd']);
    expect(hrefs('vail')).toEqual(['broomfield_co']);
    expect(hrefs('homesales')).toEqual(['moreno_valley_ca']);
    expect(hrefs('workplace').sort()).toEqual(['broomfield_co', 'moreno_valley_ca']);
  });
  it('Brookings in site-config resolves', async () => {
    const { siteConfig } = await import('./site-config');
    if (siteConfig.nav) expect(() => resolveNav(siteConfig.nav!, siteConfig)).not.toThrow();
  });
  it('registry ids are unique', () => {
    expect(new Set(SECTIONS.map((s) => s.id)).size).toBe(SECTIONS.length);
    expect(ALL_SITES.length).toBeGreaterThan(0);
  });
});
