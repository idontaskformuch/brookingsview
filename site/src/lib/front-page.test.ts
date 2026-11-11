import { describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import {
  selectFrontPage, holidayVisible, inWeekendWindow, dayOfYear, metaDescriptionOf, FRONT_PAGE_PRIORITY,
  type FrontPageInput, type FrontPageItem, type FrontPageAlert, type FrontPageGame,
} from './front-page';
import { frontPageHolidays } from './front-page-holidays';
import { FRONT_PAGE_BY_TOWN } from '../config/front-page';
import { ELECTION_BY_TOWN } from '../config/election';
import type { EveningEntry } from './evening-items';
import type { MeetingView } from './meetings-view';

const TOWNS = [
  { id: 'broomfield_co', city: 'Broomfield', tz: 'America/Denver', locale: 'en-US' as const },
  { id: 'brookings_sd', city: 'Brookings', tz: 'America/Chicago', locale: 'en-US' as const },
  { id: 'moreno_valley_ca', city: 'Moreno Valley', tz: 'America/Los_Angeles', locale: 'en-US' as const },
  { id: 'glasgow', city: 'Glasgow', tz: 'Europe/London', locale: 'en-GB' as const },
];
const BF = TOWNS[0];
const BF_CFG = FRONT_PAGE_BY_TOWN.broomfield_co;
const CITIES_WITH_TRAFFIC = new Set(['broomfield_co', 'moreno_valley_ca']); // the towns whose site-config has a trafficSource
const dayOf = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`) / 86_400_000;

const entry = (id: string, title: string, start: string, venue: string | null = 'The Venue'): EveningEntry => ({
  id, title, start, end: null, group: 'Live music', labels: [], venue, href: `/events/${id}/`, source: 'own',
  distanceMiles: null, driveMinutes: null, checked: '2026-11-06',
});
const meeting = (o: Partial<MeetingView>): MeetingView => ({
  id: 1, source: 'legistar', bodyKey: 'council', bodyLabel: 'City Council', tone: 'civic' as any, typeLabel: null, closed: false, unknownOrgan: false,
  chipLabel: 'City Council', collapsedGroup: null, ymd: '2026-11-10', dateLabel: 'Tue, Nov 10', time: '6:00 PM', startMs: null, location: null,
  agendaUrl: null, minutesUrl: null, videoUrl: null, detailUrl: null, storySlug: null, items: ['Water rate study', 'Budget amendment'], topics: [],
  jointWith: null, quorumNotice: false, cancelled: false, postponed: false, firstSeen: null, agendaPublished: null, ...o,
} as MeetingView);

function input(town = BF, over: Partial<FrontPageInput> = {}, now = new Date('2026-11-02T18:00:00Z')): FrontPageInput {
  return {
    cityName: town.city, timezone: town.tz, locale: town.locale, config: FRONT_PAGE_BY_TOWN[town.id],
    alerts: [], holidays: frontPageHolidays(town.id, now.getUTCFullYear()), evening: [], games: [], meetings: [], ...over,
  };
}
const all = (fp: { lead: FrontPageItem; secondaries: FrontPageItem[] }) => [fp.lead, ...fp.secondaries];
const BAD = /[{}]|undefined|null|NaN|\b0 items\b/;

describe('holidayVisible (window from config: 7 before, the day, 0 after)', () => {
  const w = { daysBefore: 7, showOnDay: true, daysAfter: 0, leadWithinDays: 3 };
  it('opens 7 days ahead, includes the day, closes the day after', () => {
    expect(holidayVisible(100 - 8, 100, w)).toBe(false);
    expect(holidayVisible(100 - 7, 100, w)).toBe(true);
    expect(holidayVisible(100, 100, w)).toBe(true);
    expect(holidayVisible(101, 100, w)).toBe(false);
  });
  it('honours showOnDay=false and daysAfter', () => {
    expect(holidayVisible(100, 100, { ...w, showOnDay: false })).toBe(false);
    expect(holidayVisible(102, 100, { ...w, daysAfter: 2 })).toBe(true);
    expect(holidayVisible(103, 100, { ...w, daysAfter: 2 })).toBe(false);
  });
});

describe('Veterans Day (Wed 11 Nov 2026): visible 4-11 Nov, gone 12 Nov', () => {
  for (const t of [BF]) { // the only town with a Veterans Day page
    it(`${t.city}`, () => {
      const at = (d: string) => new Date(`2026-11-${d}T18:00:00Z`);
      const labels = (d: string) => all(selectFrontPage(input(t, {}, at(d)), at(d))).filter((x) => x.type === 'holiday').map((x) => x.headline);
      expect(labels('03')).not.toContain('Veterans Day');
      for (const d of ['04', '07', '10', '11']) expect(labels(d)).toContain('Veterans Day');
      expect(labels('12')).not.toContain('Veterans Day');
    });
  }
  it('the day itself is decided in city time, not UTC (Broomfield 11 Nov 20:00 local = 12 Nov 03:00Z still shows it)', () => {
    const now = new Date('2026-11-12T03:00:00Z');
    expect(selectFrontPage(input(BF, {}, now), now).lead.headline).toBe('Veterans Day');
    const next = new Date('2026-11-12T07:01:00Z'); // 00:01 on 12 Nov, Denver
    expect(all(selectFrontPage(input(BF, {}, next), next)).some((x) => x.headline === 'Veterans Day')).toBe(false);
  });
});

describe('Christmas (Glasgow): visible 18-25 Dec, gone 26 Dec', () => {
  it('Glasgow', () => {
    const t = TOWNS[3];
    const has = (d: string) => { const at = new Date(`2026-12-${d}T12:00:00Z`); return all(selectFrontPage(input(t, {}, at), at)).some((x) => x.headline === 'Christmas'); };
    expect(has('17')).toBe(false);
    for (const d of ['18', '24', '25']) expect(has(d)).toBe(true);
    expect(has('26')).toBe(false);
  });
});

describe('Thanksgiving (Thu 26 Nov 2026): visible from 19 Nov, gone 27 Nov', () => {
  for (const t of TOWNS.filter((x) => x.id !== 'glasgow')) {
    it(`${t.city}`, () => {
      const lead = (d: string) => { const at = new Date(`2026-11-${d}T${d === '27' ? '08' : '18'}:00:00Z`); return selectFrontPage(input(t, {}, at), at); };
      const has = (d: string) => all(lead(d)).some((x) => x.headline === 'Thanksgiving');
      expect(has('18')).toBe(false);
      for (const d of ['19', '22', '25', '26']) expect(has(d)).toBe(true);
      expect(has('27')).toBe(false);
    });
  }
  it('is the lead when nothing outranks it', () => {
    const now = new Date('2026-11-24T18:00:00Z'); // Tuesday
    const fp = selectFrontPage(input(BF, {}, now), now);
    expect(fp.lead.type).toBe('holiday');
    expect(fp.lead.url).toBe('/thanksgiving/');
    expect(fp.lead.deck[0]).toBe('Thanksgiving is Thursday, November 26.');
  });
});

describe('priority and fallbacks', () => {
  const alert: FrontPageAlert = { headline: 'Winter Storm Warning', url: '/weather/', kind: 'weather', event: 'Winter Storm Warning', until: '2026-11-07T20:00:00Z' };
  const fri = new Date('2026-11-06T19:00:00Z'); // Fri 12:00 Denver
  const sat8pm = [entry('a', 'Jazz Night', '2026-11-07T02:00:00Z'), entry('b', 'Comedy Hour', '2026-11-08T02:00:00Z', 'Mamas Hall')];

  it('weekend leads on Friday at 12:00, not at 11:59', () => {
    expect(inWeekendWindow(fri, BF.tz)).toBe(true);
    expect(inWeekendWindow(new Date(fri.getTime() - 60_000), BF.tz)).toBe(false);
    const fp = selectFrontPage(input(BF, { evening: sat8pm, holidays: [] }, fri), fri);
    expect(fp.lead.type).toBe('weekend');
    expect(fp.lead.deck[0]).toBe('2 events in Broomfield this weekend, including Jazz Night at The Venue and Comedy Hour at Mamas Hall.');
  });
  it('weekend window runs through Sunday 23:59 city time and ends Monday', () => {
    const sun = new Date('2026-11-09T06:59:00Z'); // Sun 23:59 Denver
    expect(inWeekendWindow(sun, BF.tz)).toBe(true);
    expect(inWeekendWindow(new Date('2026-11-09T07:00:00Z'), BF.tz)).toBe(false);
  });
  it('an alert outranks everything; a non-severe or expired one does not', () => {
    expect(selectFrontPage(input(BF, { evening: sat8pm, alerts: [alert], holidays: [] }, fri), fri).lead.type).toBe('alert');
    expect(selectFrontPage(input(BF, { evening: sat8pm, alerts: [{ ...alert, event: 'Freeze Warning' }], holidays: [] }, fri), fri).lead.type).toBe('weekend');
    expect(selectFrontPage(input(BF, { evening: sat8pm, alerts: [{ ...alert, until: '2026-11-06T18:00:00Z' }], holidays: [] }, fri), fri).lead.type).toBe('weekend');
  });
  it('Fri 6 Nov: weekend leads, Veterans Day (5 days off) is secondary', () => {
    const fp = selectFrontPage(input(BF, { evening: sat8pm }, fri), fri);
    expect(fp.lead.type).toBe('weekend');
    expect(fp.secondaries.map((s) => s.type)).toContain('holiday');
  });
  it('Mon 9 Nov: Veterans Day (2 days off) leads', () => {
    const mon = new Date('2026-11-09T18:00:00Z');
    expect(selectFrontPage(input(BF, { evening: sat8pm }, mon), mon).lead.headline).toBe('Veterans Day');
  });
  it('the lead threshold is configurable per town', () => {
    const cfg = { ...BF_CFG, holiday: { ...BF_CFG.holiday, leadWithinDays: 5 } };
    expect(selectFrontPage(input(BF, { evening: sat8pm, config: cfg }, fri), fri).lead.headline).toBe('Veterans Day');
  });
  it('a holiday inside the coming weekend leads even beyond the threshold; one after it does not', () => {
    const cfg = { ...BF_CFG, holiday: { ...BF_CFG.holiday, leadWithinDays: 0 } };
    const h = (label: string, ymd: string) => [{ slug: label, label, day: dayOf(ymd), url: '/holidays/' }];
    expect(selectFrontPage(input(BF, { evening: sat8pm, holidays: h('Sunday Fair', '2026-11-08'), config: cfg }, fri), fri).lead.headline).toBe('Sunday Fair');
    expect(selectFrontPage(input(BF, { evening: sat8pm, holidays: h('Monday Fair', '2026-11-09'), config: cfg }, fri), fri).lead.type).toBe('weekend');
  });
  it('alert allowlist: Tornado Warning leads; Freeze Warning, Wind Advisory and expired ones never do; traffic needs a full closure or a fatal', () => {
    const lead = (a: Partial<FrontPageAlert>) => selectFrontPage(input(BF, { evening: sat8pm, holidays: [], alerts: [{ ...alert, ...a }] }, fri), fri).lead.type;
    expect(lead({ event: 'Tornado Warning' })).toBe('alert');
    for (const event of ['Freeze Warning', 'Frost Advisory', 'Wind Advisory', 'Tornado Watch']) expect(lead({ event })).toBe('weekend');
    const road: Partial<FrontPageAlert> = { kind: 'traffic', event: undefined };
    // traffic never leads in any town's real config (no structured source field), even when the caller says full closure / fatal
    for (const t of TOWNS) {
      expect(FRONT_PAGE_BY_TOWN[t.id].alerts.traffic, t.id).toBe(false);
      expect(lead({ ...road, fullClosure: true })).toBe('weekend');
    }
    // the mechanism stays, switched on by config only
    const on = { ...BF_CFG, alerts: { ...BF_CFG.alerts, traffic: true } };
    const leadOn = (a: Partial<FrontPageAlert>) => selectFrontPage(input(BF, { evening: sat8pm, holidays: [], config: on, alerts: [{ ...alert, ...a }] }, fri), fri).lead.type;
    expect(leadOn({ ...road, fullClosure: true })).toBe('alert');
    expect(leadOn({ ...road, fatal: true })).toBe('alert');
    expect(leadOn({ ...road })).toBe('weekend');
  });
  it('an alert without kind, event/level (weather) or fullClosure/fatal (traffic) never leads and is logged', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const lead = (a: object) => selectFrontPage(input(BF, { evening: sat8pm, holidays: [], alerts: [a as FrontPageAlert] }, fri), fri).lead.type;
    const base = { headline: 'X', url: '/weather/', until: null };
    expect(lead({ ...base })).toBe('weekend');                                  // no kind
    expect(lead({ ...base, kind: 'weather' })).toBe('weekend');                 // no event/level
    expect(lead({ ...base, kind: 'weather', event: '  ' })).toBe('weekend');
    expect(lead({ ...base, kind: 'traffic' })).toBe('weekend');                 // no fullClosure/fatal
    expect(warn).toHaveBeenCalledTimes(4);
    expect(String(warn.mock.calls[0][0])).toContain('missing kind');
    expect(lead({ ...base, kind: 'traffic', fatal: false, fullClosure: false })).toBe('weekend'); // well-formed, not severe: not logged
    expect(warn).toHaveBeenCalledTimes(4);
    warn.mockRestore();
  });
  it('Glasgow: Met Office amber/red leads, yellow and NWS-style names do not', () => {
    const g = TOWNS.find((t) => t.id === 'glasgow')!;
    const now = new Date('2026-11-10T12:00:00Z');
    const lead = (a: Partial<FrontPageAlert>) => selectFrontPage(input(g, { holidays: [], alerts: [{ headline: 'Wind', url: '/weather/', kind: 'weather', until: null, ...a }] }, now), now).lead.type;
    expect(lead({ level: 'amber' })).toBe('alert');
    expect(lead({ level: 'red' })).toBe('alert');
    expect(lead({ level: 'yellow' })).not.toBe('alert');
    expect(lead({ event: 'Tornado Warning' })).not.toBe('alert');
  });
  it('a guide lead with nothing else to show has exactly 1 secondary (a second guide), complete and distinct from the lead, in every town', () => {
    for (const t of TOWNS) {
      for (let d = 0; d < 366; d++) {
        const now = new Date(Date.UTC(2026, 0, 1 + d, 18));
        const fp = selectFrontPage(input(t, { holidays: [] }, now), now);
        if (fp.lead.type !== 'guide') continue;
        expect(fp.secondaries, `${t.id} day ${d}`).toHaveLength(1);
        const [s] = fp.secondaries;
        expect(s.type).toBe('guide');
        expect(s.url).not.toBe(fp.lead.url);
        for (const text of [s.headline, s.url, ...s.deck]) expect(text.trim().length).toBeGreaterThan(0);
        expect(s.deck.length).toBeGreaterThan(0);
      }
    }
  }, 30_000); // 4 towns x 366 days; the 5 s default is too tight under a loaded full run
  it('at most 2 guides on the page, lead included', () => {
    for (let d = 0; d < 365; d++) {
      const now = new Date(Date.UTC(2026, 0, 1 + d, 18));
      for (const t of TOWNS) {
        const fp = selectFrontPage(input(t, { holidays: [] }, now), now);
        expect([fp.lead, ...fp.secondaries].filter((x) => x.type === 'guide').length).toBeLessThanOrEqual(2);
      }
    }
  }, 30_000);
  it('a game today (city time) is a candidate and ranks above a meeting', () => {
    const t = TOWNS[1];
    const tue = new Date('2026-11-10T15:00:00Z');
    const game: FrontPageGame = { team: 'Jackrabbits', opponent: 'North Dakota', startsAt: '2026-11-11T01:00:00Z', home: true, url: '/jackrabbits/' };
    const fp = selectFrontPage(input(t, { games: [game], meetings: [meeting({})], holidays: [] }, tue), tue);
    expect(fp.lead.type).toBe('game_day');
    expect(fp.lead.deck[0]).toBe('Jackrabbits play North Dakota at home at 7:00 PM.');
    expect(fp.secondaries[0].type).toBe('meeting');
  });
  it('a game on another city-time day is not a candidate', () => {
    const t = TOWNS[1];
    const tue = new Date('2026-11-10T15:00:00Z');
    const game: FrontPageGame = { team: 'Jackrabbits', opponent: 'North Dakota', startsAt: '2026-11-12T01:00:00Z', home: true, url: '/jackrabbits/' };
    expect(all(selectFrontPage(input(t, { games: [game], holidays: [] }, tue), tue)).some((x) => x.type === 'game_day')).toBe(false);
  });
  it('a Tuesday meeting names the first two agenda items', () => {
    const tue = new Date('2026-11-10T15:00:00Z');
    const fp = selectFrontPage(input(BF, { meetings: [meeting({})], holidays: [] }, tue), tue);
    expect(fp.lead.type).toBe('meeting');
    expect(fp.lead.deck[0]).toBe('City Council meets Tuesday at 6:00 PM with 2 items on the agenda, including Water rate study and Budget amendment.');
  });
  it('a meeting with no parsed agenda items, a cancelled one, and one three days out are not candidates', () => {
    const mon = new Date('2026-11-09T15:00:00Z');
    const ms = [meeting({ items: [] }), meeting({ id: 2, cancelled: true }), meeting({ id: 3, ymd: '2026-11-12' })];
    expect(all(selectFrontPage(input(BF, { meetings: ms, holidays: [] }, mon), mon)).some((x) => x.type === 'meeting')).toBe(false);
  });
  it('tonight on weekdays, never on the weekend window', () => {
    const wed = new Date('2026-11-11T21:00:00Z'); // Wed 14:00 Denver (Veterans Day itself is removed to test tonight)
    const one = [entry('c', 'Trivia', '2026-11-12T01:30:00Z', 'Pub 1')]; // Wed 18:30 Denver
    const fp = selectFrontPage(input(BF, { evening: one, holidays: [] }, wed), wed);
    expect(fp.lead.type).toBe('tonight');
    expect(fp.lead.deck[0]).toBe('1 event in Broomfield tonight, including Trivia at Pub 1.');
    const sat = new Date('2026-11-07T21:00:00Z');
    expect(all(selectFrontPage(input(BF, { evening: [entry('d', 'X', '2026-11-08T02:00:00Z')], holidays: [] }, sat), sat)).some((x) => x.type === 'tonight')).toBe(false);
  });
  it('falls back to a guide, rotating by day of year, and is never empty', () => {
    const a = new Date('2026-03-10T18:00:00Z');
    const b = new Date('2026-03-11T18:00:00Z');
    const fa = selectFrontPage(input(BF, { holidays: [] }, a), a);
    const fb = selectFrontPage(input(BF, { holidays: [] }, b), b);
    expect(fa.lead.type).toBe('guide');
    expect(fa.lead.url).not.toBe(fb.lead.url);
    expect(fa.secondaries.length).toBeGreaterThanOrEqual(1); // guide cap (2 incl. lead) wins over the 2-secondary floor
  });
  it('secondaries: 2-3, one per non-guide type, never the lead, in priority order', () => {
    const now = new Date('2026-11-10T16:00:00Z'); // Tue, Veterans Day tomorrow
    const fp = selectFrontPage(input(BF, {
      alerts: [{ headline: 'Tornado Warning', url: '/weather/', kind: 'weather', event: 'Tornado Warning', until: null }],
      meetings: [meeting({})], evening: [entry('e', 'Open Mic', '2026-11-11T01:30:00Z')],
    }, now), now);
    expect(fp.lead.type).toBe('alert');
    expect(fp.secondaries.map((s) => s.type)).toEqual(['holiday', 'meeting', 'tonight']);
    expect(fp.secondaries.every((s) => s.url !== fp.lead.url)).toBe(true);
    const order = fp.secondaries.map((s) => FRONT_PAGE_PRIORITY.indexOf(s.type));
    expect([...order].sort((x, y) => x - y)).toEqual(order);
  });
});

describe('every town, every day of a year: valid, no empty state, no template debris', () => {
  for (const t of TOWNS) {
    it(t.city, () => {
      for (let d = 0; d < 366; d += 1) {
        const now = new Date(Date.UTC(2026, 0, 1, 12) + d * 86_400_000);
        const fp = selectFrontPage(input(t, {}, now), now);
        for (const it of all(fp)) {
          expect(it.deck.length, `${t.id} ${now.toISOString()} ${it.type}`).toBeGreaterThan(0);
          for (const s of [it.headline, it.url, ...it.deck]) expect(s, `${t.id} ${it.type}`).not.toMatch(BAD);
        }
        expect(fp.secondaries.length).toBeGreaterThanOrEqual(fp.lead.type === "guide" ? 1 : 2); // a guide lead leaves room for one more guide only
        expect(fp.secondaries.length).toBeLessThanOrEqual(3);
        expect(fp.meta_description.length).toBeLessThanOrEqual(160);
        expect(fp.meta_description).not.toBe('');
      }
    }, 30_000);
  }
});

describe('helpers', () => {
  it('dayOfYear is counted in city time', () => {
    expect(dayOfYear(new Date('2026-01-01T07:00:00Z'), 'America/Denver')).toBe(1);
    expect(dayOfYear(new Date('2026-01-01T06:59:00Z'), 'America/Denver')).toBe(365); // still 31 Dec 2025 there
  });
  it('meta description is the first deck text, at most 160 characters, cut after a whole sentence (2026-11-11)', () => {
    // Glasgow's front page read "... with 5 items on the agenda, including Automatic" (a word cut with no end)
    const deck = 'Wellbeing, Equalities, Communities, Culture and Engagement City Policy Committee meets Thursday at 13:30. It has 5 items on the agenda, including Automatic Enrolment.';
    const m = metaDescriptionOf({ type: 'guide', headline: 'H', deck: [deck], url: '/x/' });
    expect(m).toBe('Wellbeing, Equalities, Communities, Culture and Engagement City Policy Committee meets Thursday at 13:30.');
    const noSentence = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    expect(metaDescriptionOf({ type: 'guide', headline: 'H', deck: [noSentence], url: '/x/' }).endsWith('…')).toBe(true);
    expect(metaDescriptionOf({ type: 'guide', headline: 'H', deck: ['Short.'], url: '/x/' })).toBe('Short.');
  });
});

describe('config', () => {
  it('election.homepage is false for every town with an election config', () => {
    for (const [id, cfg] of Object.entries(ELECTION_BY_TOWN)) expect(cfg.homepage, id).toBe(false);
  });
  it('every guide url is a page the site builds', () => {
    const exists = (u: string) => {
      const p = u.replace(/^\/|\/$/g, '');
      // /traffic/ is a dynamic route ([traffic].astro, built only for a town with a traffic source)
      return ['.astro', '/index.astro'].some((ext) => existsSync(new URL(`../pages/${p}${ext}`, import.meta.url))) || existsSync(new URL(`../pages/[${p}].astro`, import.meta.url));
    };
    for (const [id, cfg] of Object.entries(FRONT_PAGE_BY_TOWN)) {
      expect(cfg.guides.length, id).toBeGreaterThan(0);
      for (const g of cfg.guides) expect(exists(g.url), `${id} ${g.url}`).toBe(true);
      // a guide to /traffic/ only for a town that has a traffic source
      if (cfg.guides.some((g) => g.url === '/traffic/')) expect(CITIES_WITH_TRAFFIC.has(id), `${id} lists /traffic/`).toBe(true);
    }
  });
  it('the holiday window is 7 / on the day / 0 for every town', () => {
    for (const cfg of Object.values(FRONT_PAGE_BY_TOWN)) expect(cfg.holiday).toEqual({ daysBefore: 7, showOnDay: true, daysAfter: 0, leadWithinDays: 3 });
  });
});

describe('"in {Town}" is said only of in-town events (owner 2026-11-07), all four towns', () => {
  // Friday 12:30-15:00 local, so the weekend window is open; Saturday 20:00Z is a Saturday afternoon/evening in all four zones.
  const FRI: Record<string, string> = { broomfield_co: '2026-11-06T19:30:00Z', brookings_sd: '2026-11-06T18:30:00Z', moreno_valley_ca: '2026-11-06T20:30:00Z', glasgow: '2026-11-06T13:00:00Z' };
  const regional = (id: string) => ({ ...entry(id, `Arena Show ${id}`, '2026-11-07T20:00:00Z', 'Big Arena'), source: 'ticketmaster' as const, distanceMiles: 13 });
  for (const t of TOWNS) {
    const now = new Date(FRI[t.id]);
    const run = (evening: EveningEntry[]) => selectFrontPage(input(t, { evening, holidays: [] }, now), now).lead;
    const km = t.locale === 'en-GB';
    it(`${t.city}: only regional shows -> "This weekend near ${t.city}" with each distance`, () => {
      const lead = run([regional('r1'), regional('r2')]);
      expect(lead.type).toBe('weekend');
      expect(lead.headline).toBe(`This weekend near ${t.city}`);
      expect(lead.deck[0]).toContain(`2 events near ${t.city} this weekend`);
      expect(lead.deck[0]).toContain(km ? '(~21 km away)' : '(~13 miles away)');
      expect(lead.deck[0]).not.toContain(` in ${t.city}`);
    });
    it(`${t.city}: an in-town event -> "This weekend in ${t.city}", counting it alone`, () => {
      const lead = run([regional('r1'), regional('r2'), entry('loc', 'Local Jazz', '2026-11-07T20:30:00Z', 'The Venue')]);
      expect(lead.headline).toBe(`This weekend in ${t.city}`);
      expect(lead.deck[0]).toBe(`1 event in ${t.city} this weekend, including Local Jazz at The Venue.`);
    });
  }
  it('tonight: regional only -> "Tonight near", in-town present -> "Tonight in"', () => {
    const wed = new Date('2026-11-11T21:00:00Z');
    const far = { ...entry('t1', 'Arena Tour', '2026-11-12T02:00:00Z', 'Big Arena'), source: 'ticketmaster' as const, distanceMiles: 13 };
    expect(selectFrontPage(input(BF, { evening: [far], holidays: [] }, wed), wed).lead.headline).toBe('Tonight near Broomfield');
    const both = selectFrontPage(input(BF, { evening: [far, entry('t2', 'Trivia', '2026-11-12T01:30:00Z', 'Pub 1')], holidays: [] }, wed), wed).lead;
    expect(both.headline).toBe('Tonight in Broomfield');
    expect(both.deck[0]).toBe('1 event in Broomfield tonight, including Trivia at Pub 1.');
  });
});
