import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  pageState, resolvePageState, nextOccurrence, activeHoliday, evergreenLines, formatDayLong, formatDayShort, pageWindow,
} from './holiday-calendar';
import { buildHolidayMeta, buildHolidayEventsJsonLd, hasConfirmedRow, DESCRIPTION_MAX, type HolidayPageData } from './holiday-page';
import { resolveNav, enabledSections } from './nav-sections';
import { ALL_CONFIGS } from './site-config';
import { HOLIDAY_PAGE_DEFS, holidayPageDef } from '../config/holiday-pages/calendar';
import { holidayPageFor, holidayPagesForTown, holidayListing, activeHolidayCard } from '../config/holiday-pages/registry';
import { holidayLastmodEntries, readDataUpdated } from '../config/holiday-pages/lastmod.mjs';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const D = (y: number, m: number, d: number, h = 12) => Date.UTC(y, m - 1, d, h);
const vet = holidayPageDef('veterans-day')!;
const thx = holidayPageDef('thanksgiving')!;
const xmas = holidayPageDef('christmas')!;
const TOWNS = ['brookings_sd', 'moreno_valley_ca', 'broomfield_co', 'glasgow'];
const UTC = 'UTC';
const TOWN_TZ = Object.fromEntries(ALL_CONFIGS.map((c) => [c.townId, c.timezone])) as Record<string, string>;

type Evergreen = Extract<ReturnType<typeof pageState>, { kind: 'evergreen' }>;

