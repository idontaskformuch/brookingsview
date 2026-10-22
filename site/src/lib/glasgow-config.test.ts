import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ALL_CONFIGS, ALL_SITES } from './site-config';
import { enabledSections, resolveNav } from './nav-sections';
import { assertAccentContrast } from './accent-contrast';
import { validatePlaceConfig, placeLabel, countryProfile } from './country-profile';
import { aboutSourcesFor } from './about-sources';
import { findSpellingViolations } from './spelling-gate';

const glasgow = ALL_CONFIGS.find((c) => c.townId === 'glasgow')!;
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8');

describe('Glasgow skeleton config', () => {
  it('is a gb/scotland town with no state, and passes the place gate', () => {
    expect(glasgow).toBeDefined();
    expect(glasgow.country).toBe('gb');
    expect(glasgow.nation).toBe('scotland');
    expect(glasgow.stateName).toBeUndefined();
    expect(validatePlaceConfig(glasgow)).toEqual([]);
    expect(placeLabel(glasgow)).toBe('Glasgow, Scotland');
    expect(glasgow.timezone).toBe(countryProfile('gb').defaultTimezone);
    expect(glasgow.domain).toBe('glasgowloop.co.uk');
  });

  it('is noindex site-wide, not advertised from the live sites, and has no GA id', () => {
    expect(glasgow.noindexSite).toBe(true);
    expect(glasgow.listedInNetwork).toBe(false);
    expect(ALL_SITES.map((s) => s.townId)).not.toContain('glasgow');
    expect(glasgow.ga4MeasurementId).toBeUndefined();
  });

  it('has every feature off', () => {
    for (const k of ['hasWhatsOn', 'hasClosureWatch', 'hasNewInTown', 'hasWorkplaceWatch', 'hasPlaces', 'hasHeatAdvisory', 'hasEventsSource'] as const) {
      expect(!!(glasgow as Record<string, unknown>)[k], k).toBe(false);
    }
    expect(glasgow.ticketmaster).toBeUndefined();
    expect(glasgow.statusModules ?? []).toEqual([]);
  });

  it('resolves its nav; sections with no source yet are off; cityhall is labelled Council', () => {
    const nav = resolveNav(glasgow.nav, glasgow);
    expect(nav.tabs.map((t) => t.id)).toEqual(['today', 'events', 'cityhall']);
    const ids = enabledSections(glasgow).map((s) => s.id);
    expect(ids).toEqual(['today', 'thisweek', 'events', 'cityhall']);
    expect(enabledSections(glasgow).find((s) => s.id === 'cityhall')!.label).toBe('Council');
    expect(nav.tabs.find((t) => t.id === 'cityhall')!.label).toBe('Council');
  });

  it('keeps US nav labels untouched', () => {
    for (const c of ALL_CONFIGS.filter((x) => x.country === 'us')) {
      expect(enabledSections(c).find((s) => s.id === 'cityhall')!.label).toBe('City hall');
    }
  });

  it('has a contrast-verified accent', () => {
    expect(() => assertAccentContrast('glasgow', glasgow.brand)).not.toThrow();
    const others = ALL_CONFIGS.filter((c) => c.townId !== 'glasgow').map((c) => c.brand?.accent);
    expect(others).not.toContain(glasgow.brand?.accent);
  });

  it('lists no sources on /about until a source is enabled', () => {
    expect(aboutSourcesFor('glasgow')).toEqual([]);
  });

  it('mirrors its identity in astro.config.mjs (url, accent, zone, noindex set)', () => {
    const cfg = read('../../astro.config.mjs');
    expect(cfg).toContain("glasgow: 'https://glasgowloop.co.uk'");
    expect(cfg).toContain(`glasgow: { accent: '${glasgow.brand!.accent}', accentInk: '${glasgow.brand!.accentInk}', accentDark: '${glasgow.brand!.accentDark}', accentInkDark: '${glasgow.brand!.accentInkDark}' }`);
    expect(cfg).toContain("glasgow: 'Europe/London'");
    expect(cfg).toContain("NOINDEX_SITE_TOWNS = new Set(['glasgow'])");
  });

  it('gb legal/about components are British-spelled', () => {
    for (const f of ['PrivacyBody', 'CookiesBody', 'TermsBody', 'AboutBody']) {
      const text = read(`../components/legal/gb/${f}.astro`).replace(/^---[\s\S]*?---/, '');
      expect(findSpellingViolations(text, 'british'), f).toEqual([]);
    }
  });
});
