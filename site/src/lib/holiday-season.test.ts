/** Glasgow's Christmas and New Year, day by day (owner 2026-11-14, .claude/specs/glasgow-christmas-2026.md). Bank holidays are GOV.UK's
 *  Scotland list as read 2026-11-14 (config/holiday-pages/gb/bank-holidays-scotland.json); register rows are the real Cottiers rows
 *  (evening_register_entries, SELECT 2026-11-14), with the one changed field named where a test needs one. */
import { describe, expect, it } from 'vitest';
import { SCOTLAND_BANK_HOLIDAYS } from '../config/holiday-pages/gb/bank-holidays';
import { buildChristmasPage } from '../config/holiday-pages/christmas';
import { holidayPageDef } from '../config/holiday-pages/calendar';
import {
  hoursRowsMissingRunStart, factsOn, lastSeasonBankHoliday, seasonBankHolidays, seasonDays,
} from './holiday-season';
import { seasonClosureGrid } from './holiday-view';
import { dayBlocks, seasonRuns, timeText } from './holiday-festive';
import { matchRegisterRows, matchTicketmasterEvents } from './holiday-calendar-events';
import { calendarExcludesFor } from '../config/holiday-pages/registry';
import type { TicketmasterFeedItem } from './ticketmaster';
const buildExcludes = () => calendarExcludesFor('christmas', 'glasgow')!;
import { buildEveningEntries, showTitleKey, type RegisterRow } from './evening-items';
import { postVisible, selectFrontPage, type FrontPageInput } from './front-page';
import { frontPageHolidays } from './front-page-holidays';
import { buildHolidayMeta, checkedSpan, lastChecked, type ConfirmedEvent } from './holiday-page';
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

  it('one fact, one marking: a place with the same value has the same status on every day (owner 2026-11-14, ScotRail "No trains")', () => {
    const seen = new Map<string, string | undefined>();
    for (const d of days) {
      for (const f of factsOn(page, d.date)) {
        const key = `${f.label} · ${f.value}`;
        if (seen.has(key)) expect(f.change, `${key} on ${d.date}`).toBe(seen.get(key));
        seen.set(key, f.change);
      }
    }
    expect(seen.get('ScotRail · No trains')).toBe('closed');
  });

});

