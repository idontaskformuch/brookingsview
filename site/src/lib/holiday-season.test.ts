/** Glasgow's Christmas and New Year, day by day (owner 2026-11-14, .claude/specs/glasgow-christmas-2026.md). Bank holidays are GOV.UK's
 *  Scotland list as read 2026-11-14 (config/holiday-pages/gb/bank-holidays-scotland.json); register rows are the real Cottiers rows
 *  (evening_register_entries, SELECT 2026-11-14), with the one changed field named where a test needs one. */
import { describe, expect, it } from 'vitest';
import { SCOTLAND_BANK_HOLIDAYS } from '../config/holiday-pages/gb/bank-holidays';
import { buildChristmasPage } from '../config/holiday-pages/christmas';
import { holidayPageDef } from '../config/holiday-pages/calendar';
import {
  eventPopDays, eventsOn, factsOn, lastSeasonBankHoliday, seasonBankHolidays, seasonDays, seasonEvents, seasonHero, upcomingDays,
} from './holiday-season';
import { matchRegisterRows } from './holiday-calendar-events';
import { buildEveningEntries, showTitleKey, type RegisterRow } from './evening-items';
import { postVisible, selectFrontPage, type FrontPageInput } from './front-page';
import { frontPageHolidays } from './front-page-holidays';
import type { ConfirmedEvent } from './holiday-page';
import { FRONT_PAGE_BY_TOWN } from '../config/front-page';
const frontPageConfigFor = (id: string) => FRONT_PAGE_BY_TOWN[id];

const TZ = 'Europe/London';
const page = buildChristmasPage('glasgow')!;
const days = page.season!.days;
const xmas = holidayPageDef('christmas')!;

describe('days from GOV.UK (nothing hard-coded, owner 2026-11-14)', () => {
  it('2026/27: Christmas Day, Boxing Day on Mon 28 Dec (substitute), New Year’s Day, 2nd January on Mon 4 Jan (substitute)', () => {
    expect(seasonBankHolidays(SCOTLAND_BANK_HOLIDAYS, 2026)).toEqual([
      { title: 'Christmas Day', date: '2026-12-25', notes: '' },
      { title: 'Boxing Day', date: '2026-12-28', notes: 'Substitute day' },
      { title: 'New Year’s Day', date: '2027-01-01', notes: '' },
      { title: '2nd January', date: '2027-01-04', notes: 'Substitute day' },
    ]);
    expect(lastSeasonBankHoliday(SCOTLAND_BANK_HOLIDAYS, 2026)).toBe('2027-01-04');
    expect(lastSeasonBankHoliday(SCOTLAND_BANK_HOLIDAYS, 2025)).toBe('2026-01-02');
  });

  it('labels: Sat 26 Dec and Sat 2 Jan say where the bank holiday went, in the owner\'s words', () => {
    expect(days.map((d) => [d.anchor, d.heading, d.label])).toEqual([
      ['dec-24', 'Thu 24 Dec', 'Christmas Eve'],
      ['dec-25', 'Fri 25 Dec', 'Christmas Day · bank holiday'],
      ['dec-26', 'Sat 26 Dec', 'Boxing Day · bank holiday observed Mon 28 Dec'],
      ['dec-28', 'Mon 28 Dec', 'Boxing Day bank holiday · substitute day'],
      ['dec-31', 'Thu 31 Dec', 'Hogmanay'],
      ['jan-01', 'Fri 1 Jan', 'New Year’s Day · bank holiday'],
      ['jan-02', 'Sat 2 Jan', '2 January · bank holiday observed Mon 4 Jan'],
      ['jan-04', 'Mon 4 Jan', '2 January bank holiday · substitute day'],
    ]);
  });

  it('a year whose holidays fall on weekdays has no substitute sections (2025/26)', () => {
    expect(seasonDays(SCOTLAND_BANK_HOLIDAYS, 2025, []).map((d) => d.label)).toEqual([
      'Christmas Day · bank holiday', 'Boxing Day · bank holiday', 'New Year’s Day · bank holiday', '2 January · bank holiday',
    ]);
  });

  it('passed days are not built, and the hero counts down to the next bank holiday or Hogmanay', () => {
    expect(upcomingDays(days, '2026-12-27').map((d) => d.anchor)).toEqual(['dec-28', 'dec-31', 'jan-01', 'jan-02', 'jan-04']);
    expect(seasonHero(days, '2026-11-14')).toEqual({ label: 'Christmas Day is', value: 'Friday', sub: '25 Dec' });
    expect(seasonHero(days, '2026-12-26')).toEqual({ label: 'Boxing Day bank holiday is', value: 'Monday', sub: '28 Dec' });
    expect(seasonHero(days, '2027-01-02')).toEqual({ label: '2 January bank holiday is', value: 'Monday', sub: '4 Jan' });
    expect(seasonHero(days, '2027-01-05')).toBeNull();
  });
});

