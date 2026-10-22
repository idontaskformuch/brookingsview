import { describe, expect, it } from 'vitest';
import {
  countryProfile, formatClockCompact, formatDateLong, holidayIdsFor, nationProfile,
  placeAbbr, placeLabel, temperatureForDisplay, validatePlaceConfig,
} from './country-profile';
import { HOLIDAYS, holidayDefinitionsFor } from '../config/holidays';
import { computeHolidayDate } from './holidays';
import { ALL_CONFIGS } from './site-config';
import { localDayNumber, localHourOf } from './local-day';

const LONDON = 'Europe/London';

describe('country profiles', () => {
  it('us profile reproduces the pre-profile values', () => {
    const us = countryProfile('us');
    expect(us.locale).toBe('en-US');
    expect(us.htmlLang).toBe('en');
    expect(us.ogLocale).toBe('en_US');
    expect(us.addressCountry).toBe('US');
    expect(us.currency).toBe('USD');
    expect(countryProfile(undefined)).toBe(us);
  });

  it('gb profile carries the spec values', () => {
    const gb = countryProfile('gb');
    expect(gb).toMatchObject({
      locale: 'en-GB', currency: 'GBP', temperatureUnit: 'C', distanceUnit: 'miles',
      defaultTimezone: LONDON, spelling: 'british', addressCountry: 'GB',
    });
    expect(gb.legal.variant).toBe('gb');
    expect(gb.legal.consent).toMatch(/^opt-in/);
    expect(gb.legal.framework).toMatch(/UK GDPR/);
    expect(gb.legal.framework).toMatch(/PECR/);
  });

  it('nation sub-profile selects default source adapters', () => {
    expect(nationProfile('gb', 'scotland')?.sources.foodHygiene).toBe('fhis');
    expect(nationProfile('gb', 'england')?.sources.foodHygiene).toBe('fhrs');
    expect(nationProfile('gb', 'wales')).toBeUndefined();
    expect(nationProfile('us', 'scotland')).toBeUndefined();
  });
});

describe('holidays per country', () => {
  it('us profile resolves to exactly HOLIDAYS, same order', () => {
    expect(holidayDefinitionsFor(holidayIdsFor('us'))).toEqual(HOLIDAYS);
  });

  it('scotland adds 2 Jan, Burns Night, St Andrew day, Hogmanay; england does not', () => {
    const scot = holidayIdsFor('gb', 'scotland');
    for (const id of ['second_january', 'burns_night', 'bonfire_night', 'st_andrews_day', 'hogmanay']) expect(scot).toContain(id);
    expect(holidayIdsFor('gb', 'england')).not.toContain('burns_night');
    expect(scot).not.toContain('thanksgiving');
  });

  it('every gb holiday id resolves and its date rule yields the expected 2026 date', () => {
    const defs = holidayDefinitionsFor(holidayIdsFor('gb', 'scotland'));
    const byId = Object.fromEntries(defs.map((d) => [d.id, computeHolidayDate(d.dateRule, 2026)]));
    expect(byId.burns_night).toEqual({ y: 2026, m: 1, d: 25 });
    expect(byId.bonfire_night).toEqual({ y: 2026, m: 11, d: 5 });
    expect(byId.st_andrews_day).toEqual({ y: 2026, m: 11, d: 30 });
    expect(byId.hogmanay).toEqual({ y: 2026, m: 12, d: 31 });
    expect(byId.second_january).toEqual({ y: 2026, m: 1, d: 2 });
    expect(byId.easter).toEqual({ y: 2026, m: 4, d: 5 });
  });
});

describe('place labels and config gate', () => {
  it('us towns keep "City, State" / "City, ST"', () => {
    const c = { cityName: 'Brookings', country: 'us' as const, stateName: 'South Dakota', stateAbbr: 'SD' };
    expect(placeLabel(c)).toBe('Brookings, South Dakota');
    expect(placeAbbr(c)).toBe('Brookings, SD');
  });

  it('gb towns use the region', () => {
    const c = { cityName: 'Glasgow', country: 'gb' as const, region: 'Scotland' };
    expect(placeLabel(c)).toBe('Glasgow, Scotland');
    expect(placeAbbr(c)).toBe('Glasgow, Scotland');
  });

  it('every real town passes the gate', () => {
    expect(ALL_CONFIGS.flatMap((c) => validatePlaceConfig(c))).toEqual([]);
  });

  it('us still requires a state; gb requires region and a known nation', () => {
    expect(validatePlaceConfig({ townId: 'x', cityName: 'X', country: 'us' })).toHaveLength(2);
    expect(validatePlaceConfig({ townId: 'x', cityName: 'X', country: 'gb' })).toHaveLength(2);
    expect(validatePlaceConfig({ townId: 'x', cityName: 'X', country: 'gb', region: 'Wales', nation: 'wales' })).toHaveLength(1);
    expect(validatePlaceConfig({ townId: 'glasgow', cityName: 'Glasgow', country: 'gb', region: 'Scotland', nation: 'scotland' })).toEqual([]);
  });
});

