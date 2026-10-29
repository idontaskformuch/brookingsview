import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SAFETY_TOWNS } from './safety-towns';
import { ALL_CONFIGS } from './site-config';
import { airLine, compactLine, fireLine, isFresh, needsAttention, reportingAreaName, type PublicAir, type PublicFire, type SafetyPayload } from './safety-view';
import { hasCrimeWord } from './safety-filter';

const NOW = new Date('2026-10-29T20:00:00Z').getTime();
const fire = (over: Partial<PublicFire> = {}): PublicFire => ({ id: 'a', name: 'SAGE', acres: 1200, percentContained: 15, county: 'Riverside', distanceMiles: 9.4, updated: '2026-10-29T17:00:00Z', sourceName: 'NIFC', sourceUrl: 'https://x', ...over });
const air = (over: Partial<PublicAir> = {}): PublicAir => ({ aqi: 54, category: 'Moderate', categoryNumber: 2, color: '#FFFF00', parameter: 'PM2.5', reportingArea: 'Perris Vly', station: 's', observed: '2026-10-29T18:00:00Z', observedLocal: '2026-10-29 11:00 PDT', preliminary: true, sourceName: 'AirNow (EPA)', sourceUrl: 'https://www.airnow.gov/', ...over });
const payload = (over: Partial<SafetyPayload> = {}): SafetyPayload => ({ town: 'moreno_valley_ca', available: true, checkedAt: '2026-10-29T19:55:00Z', fires: [], air: null, ...over });

describe('safety config', () => {
  it('astro.config.mjs mirrors the towns with safetyNotices (others keep /safety/ out of the sitemap)', () => {
    const cfg = readFileSync(new URL('../../astro.config.mjs', import.meta.url), 'utf8');
    const m = cfg.match(/const SAFETY_TOWNS_MIRROR = (\[[^\]]*\]);/);
    expect(m).not.toBeNull();
    const mirror = Function(`return ${m![1]}`)() as string[];
    expect(mirror.slice().sort()).toEqual(ALL_CONFIGS.filter((c) => c.safetyNotices).map((c) => c.townId).sort());
  });
  it('towns with the flag are exactly the towns with evacuation info', () => {
    expect(ALL_CONFIGS.filter((c) => c.safetyNotices).map((c) => c.townId).sort()).toEqual(Object.keys(SAFETY_TOWNS).sort());
  });
  it('Broomfield links only the two owner-given broomfield.org pages', () => {
    expect(SAFETY_TOWNS.broomfield_co.evacuation.map((l) => l.url)).toEqual(['https://www.broomfield.org/EmergencyStatus', 'https://www.broomfield.org/LookoutAlert']);
  });
});

describe('fireLine', () => {
  it('official fields in one line, local time', () => {
    expect(fireLine(fire(), 'America/Los_Angeles')).toBe('SAGE · 1,200 acres · 15% contained · Riverside County · 9.4 miles away · source updated Oct 29, 10:00 AM');
  });
  it('says so when containment is not reported', () => {
    expect(fireLine(fire({ percentContained: null, acres: null }), 'America/Los_Angeles')).toContain('containment not reported');
  });
});

describe('airLine and compactLine', () => {
  it('air line carries the number, category, preliminary and the source time', () => {
    expect(airLine(air(), NOW)).toBe('Air quality index 54 (Moderate), PM2.5, Perris Valley. Preliminary data, observed 2026-10-29 11:00 PDT.');
  });
  it('shows nothing for a reading older than 3 hours', () => {
    expect(airLine(air({ observed: '2026-10-29T16:00:00Z' }), NOW)).toBeNull();
  });
  it('compact line: counts, nearest fire, air', () => {
    expect(compactLine(payload({ fires: [fire(), fire({ name: 'B', distanceMiles: 20 })], air: air() }), NOW, 25))
      .toBe('2 wildfires within 25 miles (nearest: SAGE, 9.4 miles away, 15% contained) · air quality index 54 (Moderate, preliminary)');
    expect(compactLine(payload(), NOW, 25)).toBe('No wildfires listed within 25 miles');
  });
  it('fails closed: unavailable or an answer older than 15 minutes gives no line', () => {
    expect(compactLine(payload({ available: false }), NOW, 25)).toBeNull();
    expect(compactLine(payload({ checkedAt: '2026-10-29T19:30:00Z' }), NOW, 25)).toBeNull();
    expect(isFresh(null, NOW)).toBe(false);
  });
  it('none of the lines we build contains a crime word', () => {
    const lines = [fireLine(fire(), 'America/Los_Angeles'), airLine(air(), NOW) ?? '', compactLine(payload({ fires: [fire()], air: air() }), NOW, 25) ?? ''];
    for (const l of lines) expect(hasCrimeWord(l)).toBe(false);
  });
});

describe('reportingAreaName', () => {
  it('spells out known AirNow abbreviations word by word, leaves the rest alone', () => {
    expect(reportingAreaName('Perris Vly')).toBe('Perris Valley');
    expect(reportingAreaName('San Bernardino Mtns')).toBe('San Bernardino Mountains');
    expect(reportingAreaName('Denver-Boulder')).toBe('Denver-Boulder');
    expect(reportingAreaName('Vlyfoo Valley')).toBe('Vlyfoo Valley');
  });
  it('the air line uses the spelled-out name', () => {
    expect(airLine(air({ reportingArea: 'Perris Vly' }), NOW)).toContain(', Perris Valley.');
  });
});

describe('needsAttention (front-page box)', () => {
  it('is quiet with no fire and AQI below 101, at 100 and with no air reading', () => {
    expect(needsAttention(payload({ air: air({ aqi: 54 }) }), NOW)).toBe(false);
    expect(needsAttention(payload({ air: air({ aqi: 100 }) }), NOW)).toBe(false);
    expect(needsAttention(payload(), NOW)).toBe(false);
  });
  it('shows for a wildfire inside the radius or an AQI of 101 or more', () => {
    expect(needsAttention(payload({ fires: [fire()] }), NOW)).toBe(true);
    expect(needsAttention(payload({ air: air({ aqi: 101, category: 'Unhealthy for Sensitive Groups', categoryNumber: 3 }) }), NOW)).toBe(true);
  });
  it('fails closed: unavailable, stale answer or a stale reading never triggers the box', () => {
    expect(needsAttention(payload({ available: false, fires: [fire()] }), NOW)).toBe(false);
    expect(needsAttention(payload({ checkedAt: '2026-10-29T19:30:00Z', fires: [fire()] }), NOW)).toBe(false);
    expect(needsAttention(payload({ air: air({ aqi: 180, observed: '2026-10-29T15:00:00Z' }) }), NOW)).toBe(false);
    expect(needsAttention(null, NOW)).toBe(false);
  });
});