describe('cards per day', () => {
  it('24 Dec: both Winter Wonderland sites and ScotRail, each with its source page', () => {
    expect(factsOn(page, '2026-12-24').map((f) => [f.label, f.value, f.source.url])).toEqual([
      ['Winter Wonderland, St Enoch Square', '10am–8pm', 'https://www.glasgowswinterwonderland.com/faq/'],
      ['Winter Wonderland, Glasgow Green', 'Closes at 8pm', 'https://www.glasgowswinterwonderland.com/faq/'],
      ['ScotRail', 'Last trains leave earlier than normal', 'https://www.scotrail.co.uk/plan-your-journey/timetables/christmas-and-new-year-train-times'],
    ]);
    expect(factsOn(page, '2027-01-01').map((f) => [f.label, f.value])).toEqual([['Winter Wonderland, Glasgow Green', '2pm–10pm'], ['ScotRail', 'No trains']]);
    expect(factsOn(page, '2027-01-04')).toEqual([]);
  });

  it('a one-day event sits under its day; runs and other days are in the season list, past ones left out', () => {
    const events = page.events.filter((e): e is ConfirmedEvent => e.status === 'confirmed');
    expect(eventsOn(events, '2026-12-24').map((e) => e.name)).toEqual(['The McDougalls: Christmas in Toyland']);
    const later = seasonEvents(events, days, '2026-12-03').map((e) => e.name);
    expect(later).toContain("Glasgow's Winter Wonderland, Glasgow Green");
    expect(later).not.toContain("Disney's The Muppet Christmas Carol in Concert"); // 2 Dec, over
    expect(later).not.toContain('The McDougalls: Christmas in Toyland'); // under 24 Dec
  });

  it('event rows carry their source for the QA check and end at the end of a date-only day', () => {
    const events = page.events.filter((e): e is ConfirmedEvent => e.status === 'confirmed');
    const [day] = eventPopDays(events.filter((e) => e.name === 'Riverside Christmas Market'), TZ);
    expect(day.rows[0]).toMatchObject({
      start: '2026-11-28T00:00:00+00:00', end: '2026-11-29T23:59:00+00:00', timeLabel: '',
      attrs: { 'data-hp-item': '', 'data-source': 'https://www.glasgowlife.org.uk/christmas-in-glasgow' },
    });
    const [toy] = eventPopDays(eventsOn(events, '2026-12-24'), TZ);
    expect(toy.rows[0].timeLabel).toBe('1pm');
  });
});