describe('formatters', () => {
  it('formats long dates per country', () => {
    const d = new Date('2026-10-21T12:00:00Z');
    expect(formatDateLong(d, LONDON, 'gb')).toBe('21 October 2026');
    expect(formatDateLong(d, 'America/Chicago', 'us')).toBe('October 21, 2026');
  });

  it('formats clock times as 7pm / 7:30pm', () => {
    expect(formatClockCompact(new Date('2026-07-01T18:00:00Z'), LONDON)).toBe('7pm');
    expect(formatClockCompact(new Date('2026-12-01T19:30:00Z'), LONDON)).toBe('7:30pm');
    expect(formatClockCompact(new Date('2026-12-01T00:05:00Z'), LONDON)).toBe('12:05am');
    expect(formatClockCompact(new Date('2026-12-01T12:00:00Z'), LONDON)).toBe('12pm');
  });

  it('converts temperatures for display', () => {
    expect(temperatureForDisplay(50, 'gb')).toBe(10);
    expect(temperatureForDisplay(32, 'gb')).toBe(0);
    expect(temperatureForDisplay(50, 'us')).toBe(50);
  });
});

describe('Europe/London DST transitions (2026)', () => {
  // Spring forward: Sun 29 Mar 2026, 01:00 UTC -> 02:00 BST. Fall back: Sun 25 Oct 2026, 02:00 BST -> 01:00 GMT.
  it('spring forward: clock skips 01:xx local', () => {
    expect(formatClockCompact(new Date('2026-03-29T00:30:00Z'), LONDON)).toBe('12:30am');
    expect(formatClockCompact(new Date('2026-03-29T01:30:00Z'), LONDON)).toBe('2:30am');
    expect(localHourOf(new Date('2026-03-29T00:59:00Z'), LONDON)).toBe(0);
    expect(localHourOf(new Date('2026-03-29T01:00:00Z'), LONDON)).toBe(2);
  });

  it('fall back: 01:xx local happens twice, one UTC hour apart', () => {
    expect(formatClockCompact(new Date('2026-10-25T00:30:00Z'), LONDON)).toBe('1:30am');
    expect(formatClockCompact(new Date('2026-10-25T01:30:00Z'), LONDON)).toBe('1:30am');
    expect(formatClockCompact(new Date('2026-10-25T02:30:00Z'), LONDON)).toBe('2:30am');
  });

  it('local calendar day follows London, not UTC, around midnight in BST', () => {
    const d = new Date('2026-10-24T23:30:00Z'); // 00:30 BST on the 25th
    expect(formatDateLong(d, LONDON, 'gb')).toBe('25 October 2026');
    expect(localDayNumber(d, LONDON)).toBe(localDayNumber(new Date('2026-10-25T12:00:00Z'), LONDON));
  });

  it('days across both transitions are consecutive (23h and 25h days)', () => {
    const pairs = [
      ['2026-03-28T12:00:00Z', '2026-03-29T12:00:00Z'], ['2026-03-29T12:00:00Z', '2026-03-30T12:00:00Z'],
      ['2026-10-24T12:00:00Z', '2026-10-25T12:00:00Z'], ['2026-10-25T12:00:00Z', '2026-10-26T12:00:00Z'],
    ];
    for (const [a, b] of pairs) {
      expect(localDayNumber(new Date(b), LONDON) - localDayNumber(new Date(a), LONDON)).toBe(1);
    }
  });

  it('London and Chicago offsets differ in the weeks the two countries are out of step', () => {
    // 2026-03-30: London BST (UTC+1), Chicago CDT (UTC-5) since 8 Mar -> 6h apart.
    const d = new Date('2026-03-30T12:00:00Z');
    expect(localHourOf(d, LONDON)).toBe(13);
    expect(localHourOf(d, 'America/Chicago')).toBe(7);
    // 2026-10-28: London GMT (UTC+0), Chicago CDT (UTC-5) until 1 Nov -> 5h apart.
    const e = new Date('2026-10-28T12:00:00Z');
    expect(localHourOf(e, LONDON)).toBe(12);
    expect(localHourOf(e, 'America/Chicago')).toBe(7);
  });
});
