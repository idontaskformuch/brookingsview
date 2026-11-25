import { describe, expect, it } from 'vitest';
import { clientRows, effectiveHours, inSeason, seasonRangeLabel, weekOn, type SeasonalHours } from './hours-spec';
import { computePlaceOpenStatus } from './place-hours';
import { summarizeHours } from './facility-lede';
import type { PlaceHoursRow } from './db';
import { PARK_HOURS } from '../config/park-hours';

// What ai_pipeline/facility_hours.py makes of brookings_sd/south-dakota-art-museum's hours_text (2026-11-25):
// "Mon-Fri 10 a.m.-5 p.m.; Sat 10 a.m.-4 p.m.; Sun noon-4 p.m. Closed Sundays January-March and on all state holidays."
const weekday: [string, string] = ['10:00', '17:00'];
const ART_MUSEUM: SeasonalHours = {
  seasons: [
    { from: '01-01', to: '03-31', label: 'January–March', week: {
      monday: weekday, tuesday: weekday, wednesday: weekday, thursday: weekday, friday: weekday, saturday: ['10:00', '16:00'], sunday: null } },
    { from: '04-01', to: '12-31', label: 'Rest of year', week: {
      monday: weekday, tuesday: weekday, wednesday: weekday, thursday: weekday, friday: weekday, saturday: ['10:00', '16:00'], sunday: ['12:00', '16:00'] } },
  ],
};
// brookings_sd/larson-nature-center: "Summer (June-mid-August): ... Rest of year: Sat 9am-5pm, Sun noon-5pm only."
const LARSON: SeasonalHours = {
  seasons: [
    { from: '06-01', to: '08-15', label: 'Summer (June–mid-August)', week: {
      monday: null, tuesday: null, wednesday: ['12:00', '20:00'], thursday: ['12:00', '20:00'], friday: ['12:00', '20:00'],
      saturday: ['09:00', '20:00'], sunday: ['12:00', '20:00'] } },
    { from: '08-16', to: '05-31', label: 'Rest of year', week: {
      monday: null, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: ['09:00', '17:00'], sunday: ['12:00', '17:00'] } },
  ],
};
const TZ = 'America/Chicago';

describe('seasons: the week in force on a date', () => {
  it('an interval over New Year (Larson "Rest of year" 08-16..05-31)', () => {
    expect(inSeason('12-25', '08-16', '05-31')).toBe(true);
    expect(inSeason('07-04', '08-16', '05-31')).toBe(false);
  });
  it('the art museum is closed on Sundays in February, open on Sundays in November', () => {
    expect(weekOn(ART_MUSEUM, '2027-02-07')!.sunday).toBeNull();
    expect(weekOn(ART_MUSEUM, '2026-11-29')!.sunday).toEqual(['12:00', '16:00']);
  });
  it('Larson Nature Center in summer has Wednesdays', () => {
    expect(weekOn(LARSON, '2027-07-07')!.wednesday).toEqual(['12:00', '20:00']);
    expect(weekOn(LARSON, '2026-11-25')!.wednesday).toBeNull();
  });
  it('labels the interval', () => {
    expect(seasonRangeLabel(ART_MUSEUM.seasons[1])).toBe('Apr 1–Dec 31');
    expect(seasonRangeLabel(LARSON.seasons[1])).toBe('Aug 16–May 31');
  });
});

describe('effectiveHours: place_hours rows first, then hours_structured', () => {
  it('place_hours rows win (broomfield_co/broomfield-court-services, split hours)', () => {
    const rows: PlaceHoursRow[] = [
      { day_of_week: 1, opens: '07:30:00', closes: '11:30:00', valid_from: null, valid_to: null },
      { day_of_week: 1, opens: '12:30:00', closes: '16:30:00', valid_from: null, valid_to: null },
    ];
    const eff = effectiveHours({ hours_structured: null }, rows, '2026-11-25')!;
    expect(eff.rows).toBe(rows);
    expect(eff.season).toBeNull();
  });
  it('a seasonal row shows the week in force and names the season', () => {
    const eff = effectiveHours({ hours_structured: ART_MUSEUM }, [], '2026-11-25')!;
    expect(summarizeHours(eff.rows)).toBe('Mon–Fri 10am–5pm, Sat 10am–4pm, Sun noon–4pm');
    expect(eff.season!.from).toBe('04-01');
  });
  it('nothing known -> null', () => {
    expect(effectiveHours({ hours_structured: null }, [], '2026-11-25')).toBeNull();
  });
});

