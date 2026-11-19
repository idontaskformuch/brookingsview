import { describe, expect, it } from 'vitest';
import { buildHolidayEventsJsonLd, buildHolidayMeta, isBlockedHost, type HolidayPageData } from './holiday-page';
import { pageWindow, resolvePageState } from './holiday-calendar';
import { buildChristmasPage, CHRISTMAS_TOWN_IDS } from '../config/holiday-pages/christmas';
import { brookingsChristmasMoves, TOWN_CENTRE } from '../config/holiday-pages/christmas-us';
import { buildGroups } from './holiday-view';
import { calendarExcludesFor, holidayPageFor } from '../config/holiday-pages/registry';

/** US /christmas/ 2026 (owner 2026-11-18, .claude/specs/us-christmas-2026.md). Rows are the real ones named in the spec. */
const US = [
  { id: 'brookings_sd', city: 'Brookings', tz: 'America/Chicago' },
  { id: 'moreno_valley_ca', city: 'Moreno Valley', tz: 'America/Los_Angeles' },
  { id: 'broomfield_co', city: 'Broomfield', tz: 'America/Denver' },
];
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const page = (id: string) => buildChristmasPage(id)!;
const fact = (p: HolidayPageData, label: string) => p.facts.find((f) => f.label === label)!;

describe('US Christmas pages exist for all three towns', () => {
  it('builds a page with a confirmed row in every US town, en-US, H1 per B2', () => {
    expect([...CHRISTMAS_TOWN_IDS].sort()).toEqual(['brookings_sd', 'broomfield_co', 'glasgow', 'moreno_valley_ca']);
    for (const t of US) {
      const entry = holidayPageFor('christmas', t.id);
      expect(entry, t.id).not.toBeNull();
      expect(entry!.page.locale).toBe('en-US');
      expect(entry!.page.h1).toBe(`Christmas and New Year's in ${t.city}`);
      expect(buildHolidayMeta(entry!.page, 'Christmas', t.city, true).h1).toBe(`Christmas and New Year's in ${t.city}`);
    }
  });
});

describe('window (B1): US Nov 28 to Jan 3, Glasgow unchanged', () => {
  it('US towns open Nov 28 and are gone Jan 4', () => {
    for (const t of US) {
      const { def } = holidayPageFor('christmas', t.id)!;
      const w = pageWindow(def, 2026);
      expect(iso(w.start), t.id).toBe('2026-11-28');
      expect(iso(w.endExclusive), t.id).toBe('2027-01-04');
      expect(resolvePageState(def, 2026, Date.parse('2026-11-27T18:00:00Z'), t.tz).kind).toBe('evergreen');
      expect(resolvePageState(def, 2026, Date.parse('2026-11-28T18:00:00Z'), t.tz).kind).toBe('active');
      expect(resolvePageState(def, 2026, Date.parse('2027-01-03T18:00:00Z'), t.tz).kind).toBe('active');
      expect(resolvePageState(def, 2026, Date.parse('2027-01-04T18:00:00Z'), t.tz).kind).toBe('evergreen');
    }
  });

  it("Glasgow keeps its window (91 days before, Scotland's last bank holiday Mon 4 Jan)", () => {
    const w = pageWindow(holidayPageFor('christmas', 'glasgow')!.def, 2026);
    expect(iso(w.start)).toBe('2026-09-25');
    expect(iso(w.endExclusive)).toBe('2027-01-05');
  });
});

describe('Brookings', () => {
  it("recycling moves from the city's rule, both Friday holidays", () => {
    expect(brookingsChristmasMoves()).toEqual({
      south: ['Christmas week: Recycling: Thursday to Wednesday', "New Year's week: Recycling: Thursday to Wednesday"],
      north: ['Christmas week: Recycling: Friday to Thursday', "New Year's week: Recycling: Friday to Thursday"],
    });
  });

  it('city offices keep the source\'s "in most cases"; landfill and offices are confirmed from the owner\'s read', () => {
    const p = page('brookings_sd');
    const offices = fact(p, 'City offices');
    expect(offices.status).toBe('confirmed');
    expect(offices.status === 'confirmed' && offices.value).toMatch(/in most cases/i);
    expect(fact(p, 'Landfill').status).toBe('confirmed');
    expect(p.facts.some((f) => /eve\b/i.test(f.label))).toBe(false);
  });

  it('lists the SDSU rows once per performance, without the all-day duplicates or the AHPS reception (B4)', () => {
    const p = page('brookings_sd');
    expect(p.events.map((e) => e.name)).not.toContain('AHPS Holiday Reception');
    const dance = p.events.filter((e) => e.name === 'A Christmas Celebration Dance Concert');
    expect(dance.map((e) => e.status === 'confirmed' && `${e.date} ${e.startTime}`)).toEqual(['2026-12-04 19:00', '2026-12-05 19:00', '2026-12-06 14:00']);
    expect(p.events.filter((e) => e.name === 'Santa Visits McCrory Gardens')).toHaveLength(4);
  });
});

