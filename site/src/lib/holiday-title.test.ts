import { describe, expect, it } from 'vitest';
import { buildHolidayMeta, fitTitle, titleLengthVerdict, type ConfirmedEvent, type HolidayPageData } from './holiday-page';
import { holidayPagesForTown, holidayPageFor } from '../config/holiday-pages/registry';
import { TITLE_OK_MAX, TITLE_WARN_MAX } from '../config/holiday-pages/title-rules';

/** Holiday titles, rule B (owner 2026-11-18): fixed word priority (big event if confirmed -> closures -> trash pickup -> transit ->
 *  events -> support/food help), words struck from the end over 65 characters, at least one kept, error only over 70 with one left. */
const TOWNS = [['brookings_sd', 'Brookings'], ['moreno_valley_ca', 'Moreno Valley'], ['broomfield_co', 'Broomfield'], ['glasgow', 'Glasgow']] as const;

// Every town x holiday x mode, from the real page data (registry). [town, slug, active title, title outside the window]
const EXPECTED: [string, string, string, string][] = [
  ['brookings_sd', 'thanksgiving', 'Thanksgiving 2026 in Brookings: closures, trash pickup', 'Thanksgiving in Brookings: closures, trash pickup'],
  ['brookings_sd', 'christmas', 'Christmas 2026 in Brookings: Festival of Lights, closures', 'Christmas in Brookings: Festival of Lights, closures'],
  ['moreno_valley_ca', 'thanksgiving', 'Thanksgiving 2026 in Moreno Valley: closures, trash pickup', 'Thanksgiving in Moreno Valley: closures, trash pickup, transit'],
  ['moreno_valley_ca', 'christmas', 'Christmas 2026 in Moreno Valley: Snow Day, tree lighting', 'Christmas in Moreno Valley: Snow Day, tree lighting, closures'],
  ['broomfield_co', 'veterans-day', "Veterans Day 2026 in Broomfield: what's closed on Nov 11", 'Veterans Day in Broomfield: closures and hours'],
  ['broomfield_co', 'thanksgiving', 'Thanksgiving 2026 in Broomfield: closures, events, food help', 'Thanksgiving in Broomfield: closures, events, food help'],
  ['broomfield_co', 'christmas', 'Christmas 2026 in Broomfield: tree lighting, events, closures', 'Christmas in Broomfield: tree lighting, events, closures'],
  ['glasgow', 'christmas', 'Christmas and New Year 2026 in Glasgow: closures, transit, events', 'Christmas and New Year in Glasgow: closures, transit, events'],
];

describe('holiday titles, every town x holiday x mode (real rows)', () => {
  it('covers every page that exists, and nothing else', () => {
    const built = TOWNS.flatMap(([id]) => holidayPagesForTown(id).map((e) => `${id}/${e.def.slug}`)).sort();
    expect(EXPECTED.map(([id, slug]) => `${id}/${slug}`).sort()).toEqual(built);
  });

  for (const [id, slug, active, outside] of EXPECTED) {
    it(`${id} /${slug}/`, () => {
      const city = TOWNS.find(([t]) => t === id)![1];
      const e = holidayPageFor(slug, id)!;
      const a = buildHolidayMeta(e.page, e.def.label, city, false).title;
      const o = buildHolidayMeta(e.page, e.def.label, city, true).title;
      expect(a).toBe(active);
      expect(o).toBe(outside);
      for (const t of [a, o]) expect(titleLengthVerdict(t), t).not.toBe('error');
    });
  }
});

describe('words are struck at build time when calendar rows add a section (the live Moreno Thanksgiving case)', () => {
  it('Moreno Thanksgiving with its matched calendar row (event-329806) drops "events", then "transit", to fit 65', () => {
    const e = holidayPageFor('thanksgiving', 'moreno_valley_ca')!;
    // A Charlie Brown Thanksgiving + Fantastic Mr. Fox Outdoor Screening, Farm House Collective, Nov 24 18:00 (events 329806).
    const row: ConfirmedEvent = {
      status: 'confirmed', name: 'A Charlie Brown Thanksgiving + Fantastic Mr. Fox Outdoor Screening', date: '2026-11-24', startTime: '18:00',
      venue: { name: 'Farm House Collective', street: '1393 University Ave', locality: 'Riverside' },
      url: 'https://farmhousecollective.com/event/a-charlie-brown-thanksgiving-fantastic-mr-fox-outdoor-screening/',
      source: { name: 'Farm House Collective', url: 'https://farmhousecollective.com/' }, checkedOn: '2026-11-13', fromCalendar: 'event-329806',
    };
    const page: HolidayPageData = { ...e.page, events: [...e.page.events, row] };
    const title = buildHolidayMeta(page, 'Thanksgiving', 'Moreno Valley', false).title;
    expect(title).toBe('Thanksgiving 2026 in Moreno Valley: closures, trash pickup');
    expect(title.length).toBeLessThanOrEqual(TITLE_OK_MAX);
  });
});

describe('fitTitle', () => {
  it('strikes every word but one, and keeps that one even when still long', () => {
    const prefix = 'Christmas and New Year 2026 in Moreno Valley';
    const t = fitTitle(prefix, ['closures', 'trash pickup', 'transit', 'events', 'support']);
    expect(t).toBe(`${prefix}: closures`);
    expect(titleLengthVerdict(t)).toBe('ok');
    const long = fitTitle('x'.repeat(60), ['closures', 'trash pickup']);
    expect(long).toBe(`${'x'.repeat(60)}: closures`); // 70: one word left, warning, not an error
    expect(titleLengthVerdict(long)).toBe('warn');
    expect(titleLengthVerdict(fitTitle('x'.repeat(61), ['closures', 'events']))).toBe('error');
    expect(titleLengthVerdict(fitTitle('x'.repeat(TITLE_WARN_MAX + 1), []))).toBe('error');
  });
});