describe('page windows (owner 2026-11-04)', () => {
  it('Veterans Day: Nov 1 through Nov 11 2026 active (owner 2026-11-11: closes on the day), then evergreen with the next day in 2027', () => {
    expect(pageState(vet, D(2026, 10, 31, 23), UTC).kind).toBe('evergreen');
    expect(pageState(vet, D(2026, 11, 1, 0), UTC).kind).toBe('active');
    expect(pageState(vet, D(2026, 11, 11, 23), UTC).kind).toBe('active');
    expect(pageState(vet, D(2026, 11, 12, 0), UTC).kind).toBe('evergreen');
    const after = pageState(vet, D(2026, 11, 12, 0), UTC) as Evergreen;
    expect(after.kind).toBe('evergreen');
    expect(after.nextYear).toBe(2027);
    expect(formatDayLong(after.nextDay)).toBe('Thursday, Nov 11, 2027'); // Nov 11 2027 is a Thursday
  });
  it('Thanksgiving: Nov 16 through Nov 27 2026', () => {
    expect(pageState(thx, D(2026, 11, 15, 23), UTC).kind).toBe('evergreen');
    expect(pageState(thx, D(2026, 11, 16, 0), UTC).kind).toBe('active');
    expect(pageState(thx, D(2026, 11, 27, 23), UTC).kind).toBe('active');
    expect(pageState(thx, D(2026, 11, 28, 0), UTC).kind).toBe('evergreen');
  });
  it('Christmas (Glasgow): Sep 25 2026 through Jan 3 2027, across New Year', () => {
    expect(pageState(xmas, D(2026, 9, 24, 23), UTC).kind).toBe('evergreen');
    expect(pageState(xmas, D(2026, 9, 25, 0), UTC).kind).toBe('active');
    expect(pageState(xmas, D(2027, 1, 3, 23), UTC)).toMatchObject({ kind: 'active', year: 2026 });
    expect(pageState(xmas, D(2027, 1, 4, 0), UTC).kind).toBe('evergreen');
    expect(new Date(pageWindow(xmas, 2026).start).toISOString().slice(0, 10)).toBe('2026-09-25');
  });
  it('a window open for a season the data does not cover is evergreen, never stale facts under a fresh title', () => {
    expect(resolvePageState(vet, 2026, D(2026, 11, 5), UTC).kind).toBe('active');
    expect(resolvePageState(vet, 2026, D(2027, 11, 5), UTC).kind).toBe('evergreen');
  });
  it('the photo pool window is a separate field and is untouched', async () => {
    const { HOLIDAYS } = await import('../config/holidays');
    expect(HOLIDAYS.find((h) => h.id === 'thanksgiving')!.windowDays).toBe(7);
    expect(HOLIDAYS.find((h) => h.id === 'christmas')!.windowDays).toBe(14);
    expect(HOLIDAYS.find((h) => h.id === 'veterans_day')!.windowDays).toBe(3);
  });
  it("each town's window opens and closes at the town's own midnight, not UTC's (2026-11-12)", () => {
    const zones = ['America/Chicago', 'America/Los_Angeles', 'America/Denver', 'Europe/London'];
    expect(new Set(Object.values(TOWN_TZ))).toEqual(new Set(zones));
    // Local wall-clock time in `tz` as a UTC instant (two passes, right across the Nov 1 US summer-time end).
    const L = (tz: string, y: number, m: number, d: number, h: number, min = 0) => {
      const want = Date.UTC(y, m - 1, d, h, min);
      const offset = (t: number) => {
        const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
          .formatToParts(new Date(t));
        const g = (k: string) => Number(p.find((x) => x.type === k)!.value);
        return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute')) - t;
      };
      const first = want - offset(want);
      return want - offset(first);
    };
    for (const tz of zones) {
      // Veterans Day (Nov 1 - Nov 11): open all of the 11th locally, closed at the town's midnight
      expect(pageState(vet, L(tz, 2026, 10, 31, 23, 59), tz).kind).toBe('evergreen');
      expect(pageState(vet, L(tz, 2026, 11, 1, 0, 0), tz).kind).toBe('active');
      expect(pageState(vet, L(tz, 2026, 11, 11, 18, 0), tz).kind).toBe('active');
      expect(pageState(vet, L(tz, 2026, 11, 11, 23, 59), tz).kind).toBe('active');
      expect(pageState(vet, L(tz, 2026, 11, 12, 0, 0), tz).kind).toBe('evergreen');
      // Thanksgiving (Nov 16 - Nov 27)
      expect(pageState(thx, L(tz, 2026, 11, 15, 23, 59), tz).kind).toBe('evergreen');
      expect(pageState(thx, L(tz, 2026, 11, 16, 0, 0), tz).kind).toBe('active');
      expect(pageState(thx, L(tz, 2026, 11, 27, 23, 59), tz).kind).toBe('active');
      expect(pageState(thx, L(tz, 2026, 11, 28, 0, 0), tz).kind).toBe('evergreen');
      // the day the window holds is the town's day: on the evening of Nov 11 the next Veterans Day is still today
      expect(nextOccurrence(vet, L(tz, 2026, 11, 11, 23, 0), tz).year).toBe(2026);
      expect(nextOccurrence(vet, L(tz, 2026, 11, 12, 0, 30), tz).year).toBe(2027);
    }
  });
  it('Glasgow: Christmas window across New Year and the summer-time switch, at local midnight', () => {
    const tz = 'Europe/London';
    // Sep 25 opens at 00:00 BST = Sep 24 23:00 UTC
    expect(pageState(xmas, Date.UTC(2026, 8, 24, 22, 59), tz).kind).toBe('evergreen');
    expect(pageState(xmas, Date.UTC(2026, 8, 24, 23, 0), tz).kind).toBe('active');
    // Jan 3 closes at 00:00 GMT on Jan 4
    expect(pageState(xmas, Date.UTC(2027, 0, 3, 23, 59), tz)).toMatchObject({ kind: 'active', year: 2026 });
    expect(pageState(xmas, Date.UTC(2027, 0, 4, 0, 0), tz).kind).toBe('evergreen');
    // New Year's Eve 23:30 is still the 2026 window on the town's day
    expect(pageState(xmas, Date.UTC(2026, 11, 31, 23, 30), tz)).toMatchObject({ kind: 'active', year: 2026 });
  });
  it('the old UTC cut: at 6pm MST on Nov 11 (01:00 UTC Nov 12) Broomfield still shows Veterans Day', () => {
    expect(activeHolidayCard('broomfield_co', Date.UTC(2026, 10, 12, 1), TOWN_TZ.broomfield_co)?.def.slug).toBe('veterans-day');
    expect(activeHolidayCard('broomfield_co', Date.UTC(2026, 10, 12, 7), TOWN_TZ.broomfield_co)).toBeNull();
  });
  it('next occurrence: today counts, the day after rolls to next year', () => {
    expect(nextOccurrence(vet, D(2026, 11, 11, 20), UTC).year).toBe(2026);
    expect(nextOccurrence(vet, D(2026, 11, 12, 1), UTC).year).toBe(2027);
  });
});

