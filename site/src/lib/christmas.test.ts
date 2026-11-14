import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildHolidayMeta, buildHolidayEventsJsonLd, formatIsoDate, formatClock, formatEventDay, eventWhenWhere, localIso,
  sectionHeading, sectionMetaWord, isBlockedHost, DESCRIPTION_MAX, type HolidayEvent,
} from './holiday-page';
import { buildChristmasPage, CHRISTMAS_EVENTS, CHRISTMAS_TOWN_IDS } from '../config/holiday-pages/christmas';
import { buildThanksgivingPage } from '../config/holiday-pages/thanksgiving';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const TZ = 'Europe/London';
const page = buildChristmasPage('glasgow')!;
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('en-GB locale', () => {
  it('formats dates day-first and clocks compact; the US formats are unchanged', () => {
    expect(formatIsoDate('2026-12-25', false, 'en-GB')).toBe('25 Dec 2026');
    expect(formatIsoDate('2026-12-25', true, 'en-GB')).toBe('25 December 2026');
    expect(formatEventDay('2026-12-25', 'en-GB')).toBe('Fri 25 Dec');
    expect(formatClock('14:30', 'en-GB')).toBe('2:30pm');
    expect(formatClock('13:00', 'en-GB')).toBe('1pm');
    expect(formatClock('12:00', 'en-GB')).toBe('12 noon');
    expect(formatClock('00:00', 'en-GB')).toBe('midnight');
    expect(formatIsoDate('2026-12-25')).toBe('Dec 25, 2026');
    expect(formatEventDay('2026-12-25')).toBe('Fri, Dec 25');
    expect(formatClock('14:30')).toBe('2:30 p.m.');
  });

  it('shows the trash section as "Bin collections" and keeps the US words for US pages', () => {
    expect(sectionHeading('trash', 'en-GB')).toBe('Bin collections');
    expect(sectionMetaWord('trash', 'en-GB')).toBe('bin collections');
    expect(sectionHeading('trash', 'en-US')).toBe('Trash and recycling');
    expect(sectionHeading('closures', 'en-GB')).toBe('Closures and changed hours');
  });

  it('every US page is en-US and Glasgow is en-GB, from the data and not hard-coded in the template', () => {
    for (const id of ['brookings_sd', 'moreno_valley_ca', 'broomfield_co']) {
      expect(buildThanksgivingPage(id, { south: [], north: [] })!.locale).toBe('en-US');
    }
    expect(page.locale).toBe('en-GB');
    for (const f of ['../components/HolidayPage.astro', '../components/HolidayRow.astro', '../lib/holiday-view.ts']) {
      const src = read(f);
      for (const call of src.match(/(formatIsoDate|eventWhenWhere|sectionHeading)\([^)]*\)/g) ?? []) {
        expect(call, `${f}: ${call}`).toMatch(/locale/);
      }
    }
  });

  it('only US phone numbers get the extension comma in tel: links (a GB 11-digit number must stay intact)', () => {
    const src = read('../components/HolidayRow.astro');
    expect(src).toMatch(/loc === 'en-US' \? d\.replace\(/);
    expect(src).toContain('telDigits(r.check.phone, locale)');
  });

  it('formats a multi-day run and an event without a street', () => {
    const st = page.events[0];
    expect(eventWhenWhere(st, 'en-GB')).toBe('Fri 6 Nov – Sun 27 Dec · St Enoch Square');
    const toy = page.events.find((e) => e.name.includes('Toyland'))!;
    expect(eventWhenWhere(toy, 'en-GB')).toBe('Thu 24 Dec · 1pm · Glasgow Royal Concert Hall, New Auditorium');
  });

  it('uses the winter offset in December, +00:00', () => {
    expect(localIso('2026-12-24', '13:00', TZ)).toBe('2026-12-24T13:00:00+00:00');
  });
});