describe('pill rows cross a season boundary without a rebuild', () => {
  it('built Dec 31, the Sunday after is January: closed, opens Monday', () => {
    // 2027-01-03 is a Sunday. Build day 2026-12-31 (Thursday); "now" is Sunday 2027-01-03 13:00 Central.
    const rows = clientRows(ART_MUSEUM, '2026-12-31');
    const status = computePlaceOpenStatus(rows, [], new Date('2027-01-03T19:00:00Z'), TZ);
    expect(status).toEqual({ known: true, isOpen: false, opensAt: '10:00 AM', opensLabel: 'tomorrow' });
  });
  it('the same Sunday time in November is open', () => {
    const rows = clientRows(ART_MUSEUM, '2026-11-27');
    expect(computePlaceOpenStatus(rows, [], new Date('2026-11-29T19:00:00Z'), TZ)).toEqual({ known: true, isOpen: true, closesAt: '4:00 PM' });
  });
});

describe('city park rule (config/park-hours.ts, order D 2)', () => {
  const rule = PARK_HOURS.brookings_sd;
  it('a city park with nothing of its own gets the rule (brookings_sd/pioneer-park)', () => {
    const eff = effectiveHours({ hours_structured: null, hours_text: null, category: 'park', slug: 'pioneer-park' }, [], '2026-11-25', rule)!;
    expect(eff.source).toBe('city-park-rule');
    expect(summarizeHours(eff.rows)).toBe('Mon–Sun 6am–11pm');
  });
  it('an excepted park gets nothing (brookings_sd/mccrory-gardens is SDSU\'s)', () => {
    expect(effectiveHours({ hours_structured: null, hours_text: null, category: 'park', slug: 'mccrory-gardens' }, [], '2026-11-25', rule)).toBeNull();
  });
  it('own rows win (broomfield_co/broomfield-skate-park, 6am-10pm)', () => {
    const rows: PlaceHoursRow[] = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, opens: '06:00:00', closes: '22:00:00', valid_from: null, valid_to: null }));
    const eff = effectiveHours({ hours_structured: null, category: 'park', slug: 'broomfield-skate-park' }, rows, '2026-11-25', PARK_HOURS.broomfield_co)!;
    expect(eff.source).toBe('own');
  });
  it('own text the parser could not read also wins (moreno_valley_ca/celebration-park before order D 5)', () => {
    expect(effectiveHours({ hours_structured: null, hours_text: 'Mon–Fri 10am–6pm, Sat 9am–9pm, Sun 10am onward', category: 'park',
      slug: 'celebration-park' }, [], '2026-11-25', PARK_HOURS.moreno_valley_ca)).toBeNull();
  });
  it('not a park: no rule (brookings_sd/downtown-main-avenue)', () => {
    expect(effectiveHours({ hours_structured: null, category: 'other', slug: 'downtown-main-avenue' }, [], '2026-11-25', rule)).toBeNull();
  });
});

describe('dated rows (brookings_sd/briggs-library from LibCal, order D 4)', () => {
  // The page's Thanksgiving week as scrapers/facility_hours.py writes it: one row per date, valid_from = valid_to.
  const row = (iso: string, dow: number, opens: string | null, closes: string | null): PlaceHoursRow =>
    ({ day_of_week: dow, opens, closes, valid_from: iso, valid_to: iso });
  const BRIGGS = [
    row('2026-11-25', 3, '08:00:00', '17:00:00'), row('2026-11-26', 4, null, null), row('2026-11-27', 5, null, null),
    row('2026-11-28', 6, null, null), row('2026-11-29', 0, '12:00:00', '00:00:00'), row('2026-11-30', 1, '07:45:00', '00:00:00'),
    row('2026-12-01', 2, '07:45:00', '00:00:00'),
  ];
  it('the table is the seven days from the build date', () => {
    const eff = effectiveHours({ hours_structured: null }, BRIGGS, '2026-11-25')!;
    expect(eff.dated).toBe(true);
    expect(summarizeHours(eff.rows)).toBe('Mon–Tue 7:45am–midnight, Wed 8am–5pm, Sun noon–midnight');
  });
  it('a Date from the driver is read as its calendar date', () => {
    const asDates = BRIGGS.map((r) => ({ ...r, valid_from: new Date(2026, 10, 25) as unknown as string, valid_to: new Date(2026, 10, 25) as unknown as string }));
    expect(effectiveHours({ hours_structured: null }, asDates.slice(0, 1), '2026-11-25')!.pillRows[0].valid_from).toBe('2026-11-25');
  });
  it('Thanksgiving Day the pill says closed, opens Sunday', () => {
    const eff = effectiveHours({ hours_structured: null }, BRIGGS, '2026-11-25')!;
    expect(computePlaceOpenStatus(eff.pillRows, [], new Date('2026-11-26T18:00:00Z'), TZ))
      .toEqual({ known: true, isOpen: false, opensAt: '12:00 PM', opensLabel: 'Sunday' });
  });
  it('past the last dated day nothing is shown', () => {
    expect(effectiveHours({ hours_structured: null }, BRIGGS, '2026-12-05')).toBeNull();
  });
});