describe('Ticketmaster rows and series (owner 2026-11-15)', () => {
  // Real rows from the Glasgow build of 2026-11-14 (dist/whats-on/<slug>-<id>/, its JSON-LD and ticket link), no field changed.
  const PANTO = 'Òran Mór Christmas Panto: The Wonderful Wizard of Partick Cross';
  const PANTO_URL = 'https://www.universe.com/events/oran-mor-christmas-panto-the-wonderful-wizard-of-partick-cross-tickets-3KMLCY?ref=ticketmaster';
  const tm = (id: string, title: string, at: string, venueName: string, venueAddress: string, ticketUrl: string): TicketmasterFeedItem => ({
    sourceKind: 'ticketmaster', occurs_at: at,
    ticketmasterEvent: {
      id, title, attractionId: null, venueId: null, venueName, venueLatitude: null, venueLongitude: null, venueAddress, venueCity: 'Glasgow',
      venueStateCode: null, venuePostalCode: null, venueDistanceMiles: null, ticketUrl, imageUrl: null, imageWidth: null, imageHeight: null,
      priceRangeText: null, priceMin: null, priceMax: null, priceCurrency: null,
    },
  });
  const panto = (id: string, at: string) => tm(id, PANTO, at, 'Oran Mor', 'Byres Road', PANTO_URL);
  const items = [
    panto('LvZ18QJdQPF2Fw5aEYENS', '2026-11-25T12:00:00Z'),
    panto('LvZ18QJdQPF2Fw5aEYE0c', '2026-12-24T12:00:00Z'),
    panto('LvZ18QJdQPF2Fw5aEYE0g', '2026-12-28T12:00:00Z'),
    panto('LvZ18QJdQPF2Fw5aEYE0U', '2026-12-28T14:00:00Z'),
    panto('LvZ18QJdQPF2Fw5aEYEPe', '2027-01-03T14:00:00Z'),
    tm('LvZ18Qng1UQXTa27BbRcF', 'DF Concerts Presents: RED (A Red Christmas)', '2026-12-20T19:00:00Z', "Saint Luke's", '17 Bain Street',
      'https://www.universe.com/events/df-concerts-presents-red-a-red-christmas-tickets-P37FGS?ref=ticketmaster'),
    tm('1AUZkfgGkdqKIxW', 'RED (A Red Christmas)', '2026-12-20T19:00:00Z', "Saint Luke's", '17 Bain Street',
      'https://www.ticketmaster.co.uk/red-a-red-christmas-glasgow-20-12-2026/event/36006535DD4E88BD'),
  ];
  const exclude = buildExcludes();
  const now = Date.parse('2026-11-15T09:00:00Z');
  const { events, report } = matchTicketmasterEvents(xmas, 2026, items, now, TZ, exclude);

  it('excluded by id with the reason in the build log; the rest link to their ticket page and get no JSON-LD of their own', () => {
    expect(report.filter((r) => !r.included).map((r) => r.key)).toEqual(['tm:LvZ18Qng1UQXTa27BbRcF']);
    const red = events.find((e) => e.name === 'RED (A Red Christmas)')!;
    expect(red).toMatchObject({ date: '2026-12-20', startTime: '19:00', url: 'https://www.ticketmaster.co.uk/red-a-red-christmas-glasgow-20-12-2026/event/36006535DD4E88BD', fromCalendar: 'tm:1AUZkfgGkdqKIxW', checkedOn: '2026-11-15' });
    expect(red.venue).toEqual({ name: "Saint Luke's", street: '17 Bain Street', locality: 'Glasgow' });
  });

  it('the panto: one row per day with the times of that day, never a season run (festive page, owner 2026-11-26)', () => {
    const grid = seasonClosureGrid(page);
    const dec28 = dayBlocks(page, events, grid, '2026-11-15').find((b) => b.iso === '2026-12-28')!;
    const panto = [dec28.featured!, ...dec28.rows].filter((e) => e.name === PANTO);
    expect(panto).toHaveLength(1);
    expect(timeText(panto[0], 'en-GB')).toBe('Noon & 2pm');
    const dec24 = dayBlocks(page, events, grid, '2026-11-15').find((b) => b.iso === '2026-12-24')!;
    expect(timeText([dec24.featured!, ...dec24.rows].find((e) => e.name === PANTO)!, 'en-GB')).toBe('Noon');
    expect(seasonRuns(events, '2026-11-15').map((e) => e.name)).not.toContain(PANTO);
  });

  it('a Ticketmaster row is a feed row: it keeps its build-day checkedOn but never moves the page\'s "Checked" (owner 2026-11-15)', () => {
    const red = events.find((e) => e.fromCalendar === 'tm:1AUZkfgGkdqKIxW')!;
    const scotrail = page.facts.find((f) => f.status === 'confirmed' && f.label === 'ScotRail' && f.value === 'Last trains leave earlier than normal')!;
    expect([red.checkedOn, red.feed, scotrail.checkedOn]).toEqual(['2026-11-15', true, '2026-11-14']);
    const two = { ...page, facts: [scotrail], events: [red] };
    expect(checkedSpan(two)).toEqual({ first: '2026-11-14', last: '2026-11-14' });
    expect(lastChecked(two)).toBe('2026-11-14');
    expect(buildHolidayMeta(two, 'Christmas', 'Glasgow').description).toMatch(/Checked 14 Nov 2026\.$/);
    // The whole page with the Ticketmaster rows ends where it ends without them.
    expect(checkedSpan({ ...page, events: [...page.events, ...events] }).last).toBe(checkedSpan(page).last);
  });

  it('every season page: no title and venue twice in a day block', () => {
    const all = [...page.events.filter((e): e is ConfirmedEvent => e.status === 'confirmed'), ...events];
    const keys = (list: ConfirmedEvent[]) => list.map((e) => `${e.name}|${e.venue.name}`);
    for (const b of dayBlocks(page, all, seasonClosureGrid(page), '2026-11-15')) {
      const list = [...(b.featured ? [b.featured] : []), ...b.rows];
      expect(new Set(keys(list)).size).toBe(list.length);
    }
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
    expect(events.filter((e) => e.feed)).toEqual([]); // register rows count toward "Checked" as before
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

  it('Christmas keeps its own window: 11 to 25 Dec (14 days before, owner 2026-11-19)', () => {
    const c = posts.find((p) => p.label === 'Christmas' && p.day === dn('2026-12-25'))!;
    expect(postVisible(dn('2026-12-10'), c, w)).toBe(false);
    expect(postVisible(dn('2026-12-11'), c, w)).toBe(true);
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

describe("QA data.holiday-hours-dates (owner 2026-11-15): a run's standing-hours row names the run's first day", () => {
  it('the page as it is: both Winter Wonderland rows name their first day (6 November, 20 Nov)', () => {
    expect(hoursRowsMissingRunStart(page)).toEqual([]);
  });
  it("St Enoch Square's row as committed before the fix (\"6 to 20 Dec\", the only changed field) fails", () => {
    const before = '6 to 20 Dec: Sun–Wed 12 noon–9pm, Thu–Fri 12 noon–10pm, Sat 10am–10pm. 21 to 23 Dec: 10am–10pm.';
    const old = { ...page, facts: page.facts.map((f) => (f.status === 'confirmed' && f.label === 'Winter Wonderland, St Enoch Square (regular hours)' ? { ...f, value: before } : f)) };
    expect(hoursRowsMissingRunStart(old)).toEqual([`Winter Wonderland, St Enoch Square (regular hours): does not name the run's first day 6 November ("${before}")`]);
  });
});