describe('Glasgow /christmas/ data as approved 2026-11-04', () => {
  it('exists only for Glasgow', () => {
    expect(CHRISTMAS_TOWN_IDS).toEqual(['glasgow']);
    for (const id of ['brookings_sd', 'moreno_valley_ca', 'broomfield_co']) expect(buildChristmasPage(id)).toBeNull();
    expect(page.year).toBe(2026);
    expect(page.townId).toBe('glasgow');
  });

  it('has an ISO check date and an https source on every row, and no blocked host as source or pointer', () => {
    const rows = [...page.facts, ...page.events];
    for (const r of rows) {
      expect(r.checkedOn).toMatch(ISO);
      expect(r.source.url).toMatch(/^https:\/\//);
      expect(isBlockedHost(r.source.url)).toBe(false);
      if (r.status === 'unconfirmed') {
        expect(Boolean(r.lastYear || r.checkAt)).toBe(true);
        if (r.checkAt?.url) expect(isBlockedHost(r.checkAt.url)).toBe(false);
        if (r.lastYear) expect(r.lastYear.source.url).toMatch(/^https:\/\//);
      } else if ('value' in r) {
        expect(r.value.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('council rows are unconfirmed with a check pointer (glasgow.gov.uk is never fetched); the office rows carry 2025/26 values with the year in every line', () => {
    const council = [...page.facts, ...page.events].filter((r) => new URL(r.source.url).hostname.endsWith('glasgow.gov.uk'));
    expect(council).toHaveLength(9);
    for (const r of council) {
      expect(r.status).toBe('unconfirmed');
      expect(r.status === 'unconfirmed' && r.checkAt?.url).toBeTruthy();
    }
    const offices = page.facts.filter((f) => f.section === 'closures' && f.status === 'unconfirmed' && f.lastYear?.season === '2025/26' && f.source.url.endsWith('/article/11458'));
    expect(offices.map((f) => f.label)).toEqual([
      'Registrars', 'Housing Benefit and Council Tax', 'Scottish Welfare Fund, phone', 'Scottish Welfare Fund, online', 'Social work offices', 'Home care',
    ]);
    for (const f of offices) {
      if (f.status !== 'unconfirmed') continue;
      expect(f.checkAt?.url).toBe('https://www.glasgow.gov.uk/article/11458');
      const v = f.lastYear!.value;
      if (f.label !== 'Scottish Welfare Fund, online') expect(v, f.label).toMatch(/202[56]/);
      // 2025/26 values only: no 2026 festive weekday is ever stated
      expect(v, f.label).not.toMatch(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} Dec 2026/);
      expect(v, f.label).not.toMatch(/2027/);
    }
    const swfOnline = offices.find((f) => f.label === 'Scottish Welfare Fund, online')!;
    expect(swfOnline.status === 'unconfirmed' && swfOnline.lastYear?.source.url).toBe('https://www.glasgow.gov.uk/article/992/Scottish-Welfare-Fund');
  });

  it('recycling centres and bins: plain links, no last-year value and no explanation (owner G4, 2026-11-14)', () => {
    const rc = page.facts.find((f) => f.label === 'Recycling centres')!;
    expect(rc.status).toBe('unconfirmed');
    expect(rc.status === 'unconfirmed' && rc.lastYear).toBeUndefined();
    expect(rc.clarify).toBeUndefined();
    expect(rc.status === 'unconfirmed' && rc.checkAt?.url).toBe('https://www.glasgow.gov.uk/article/1529/Household-Waste-Recycling-Centres');
    const bins = page.facts.find((f) => f.section === 'trash')!;
    expect(bins.status).toBe('unconfirmed');
    expect(bins.status === 'unconfirmed' && bins.lastYear).toBeUndefined();
    expect(bins.status === 'unconfirmed' && bins.checkAt).toMatchObject({
      label: 'Enter your address to see your collection days', url: 'https://www.glasgow.gov.uk/article/1524/Bin-Collection-Days',
    });
    const gs = page.events.find((e) => e.name.startsWith('George Square'))!;
    expect(gs.status).toBe('unconfirmed');
  });

  it('ScotRail timetable, SPT and every bus operator are links only, grouped, and out of the rows (owner 2026-11-14)', () => {
    expect(page.linkOnly.map((l) => l.label)).toEqual(['ScotRail', 'Glasgow Subway (SPT)', 'First Bus Glasgow', "McGill's", 'Stagecoach', 'Citylink', 'SEIN Glasgow']);
    for (const l of page.linkOnly) {
      expect(l.group).toBe(l.label === 'SEIN Glasgow' ? undefined : 'Trains, Subway and buses');
      // ScotRail and SPT allow us (the owner wants links); the rest answer 403 or disallow.
      expect(isBlockedHost(l.url)).toBe(!['ScotRail', 'Glasgow Subway (SPT)'].includes(l.label));
    }
    const urls = [...page.facts, ...page.events].flatMap((r) => [r.source.url, r.status === 'unconfirmed' ? r.checkAt?.url ?? '' : '']);
    expect(urls.some((u) => /mcgills|stagecoach|citylink|seinglasgow|firstbus|spt\.co\.uk/.test(u))).toBe(false);
  });

  it('help: three food banks (owner-approved 2026-11-04) with usual hours on their own row, Christmas hours unconfirmed; no meal row beyond Social Bite', () => {
    const help = page.facts.filter((f) => f.section === 'help');
    expect(help.map((f) => f.label)).toEqual([
      'Samaritans', 'Glasgow South West Foodbank', 'Glasgow North East Foodbank', 'Glasgow North West Foodbank',
      'Glasgow City Mission', 'Social Bite Christmas dinner', 'Shelter Scotland housing advice',
    ]);
    for (const f of help.filter((x) => x.label.endsWith('Foodbank'))) {
      expect(f.status).toBe('unconfirmed');
      if (f.status !== 'unconfirmed') continue;
      expect(f.clarify).toBeUndefined(); // no "not yet published" (owner G4, 2026-11-14)
      expect(f.usual).toMatch(/voucher/);
      expect(f.checkAt?.url).toMatch(/^https:\/\/glasgow(sw|ne|nw)\.foodbank\.org\.uk\/locations\/$/);
      expect(f.checkAt?.phone).toMatch(/^0\d{4} ?\d{6}$/);
      expect(f.source.url).toBe(f.checkAt?.url);
    }
    expect(page.facts.some((f) => f.section === 'hours' && /foodbank/i.test(f.label))).toBe(false);
  });

  it('ScotRail: what its page confirms (read 2026-11-14), per day: earlier last trains 24 and 31 Dec, no trains 25 Dec and 1 Jan', () => {
    const rail = page.facts.filter((f) => f.label === 'ScotRail');
    expect(rail.map((f) => [f.status, f.status === 'confirmed' && f.change, f.status === 'confirmed' && f.on])).toEqual([
      ['confirmed', 'changed', ['2026-12-24', '2026-12-31']],
      ['confirmed', 'closed', ['2026-12-25', '2027-01-01']],
    ]);
    for (const f of rail) expect(f.checkedOn).toBe('2026-11-14');
    expect(page.facts.some((f) => /timetable|Subway|First Bus/.test(f.label))).toBe(false);
  });

  it('Winter Wonderland is closed on 25 Dec at both sites, from the organizer, one row per day value', () => {
    for (const label of ['Winter Wonderland, St Enoch Square', 'Winter Wonderland, Glasgow Green']) {
      const f = page.facts.find((x) => x.label === label && x.status === 'confirmed' && x.on?.includes('2026-12-25'))!;
      expect(f.section).toBe('closures');
      expect(f.status === 'confirmed' && [f.change, f.value]).toEqual(['closed', 'Closed']);
      expect(f.source.url.startsWith('https://www.glasgowswinterwonderland.com/')).toBe(true);
    }
    const green1Jan = page.facts.find((x) => x.label === 'Winter Wonderland, Glasgow Green' && x.status === 'confirmed' && x.on?.includes('2027-01-01'));
    expect(green1Jan?.status === 'confirmed' && green1Jan.value).toBe('2pm–10pm');
  });

  it("Glasgow Life's festive hours are a link only, never a time (still 2025/26 on 2026-11-14, owner)", () => {
    for (const f of page.facts.filter((x) => x.source.url.includes('festive-opening-hours'))) {
      expect(f.status).toBe('unconfirmed');
      expect(f.status === 'unconfirmed' && f.lastYear).toBeUndefined();
      expect(f.clarify).toBeUndefined();
      expect('usual' in f && f.usual).toBeFalsy();
    }
  });

  it('regular hours are under More, not in the closures table', () => {
    const hours = page.facts.filter((f) => f.section === 'hours').map((f) => f.label);
    expect(hours).toHaveLength(2);
    expect(page.facts.filter((f) => f.section === 'closures').some((f) => /regular hours/i.test(f.label))).toBe(false);
  });

  it('all dated rows sit inside the approved window and events are in date order', () => {
    const start = '2026-11-06';
    const end = '2027-01-04';
    const dated = page.events.flatMap((e) => (e.status === 'confirmed' ? [e] : []));
    for (const e of dated) {
      expect(e.date >= start && (e.endDate ?? e.date) <= end).toBe(true);
    }
    expect(dated.map((e) => e.date)).toEqual([...dated.map((e) => e.date)].sort());
  });

  it("Broomfield's tree lighting stays saved and is not on the Glasgow page", () => {
    expect(CHRISTMAS_EVENTS.broomfield_co).toHaveLength(1);
    expect(page.events.some((e) => e.name.includes('Tree Lighting'))).toBe(false);
  });
});

describe('Glasgow meta', () => {
  const meta = buildHolidayMeta(page, 'Christmas', 'Glasgow');
  it('names only sections with a confirmed row, with the en-GB words; the H1 is the owner\'s (G1, 2026-11-14)', () => {
    expect(meta.title).toBe('Christmas and New Year 2026 in Glasgow: closures, transit, events, support');
    expect(meta.h1).toBe('Christmas and New Year in Glasgow');
    expect(meta.title).not.toMatch(/bin|trash/i);
  });
  it('description merges the Winter Wonderland items, keeps the confirmed ScotRail row and names no pending row', () => {
    expect(meta.description).toBe(
      'Winter Wonderland: St Enoch from 6 Nov, Glasgow Green from 20 Nov, closed 25 Dec · No ScotRail trains 25 Dec or 1 Jan. Checked 4 Nov – 14 Nov 2026.',
    );
    expect(meta.description.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(meta.description.match(/Winter Wonderland/g)).toHaveLength(1);
  });
  it('running text uses the lower-case section words; the H2 label is unchanged', () => {
    expect(meta.title).toContain('closures, transit, events, support');
    expect(sectionMetaWord('trash', 'en-GB')).toBe('bin collections');
    expect(sectionHeading('trash', 'en-GB')).toBe('Bin collections');
  });
});

describe('Glasgow Event JSON-LD', () => {
  const ld = buildHolidayEventsJsonLd(page, TZ, 'GB');
  const byName = (n: string) => ld.find((x) => String(x.name).includes(n))!;

  it('one Event per Winter Wonderland site (season dates) plus every timed event; nothing else', () => {
    expect(ld.map((x) => x.name)).toEqual([
      "Glasgow's Winter Wonderland, St Enoch Square",
      "Glasgow's Winter Wonderland, Glasgow Green",
      'Meet the Grinch at Riverside Christmas Market',
      "Disney's The Muppet Christmas Carol in Concert",
      'Christmas Nature Crafts (RSPB)',
      'Big Phat Brunch',
      'Dance into Christmas',
      'RSNO Christmas Concert featuring The Snowman',
      'RSNO: Home Alone 2 in Concert',
      'The McDougalls: Christmas in Toyland',
    ]);
  });
  it('season events carry date-only start and end; timed events carry the London offset', () => {
    expect(byName('St Enoch')).toMatchObject({ startDate: '2026-11-06', endDate: '2026-12-27' });
    expect(byName('Glasgow Green')).toMatchObject({ startDate: '2026-11-20', endDate: '2027-01-03' });
    expect(byName('Home Alone')).toMatchObject({ startDate: '2026-12-23T14:30:00+00:00' });
    expect(byName('Toyland')).toMatchObject({ startDate: '2026-12-24T13:00:00+00:00' });
  });
  it('none for rows without a time (the Riverside market itself, Hansel & Gretel, George Square)', () => {
    const names = ld.map((x) => String(x.name));
    expect(names).not.toContain('Riverside Christmas Market');
    expect(names.join('|')).not.toMatch(/Hansel|George Square/);
  });
  it('uses GB and leaves out address parts the organizer does not give', () => {
    const loc = byName('Toyland').location as { address: Record<string, unknown> };
    expect(loc.address.addressCountry).toBe('GB');
    expect(loc.address).not.toHaveProperty('streetAddress');
    expect(loc.address).not.toHaveProperty('addressRegion');
  });
  it('a run flagged seasonJsonLd without an end date, or an untimed one, gets no markup', () => {
    const base = page.events[0] as Extract<HolidayEvent, { status: 'confirmed' }>;
    const noEnd = { ...base, endDate: undefined } as HolidayEvent;
    const untimed = { ...base, seasonJsonLd: false } as HolidayEvent;
    expect(buildHolidayEventsJsonLd({ ...page, events: [noEnd, untimed] }, TZ, 'GB')).toEqual([]);
  });
});