describe('venue register rows on the page (G7) and the Frankie Mack night merged in code (owner 2026-11-14)', () => {
  const row = (title: string, lastConfirmedAt: string, onDate = '2026-11-29', times = ['19:00']): RegisterRow => ({
    venueName: 'Cottiers', kind: 'dated', title, weekdays: [], onDate, times, price: null, age: null,
    defaultGroup: 'Live music', sourceUrl: 'https://cottiers.com/whats-on-at-cottiers/', lastConfirmedAt,
  });
  // Real rows. Changed field: the first row's lastConfirmedAt (really 2026-10-29T08:10:55Z) is moved to 2026-11-05 so both are fresh.
  const older = row('Frankie Mack Ultimate Christmas Cracker', '2026-11-05T08:10:55Z');
  const newer = row('Frankie Mack – The Ultimate Christmas Cracker', '2026-11-09T11:04:36Z');
  const hogmanay = row('Hogmanay 2027', '2026-11-09T11:04:36Z', '2026-12-31', ['21:00']);
  const now = Date.parse('2026-11-10T12:00:00Z');

  it('the two titles are the same show', () => {
    expect(showTitleKey(older.title)).toBe(showTitleKey(newer.title));
    expect(showTitleKey(newer.title)).toBe('frankie mack ultimate christmas cracker');
  });

  it('one row per night, the one confirmed last; Hogmanay at Cottiers is under 31 Dec', () => {
    const { events, report } = matchRegisterRows(xmas, 2026, [older, newer, hogmanay], now, TZ, 'Glasgow', {});
    expect(events.map((e) => [e.date, e.startTime, e.name, e.venue.name, e.checkedOn])).toEqual([
      ['2026-11-29', '19:00', 'Frankie Mack – The Ultimate Christmas Cracker', 'Cottiers', '2026-11-09'],
      ['2026-12-31', '21:00', 'Hogmanay 2027', 'Cottiers', '2026-11-09'],
    ]);
    expect(report.filter((r) => !r.included).map((r) => r.reason)).toEqual(['same night listed twice']);
  });

  it('as read on 2026-11-14 the older row is stale (7-day rule) and drops out on its own', () => {
    const real = { ...older, lastConfirmedAt: '2026-10-29T08:10:55Z' };
    const { events } = matchRegisterRows(xmas, 2026, [real, newer], Date.parse('2026-11-14T12:00:00Z'), TZ, 'Glasgow', {});
    expect(events.map((e) => e.name)).toEqual(['Frankie Mack – The Ultimate Christmas Cracker']);
  });

  it('/tonight lists that night once too', () => {
    const at = '2026-11-23T11:04:36Z'; // changed field on both rows: lastConfirmedAt, so both are fresh on the night
    const entries = buildEveningEntries({
      feed: [], now: new Date('2026-11-29T12:00:00Z'), timezone: TZ, checked: '2026-11-29', cityName: 'Glasgow',
      register: [{ ...older, lastConfirmedAt: at }, { ...newer, lastConfirmedAt: at }],
    });
    expect(entries.map((e) => e.title)).toHaveLength(1);
  });
});

describe('front page: "Hogmanay and New Year" from 27 Dec to the last bank holiday, gone the day after (owner 2026-11-14)', () => {
  const DAY = 86_400_000;
  const dn = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY;
  const posts = frontPageHolidays('glasgow', 2026);
  const hog = posts.find((p) => p.label === 'Hogmanay and New Year')!;
  const w = frontPageConfigFor('glasgow').holiday;

  it('links to the 31 Dec section and is visible 27 Dec - 4 Jan', () => {
    expect(hog.url).toBe('/christmas/#dec-31');
    expect(postVisible(dn('2026-12-26'), hog, w)).toBe(false);
    expect(postVisible(dn('2026-12-27'), hog, w)).toBe(true);
    expect(postVisible(dn('2027-01-04'), hog, w)).toBe(true);
    expect(postVisible(dn('2027-01-05'), hog, w)).toBe(false);
  });

  it('Christmas keeps its own window: 18 to 25 Dec', () => {
    const c = posts.find((p) => p.label === 'Christmas' && p.day === dn('2026-12-25'))!;
    expect(postVisible(dn('2026-12-17'), c, w)).toBe(false);
    expect(postVisible(dn('2026-12-25'), c, w)).toBe(true);
    expect(postVisible(dn('2026-12-26'), c, w)).toBe(false);
  });

  it('the deck names the next day it is about', () => {
    const lead = (iso: string) => {
      const input: FrontPageInput = {
        cityName: 'Glasgow', timezone: TZ, locale: 'en-GB', config: frontPageConfigFor('glasgow'),
        alerts: [], holidays: posts, evening: [], games: [], meetings: [],
      };
      return selectFrontPage(input, new Date(`${iso}T10:00:00Z`)).lead;
    };
    expect(lead('2026-12-29')).toMatchObject({ type: 'holiday', headline: 'Hogmanay and New Year', url: '/christmas/#dec-31' });
    expect(lead('2026-12-29').deck[0]).toBe('Hogmanay is Thursday, 31 December.');
    expect(lead('2027-01-02').deck[0]).toBe('2 January bank holiday is Monday, 4 January.');
  });
});