describe('evergreen wording is per holiday and uses years, never "last year"', () => {
  it('Veterans Day and Thanksgiving use the hours sentence', () => {
    const v = evergreenLines(vet, 2026, pageState(vet, D(2026, 12, 20), UTC) as Evergreen);
    expect(v.note).toBe("These are the 2026 hours. 2027 hours will be added when they're announced.");
    expect(v.next).toBe('Next Veterans Day: Thursday, Nov 11, 2027');
    expect(evergreenLines(thx, 2026, pageState(thx, D(2026, 12, 20), UTC) as Evergreen).note).toContain('2027 hours will be added');
  });
  it('Christmas has its own sentence and en-GB date', () => {
    const l = evergreenLines(xmas, 2026, pageState(xmas, D(2027, 2, 1), UTC) as Evergreen, 'en-GB');
    expect(l.note).toBe("These are the 2026 festive dates and times. 2027 festive dates and times will be added when they're announced.");
    expect(l.next).toBe('Next Christmas: Saturday 25 Dec 2027');
  });
  it('before the window, while the data is already the coming season, there is no "will be added" line', () => {
    expect(evergreenLines(vet, 2026, pageState(vet, D(2026, 10, 20), UTC) as Evergreen).note).toBeNull();
  });
  it('no relative year label anywhere in the page code or wording', () => {
    for (const d of HOLIDAY_PAGE_DEFS) expect(d.evergreenNote(2026, 2027)).not.toMatch(/last year/i);
    for (const f of ['HolidayRow', 'HolidayRows']) expect(read(`../components/${f}.astro`)).not.toMatch(/last year/i);
    expect(read('../lib/holiday-view.ts')).not.toMatch(/last year/i);
    expect(read('../components/HolidayPage.astro')).not.toMatch(/last year/i);
  });
});