describe('Moreno Valley', () => {
  it('library closed at all locations Dec 24, Dec 25 and Jan 1, as the library calendar says (B3, owner 2026-11-18)', () => {
    const p = page('moreno_valley_ca');
    const lib = fact(p, 'Library (all locations)');
    expect(lib.status).toBe('confirmed');
    expect(lib.status === 'confirmed' && lib.closedOn).toEqual(['2026-12-24', '2026-12-25', '2027-01-01']);
    expect(p.facts.some((f) => /iris plaza branch|main library and/i.test(f.label))).toBe(false);
  });

  it('keeps the library closure rows out of Events by key', () => {
    const ex = calendarExcludesFor('christmas', 'moreno_valley_ca')!;
    for (const k of ['event-197946', 'event-303459', 'event-204322', 'event-303461']) expect(ex[k], k).toBeTruthy();
  });
});

describe('Moreno Valley events (city pages read 2026-11-18)', () => {
  it('tree lighting at City Hall 5-8 p.m. and Snow Day 10 a.m.-5 p.m., both Sat Dec 5', () => {
    const ev = page('moreno_valley_ca').events.flatMap((e) => (e.status === 'confirmed' && !e.nearby ? [`${e.name} ${e.date} ${e.startTime}-${e.endTime} ${e.venue.name}`] : []));
    expect(ev).toEqual([
      'Holiday Snow Day 2026-12-05 10:00-17:00 Civic Center Amphitheater',
      'Holiday Tree Lighting Ceremony 2026-12-05 17:00-20:00 City Hall',
    ]);
  });
});

describe('Brookings Festival of Lights (downtownbrookings.com read 2026-11-18, one robots mode)', () => {
  it('parade 7 p.m. and the Mayor\'s tree lighting 6 p.m. on Fri Dec 4; no separate pre-parade party or bazaar row', () => {
    const p = page('brookings_sd');
    const rows = p.events.flatMap((e) => (e.status === 'confirmed' && e.url.includes('downtownbrookings') ? [`${e.name} ${e.date} ${e.startTime}`] : []));
    expect(rows).toEqual(["Mayor's Holiday Tree Lighting 2026-12-04 18:00", 'Festival of Lights Parade 2026-12-04 19:00']);
    expect(p.events.some((e) => /pre-parade|bazaar/i.test(e.name))).toBe(false);
    expect(p.linkOnly).toEqual([]);
  });
});

describe('Broomfield', () => {
  it('the city closing stays unconfirmed (compass is blocked) and holds the count; no blocked host as source or pointer', () => {
    const p = page('broomfield_co');
    const city = fact(p, 'City and County closed for the holiday (dates pending)');
    expect(city.status).toBe('unconfirmed');
    expect(city.holdsCount).toBe(true);
    for (const f of p.facts) {
      expect(isBlockedHost(f.source.url), f.label).toBe(false);
      if (f.status === 'unconfirmed' && f.checkAt?.url) expect(isBlockedHost(f.checkAt.url), f.label).toBe(false);
    }
    expect(p.events.filter((e) => !(e.status === 'confirmed' && e.nearby)).map((e) => e.name)).toEqual(['Holiday Tree Lighting Ceremony', 'Le Ugly Sweater Run à LaBelle French Bakery', '1940s Winter Ball with the Glenn Miller Orchestra']);
    // compass.broomfield.org entries (symphony, community players) are not rows: robots.txt disallows us.
    expect(p.events.some((e) => /symphony|players/i.test(e.name))).toBe(false);
  });
});

