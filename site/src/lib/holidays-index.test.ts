// Audit Fas 1 (2026-11-16, P1-4, QA build.holidays-threshold): /holidays/ was indexable with 8-24 words in every town.
import { describe, expect, it } from 'vitest';
import { HOLIDAYS_MIN_WORDS, holidaysIndexable, wordCount } from './holidays-index';
import { holidayListing } from '../config/holiday-pages/registry';
import { formatDayLong } from './holiday-calendar';
import { holidayOverviewLine } from './holiday-view';

/** The page's own texts (pages/holidays.astro) for a town on a given instant. */
function pageTexts(townId: string, cityName: string, tz: string, locale: 'en-US' | 'en-GB', now: number) {
  return [`Holidays in ${cityName}`, ...holidayListing(townId, now, tz).flatMap((e) => [
    e.def.label, formatDayLong(e.day, locale), holidayOverviewLine(e.page, e.def, e.day),
  ])];
}

describe('/holidays/ indexing threshold', () => {
  it('counts words, not punctuation', () => {
    expect(wordCount(['Holidays in Glasgow', 'Thursday, 26 November 2026', null, '–'])).toBe(7);
  });

  it('is indexable at the threshold and not one word under it', () => {
    expect(holidaysIndexable(['w '.repeat(HOLIDAYS_MIN_WORDS)])).toBe(true);
    expect(holidaysIndexable(['w '.repeat(HOLIDAYS_MIN_WORDS - 1)])).toBe(false);
  });

  // The listing as built on the audit day: every town fell under the line (pass 1 measured 8-24 words in main).
  it.each([
    ['brookings_sd', 'Brookings', 'America/Chicago', 'en-US'],
    ['moreno_valley_ca', 'Moreno Valley', 'America/Los_Angeles', 'en-US'],
    ['broomfield_co', 'Broomfield', 'America/Denver', 'en-US'],
    ['glasgow', 'Glasgow', 'Europe/London', 'en-GB'],
  ] as const)('%s on 2026-11-16 is noindex', (townId, cityName, tz, locale) => {
    const texts = pageTexts(townId, cityName, tz, locale, Date.parse('2026-11-16T12:00:00Z'));
    expect(wordCount(texts)).toBeLessThan(HOLIDAYS_MIN_WORDS);
    expect(holidaysIndexable(texts)).toBe(false);
  });
});