describe('titles: year inside the window, none outside; always indexable', () => {
  const vp = holidayPageFor('veterans-day', 'broomfield_co')!;
  const tp = holidayPageFor('thanksgiving', 'broomfield_co')!;
  it('Veterans Day keeps the approved title inside and a year-free one outside', () => {
    expect(buildHolidayMeta(vp.page, 'Veterans Day', 'Broomfield', false).title).toBe("Veterans Day 2026 in Broomfield: what's closed on Nov 11");
    const out = buildHolidayMeta(vp.page, 'Veterans Day', 'Broomfield', true);
    expect(out.title).toBe('Veterans Day in Broomfield: closures and hours');
    expect(out.title + out.h1).not.toMatch(/20\d\d/);
    expect(out.description).toContain('2026');
    expect(out.description.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });
  it('a derived page (Thanksgiving) drops the year from title and H1 outside, keeps it in the description', () => {
    const a = buildHolidayMeta(tp.page, 'Thanksgiving', 'Broomfield', false);
    const b = buildHolidayMeta(tp.page, 'Thanksgiving', 'Broomfield', true);
    expect(a.title).toMatch(/2026/);
    expect(b.title + b.h1).not.toMatch(/20\d\d/);
    expect(b.description.startsWith('2026: ')).toBe(true);
    expect(b.description.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });
  it('no page or config sets noindex for a holiday page any more', () => {
    const cfg = read('../../astro.config.mjs');
    for (const slug of ['thanksgiving', 'veterans-day', 'christmas']) {
      expect(cfg).not.toContain(`noindexThinPageUrls.add('/${slug}/')`);
      expect(cfg).not.toContain(`{ path: '/${slug}/'`);
    }
    for (const f of ['../pages/[holiday].astro', '../pages/holidays.astro', '../components/HolidayPage.astro']) {
      expect(read(f), f).not.toMatch(/noindex=|noindex\b.*true/);
    }
  });
});

describe('Event JSON-LD only for events that have not passed', () => {
  const vp = holidayPageFor('veterans-day', 'broomfield_co')!.page;
  it('on the day: one Event; the day after: none, but the event row is still on the page', () => {
    expect(buildHolidayEventsJsonLd(vp, 'America/Denver', 'US', '2026-11-11')).toHaveLength(1);
    expect(buildHolidayEventsJsonLd(vp, 'America/Denver', 'US', '2026-11-12')).toHaveLength(0);
    expect(vp.events).toHaveLength(1);
  });
  it('a multi-day run stays until its last day', () => {
    const g = holidayPageFor('christmas', 'glasgow')!.page;
    expect(buildHolidayEventsJsonLd(g, 'Europe/London', 'GB', '2026-12-26').length).toBeGreaterThan(0);
    expect(buildHolidayEventsJsonLd(g, 'Europe/London', 'GB', '2027-01-04')).toHaveLength(0);
  });
  it('the page marks a passed event with its dated year', () => {
    const src = read('../lib/holiday-view.ts');
    expect(src).toContain('isEventPast(e, today)');
    expect(src).toContain('Held ');
  });
});

describe('which towns get which pages (confirmed row required, otherwise no page at all)', () => {
  const slugs = (t: string) => holidayPagesForTown(t).map((e) => e.def.slug).sort();
  it('matches the approved scope', () => {
    expect(slugs('brookings_sd')).toEqual(['thanksgiving']);
    expect(slugs('moreno_valley_ca')).toEqual(['thanksgiving']);
    expect(slugs('broomfield_co')).toEqual(['thanksgiving', 'veterans-day']);
    expect(slugs('glasgow')).toEqual(['christmas']);
    expect(holidayPageFor('veterans-day', 'brookings_sd')).toBeNull();
  });
  it('a page with only unconfirmed rows is not a page', () => {
    const base = holidayPageFor('veterans-day', 'broomfield_co')!.page;
    const empty: HolidayPageData = { ...base, facts: base.facts.filter((f) => f.status === 'unconfirmed'), events: [] };
    expect(hasConfirmedRow(empty)).toBe(false);
    expect(hasConfirmedRow(base)).toBe(true);
  });
  it('the routes build a file only for a town with a page: a real 404 elsewhere, never a redirect', () => {
    const route = read('../pages/[holiday].astro');
    expect(route).toContain('getStaticPaths');
    expect(route).not.toContain('Astro.redirect');
    const list = read('../pages/holidays.astro');
    expect(list).toContain('townHasHolidayPages(siteConfig.townId) ?');
    expect(list).not.toContain('Astro.redirect');
  });
});

describe('/holidays/ listing and the single context card', () => {
  it('lists the next holiday first, in calendar order', () => {
    expect(holidayListing('broomfield_co', D(2026, 11, 5), TOWN_TZ.broomfield_co).map((e) => e.def.slug)).toEqual(['veterans-day', 'thanksgiving']);
    expect(holidayListing('broomfield_co', D(2026, 11, 14), TOWN_TZ.broomfield_co).map((e) => e.def.slug)).toEqual(['thanksgiving', 'veterans-day']);
  });
  it('the card shows only inside a window, and only one', () => {
    expect(activeHolidayCard('broomfield_co', D(2026, 11, 5), TOWN_TZ.broomfield_co)?.def.slug).toBe('veterans-day');
    expect(activeHolidayCard('broomfield_co', D(2026, 11, 14), TOWN_TZ.broomfield_co)).toBeNull(); // between the two windows
    expect(activeHolidayCard('broomfield_co', D(2026, 11, 20), TOWN_TZ.broomfield_co)?.def.slug).toBe('thanksgiving');
    expect(activeHolidayCard('brookings_sd', D(2026, 7, 1), TOWN_TZ.brookings_sd)).toBeNull();
    expect(activeHolidayCard('glasgow', D(2026, 12, 20), TOWN_TZ.glasgow)?.def.slug).toBe('christmas');
    expect(activeHolidayCard('glasgow', D(2027, 1, 10), TOWN_TZ.glasgow)).toBeNull();
  });
  it('with two open windows the nearest holiday wins', () => {
    const entries = [{ def: xmas }, { def: vet }];
    expect(activeHoliday(entries, D(2026, 11, 5), UTC)?.def.slug).toBe('veterans-day');
    expect(activeHoliday(entries, D(2026, 12, 20), UTC)?.def.slug).toBe('christmas');
  });
  it('the card renders one aside at most and is on /events/ only (the front page leads with the holiday itself, lib/front-page.ts)', () => {
    expect(read('../components/HolidayContextCard.astro').match(/<aside/g)).toHaveLength(1);
    expect(read('../pages/index.astro')).not.toContain('HolidayContextCard');
    expect(read('../pages/events.astro').match(/<HolidayContextCard \/>/g)).toHaveLength(1);
    expect(formatDayShort(D(2026, 11, 11, 0), 'en-US')).toBe('Nov 11');
    expect(formatDayShort(D(2026, 12, 25, 0), 'en-GB')).toBe('25 Dec');
  });
});

describe('navigation: one entry in the All sheet, never a tab', () => {
  const TABS_BEFORE: Record<string, number> = { brookings_sd: 3, moreno_valley_ca: 3, broomfield_co: 3, glasgow: 3 };
  it('the swipe row has the same number of tabs as before, with no holiday page in it', () => {
    for (const c of ALL_CONFIGS) {
      const r = resolveNav(c.nav, c);
      expect(r.tabs.length, c.townId).toBe(TABS_BEFORE[c.townId]);
      expect(c.nav.tabs, c.townId).not.toContain('holidays');
      for (const t of r.tabs) expect(t.href, c.townId).not.toMatch(/thanksgiving|veterans-day|christmas|holidays/);
    }
  });
  it('every town with a holiday page has Holidays once in a group of the sheet, linking to /holidays/', () => {
    for (const c of ALL_CONFIGS) {
      const items = resolveNav(c.nav, c).groups.flatMap((g) => g.items);
      const holidays = items.filter((i) => i.id === 'holidays');
      expect(holidays, c.townId).toHaveLength(1);
      expect(holidays[0].href).toBe('/holidays/');
      expect(items.filter((i) => /thanksgiving|veterans-day|christmas/.test(i.href)), c.townId).toHaveLength(0);
    }
  });
  it('a town without any holiday page has no Holidays entry', () => {
    const noPages = { ...ALL_CONFIGS[0], townId: 'nowhere' };
    expect(enabledSections(noPages).some((s) => s.id === 'holidays')).toBe(false);
  });
});

describe('sitemap lastmod = the day a row last changed, never the build', () => {
  afterEach(() => vi.useRealTimers());
  it('is identical on every build, whatever the clock says', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-05T08:00:00Z'));
    const a = [...holidayLastmodEntries('broomfield_co')];
    vi.setSystemTime(new Date('2027-06-30T23:59:00Z'));
    const b = [...holidayLastmodEntries('broomfield_co')];
    expect(b).toEqual(a);
    expect(new Map(a).get('/veterans-day/')).toBe(readDataUpdated()['veterans-day'].broomfield_co);
  });
  it("/holidays/ takes the newest date of the town's pages; a town without pages has none", () => {
    const m = holidayLastmodEntries('broomfield_co');
    expect(m.get('/holidays/')).toBe([m.get('/veterans-day/')!, m.get('/thanksgiving/')!].sort().pop());
    expect(holidayLastmodEntries('nowhere').size).toBe(0);
  });
  it('data-updated.json lists exactly the pages that exist, and each page carries its date', () => {
    const json = readDataUpdated();
    for (const d of HOLIDAY_PAGE_DEFS) {
      for (const town of TOWNS) {
        const e = holidayPageFor(d.slug, town);
        expect(Boolean(json[d.slug]?.[town]), `${d.slug}/${town}`).toBe(e !== null);
        if (e) {
          expect(e.page.dataUpdatedOn).toBe(json[d.slug][town]);
          expect(e.page.dataUpdatedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
      }
    }
  });
  it('the date is a hand-kept value: never derived from the clock or from checkedOn, and wired into the sitemap', () => {
    expect(read('../config/holiday-pages/data-updated.ts')).not.toMatch(/Date\.now|new Date|checkedOn/);
    expect(read('../config/holiday-pages/lastmod.mjs')).not.toMatch(/Date\.now|new Date/);
    expect(read('../../astro.config.mjs')).toContain('holidayLastmodEntries(activeCity)');
  });
});