describe('Event JSON-LD only for confirmed, timed events', () => {
  it('one JSON-LD object per confirmed event with a start time, in every US town', () => {
    for (const t of US) {
      const p = page(t.id);
      const expected = p.events.filter((e) => e.status === 'confirmed' && !!e.startTime && !e.fromCalendar).length;
      expect(buildHolidayEventsJsonLd(p, t.tz, 'US'), t.id).toHaveLength(expected);
    }
  });

  it("every Event carries the page's band photo as image when given, none without (Search Console, owner 2026-11-18)", () => {
    // Real band photo on brookingsview.com/christmas/ (build 2026-11-19).
    const band = 'https://brookingsview.com/assets/images/holidays/brookings_sd-christmas-04-960.webp';
    const withImage = buildHolidayEventsJsonLd(page('brookings_sd'), 'America/Chicago', 'US', undefined, band);
    expect(withImage.length).toBeGreaterThan(0);
    for (const ld of withImage) expect(ld.image, String(ld.name)).toEqual([band]);
    for (const ld of buildHolidayEventsJsonLd(page('brookings_sd'), 'America/Chicago', 'US')) expect(ld.image).toBeUndefined();
  });
});

describe('Nearby (NB1/NB2, owner 2026-11-18)', () => {
  it('cached town centres equal site-config townCenter', async () => {
    const { ALL_CONFIGS } = await import('./site-config');
    for (const t of US) expect(TOWN_CENTRE[t.id], t.id).toEqual(ALL_CONFIGS.find((c) => c.townId === t.id)!.townCenter);
  });

  it('every US page has a Nearby group after Events, each row with "about N min drive"', () => {
    const expected: Record<string, string> = {
      brookings_sd: 'Winter Wonderland at The Falls',
      moreno_valley_ca: 'Mission Inn Hotel & Spa Festival of Lights',
      broomfield_co: 'Denver Christkindlmarket',
    };
    for (const t of US) {
      const groups = buildGroups(page(t.id), '2026-11-28', '2026-12-25');
      const ids = groups.map((g) => g.id);
      expect(ids.indexOf('nearby'), t.id).toBeGreaterThan(ids.indexOf('events'));
      const nearby = groups.find((g) => g.id === 'nearby')!;
      expect(nearby.heading).toBe('Nearby');
      expect(nearby.rows.map((r) => r.name)).toContain(expected[t.id]);
      for (const r of nearby.rows) expect(r.parts[0], `${t.id} ${r.name}`).toMatch(/about \d+ min drive$/);
      expect(groups.find((g) => g.id === 'events')!.rows.some((r) => /mi away|min drive/.test(r.parts[0] ?? ''))).toBe(false);
    }
  });

  it('a page without nearbySection keeps nearby rows under Events (Thanksgiving, Glasgow unchanged)', () => {
    const p = page('moreno_valley_ca');
    const { nearbySection: _drop, ...rest } = p;
    void _drop;
    const groups = buildGroups(rest as HolidayPageData, '2026-11-28', '2026-12-25');
    expect(groups.some((g) => g.id === 'nearby')).toBe(false);
  });
});

describe('titles (owner 2026-11-18): big event first, only confirmed (full matrix: holiday-title.test.ts)', () => {
  it('falls back to the section words when the headline event is not confirmed', () => {
    const p = page('brookings_sd');
    const without = { ...p, events: p.events.filter((e) => e.name !== 'Festival of Lights Parade') };
    expect(buildHolidayMeta(without, 'Christmas', 'Brookings', false).title).toBe('Christmas 2026 in Brookings: closures, trash pickup, events');
    const unconfirmed = {
      ...p,
      events: p.events.map((e) => (e.name === 'Festival of Lights Parade'
        ? { name: e.name, status: 'unconfirmed' as const, checkedOn: e.checkedOn, source: e.source, checkAt: { label: 'x', url: e.source.url } }
        : e)),
    };
    expect(buildHolidayMeta(unconfirmed, 'Christmas', 'Brookings', false).title).toBe('Christmas 2026 in Brookings: closures, trash pickup, events');
  });

  it('the Brookings description names the parade only while its row is confirmed from downtownbrookings.com', () => {
    const p = page('brookings_sd');
    const parade = p.events.find((e) => e.name === 'Festival of Lights Parade')!;
    expect(parade.status).toBe('confirmed');
    expect(new URL(parade.source.url).hostname).toBe('www.downtownbrookings.com');
    expect(buildHolidayMeta(p, 'Christmas', 'Brookings', false).description).toContain('Festival of Lights parade Dec 4');
    const without = { ...p, events: p.events.filter((e) => e !== parade) };
    expect(buildHolidayMeta(without, 'Christmas', 'Brookings', false).description).not.toContain('Festival of Lights');
  });
});
