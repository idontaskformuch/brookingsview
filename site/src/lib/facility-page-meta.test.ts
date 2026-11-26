/** /facilities/<slug>/ title and meta from structured data (owner order 2026-11-26 (14)). Fixture: real rows read from the database on
 *  2026-11-26 by scripts/facility-meta-table.ts (the same functions and data as the page), one per fallback rule; a case that changes a
 *  field says which. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  facilityPageMeta, firstSentence, groupHours, HANDWRITTEN_META, onPageLine, onPageLines, regularWeekFromCalendar, sourceClosedDays,
  type FacilityMetaInput,
} from './facility-page-meta';
import { META_MAX } from './answer-facility';

type Case = { town: string; slug: string; input: FacilityMetaInput['facility'] & Omit<FacilityMetaInput, 'facility'>; today: string; title: string; meta: string; fallbacks: string[] };
const CASES = JSON.parse(readFileSync(new URL('./fixtures/facility-meta-2026-11-26.json', import.meta.url), 'utf8')) as Case[];
const TOWN: Record<string, { name: string; country: 'us' | 'gb' }> = {
  broomfield_co: { name: 'Broomfield', country: 'us' }, glasgow: { name: 'Glasgow', country: 'gb' },
  moreno_valley_ca: { name: 'Moreno Valley', country: 'us' }, brookings_sd: { name: 'Brookings', country: 'us' },
};
const input = (c: Case): FacilityMetaInput => {
  const { hoursRows, hoursStale, hoursSource, exceptions, upcomingEvents, datedRows, ...facility } = c.input;
  return { facility, hoursRows, hoursStale, hoursSource, exceptions, upcomingEvents, datedRows };
};
const run = (c: Case, today = c.today) => facilityPageMeta(input(c), { town: TOWN[c.town].name, today, country: TOWN[c.town].country, townId: c.town, slug: c.slug });
const byslug = (s: string) => CASES.find((c) => c.slug === s)!;

describe('every fixture page: the title and meta the page gets', () => {
  for (const c of CASES) {
    it(`${c.town} /facilities/${c.slug}/`, () => {
      const m = run(c);
      expect([m.title, m.description, m.fallbacks]).toEqual([c.title, c.meta, c.fallbacks]);
      expect(m.description.length).toBeLessThanOrEqual(META_MAX);
      expect(m.description).not.toMatch(/unavailable|tbd|n\/a|undefined|null/i);
    });
  }
});

describe('the rules behind them', () => {
  it('a time past midnight names both halves of the day: The Old Man Bar is "daily 11 AM–2 AM", not "11–2 AM"', () => {
    expect(run(byslug('the-old-man-bar')).description).toContain('Open daily 11 AM–2 AM.');
  });
  it('Glasgow writes the site\'s own clock: "6am–10pm"', () => {
    expect(run(byslug('glasgow-international-arena')).description).toContain('Open Mon–Fri 6am–10pm');
  });
  it('the street from the page\'s address line when there is no street_address (The Bay), never a bare town', () => {
    const bay = byslug('the-bay-aquatic-park');
    expect(run(bay).description.startsWith('The Bay Aquatic Park, 250 Spader Way, Broomfield, CO 80020.')).toBe(true);
    // Changed field: the address is only the town ("Broomfield, CO"): no street, and the title has no "Address".
    const bare = { ...bay, input: { ...bay.input, address: 'Broomfield, CO' } };
    expect(run(bare).description.startsWith('The Bay Aquatic Park.')).toBe(true);
    expect(run(bare).title).not.toContain('Address');
  });
  it('city park hours count as the page shows them ("City park hours"); own hours past the threshold do not', () => {
    const park = byslug('adrienne-mitchell-memorial-park');
    expect(run(park).description).toContain('Open daily 7 AM–10 PM.');
    // Changed field: the same hours as the park's own rows, which are past the staleness threshold.
    const own = { ...park, input: { ...park.input, hoursSource: 'own' as const } };
    expect(run(own).description).not.toContain('Open');
    expect(run(own).fallbacks).toContain('own hours past the staleness threshold: no "Open" part');
  });
  it('hours only as the source\'s text: no "Open" part, the title may still say "Hours" (Hillcrest)', () => {
    const m = run(byslug('hillcrest-aquatic-center'));
    expect(m.title).toBe('Brookings Hillcrest Aquatic Center: Hours & Address (2026)');
    expect(m.description).not.toContain('Open');
  });
  it('the page\'s own first sentence is the last sentence when it fits, else the list of what is on the page (Station 65)', () => {
    expect(run(byslug('childrens-museum-of-south-dakota')).description).toContain('A hands-on children\'s museum');
    expect(run(byslug('north-metro-fire-station-65')).description).toBe('North Metro Fire Rescue Station 65, 9900 W 120th Ave. Includes phone number.');
  });
  it('the list is a sentence ("Includes ..."), shortened from its end when the whole list does not fit (Paul Derda), never a fragment', () => {
    expect(run(byslug('paul-derda-recreation-center')).description).toMatch(/ Includes phone number\.$/);
    for (const c of CASES) expect(run(c).description).not.toMatch(/(^|\. )(Phone number|Services|Upcoming events)\b/);
  });
  it('over 60: (a) the parenthesis, (b) the year, (c) "& Address", in that order (City Hall, Station 68, Paul Derda)', () => {
    expect(run(byslug('city-hall')).title).toBe('Brookings City Hall: Hours & Address (2026)'); // (a)
    expect(run(byslug('north-metro-fire-station-68')).title).toBe('Broomfield North Metro Fire Rescue Station 68: Address'); // (a)+(b)
    expect(run(byslug('paul-derda-recreation-center')).title).toBe('Broomfield Paul Derda Recreation Center: Hours & Address'); // (b)
    // None fits: the town prefix goes as a last resort and the shortest is kept (65 characters).
    expect(run(byslug('county-of-riverside-department-of-public-social-services')).title).toBe('County of Riverside Department of Public Social Services: Address');
  });
  it('no "The" after the town ("Glasgow Mitchell Library"); a name with the town is not prefixed again (Downtown Brookings)', () => {
    expect(run(byslug('the-mitchell-library')).title).toBe('Glasgow Mitchell Library: Hours & Address (2026)');
    expect(run(byslug('the-old-man-bar')).title).toBe('Broomfield Old Man Bar: Hours & Address (2026)');
    expect(run(byslug('downtown-main-avenue')).title).toBe('Downtown Brookings — Main Avenue: Address (2026)');
  });
  it('"Open" only when the week states all seven days (A): the police department has Mon–Fri rows and no row for Sat/Sun', () => {
    const police = run(byslug('broomfield-police-department'));
    expect(police.description).not.toContain('Open');
    expect(police.title).toContain('Hours'); // the page still shows its hours table
  });
  it('a day calendar is never one week\'s calendar (16) 1: Briggs (LibCal, 22 days to 16 Dec, finals-week hours) has no "Open", its Thanksgiving closure is "Next closed"', () => {
    const briggs = run(byslug('briggs-library'));
    expect(briggs.description).not.toContain('Open');
    expect(briggs.description).toContain('Next closed: Thu Nov 26.');
    expect(briggs.title).toBe('Brookings Hilton M. Briggs Library: Hours & Address (2026)');
    // Before the fix: this week's calendar (Thu–Sat closed for Thanksgiving) read as the week, "Open Mon–Wed …, Sun …".
    expect(briggs.description).not.toContain('Mon–Wed');
  });
  it('regular week from a day calendar: holiday closures stay in the week and go to "Next closed"; any other difference gives none', () => {
    // Changed field: Briggs' own rows of 30 Nov–6 Dec (a week with no exception) repeated for four weeks from 26 Nov, with its real
    // Thanksgiving closure 26–28 Nov kept.
    const real = byslug('briggs-library').input.datedRows!;
    const week = real.filter((r) => r.valid_from >= '2026-11-30' && r.valid_from <= '2026-12-06');
    const shift = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
    const rows = [-7, 0, 7, 14, 21].flatMap((n) => week.map((r) => ({ ...r, valid_from: shift(r.valid_from, n), valid_to: shift(r.valid_to!, n) })))
      .filter((r) => r.valid_from >= '2026-11-26')
      .map((r) => (['2026-11-26', '2026-11-27', '2026-11-28'].includes(r.valid_from) ? { ...r, opens: null, closes: null } : r));
    const got = regularWeekFromCalendar(rows, '2026-11-26');
    expect(got.closedDates).toEqual(['2026-11-26', '2026-11-27', '2026-11-28']);
    expect(groupHours(got.week!)).toEqual(groupHours(week));
    // The real calendar: it ends 16 Dec and Thu 10 Dec closes at 2 a.m., so no regular week.
    expect(regularWeekFromCalendar(real, '2026-11-26').week).toBeNull();
  });
  it('a day the source\'s own week gives as closed (hours_structured sunday null), which the page shows "Closed", counts (16) 4: USPS', () => {
    const usps = run(byslug('usps-broomfield'));
    expect(usps.description).toContain('Open Mon–Fri 8 AM–6 PM; Sat 9 AM–1 PM.');
    expect(sourceClosedDays(byslug('usps-broomfield').input.hours_structured)).toEqual([0]);
    // Changed field: without the source's null Sunday the week does not state Sunday, so no "Open".
    const c = byslug('usps-broomfield');
    expect(run({ ...c, input: { ...c.input, hours_structured: null } }).description).not.toContain('Open');
  });
  it('"Free" only for a type where entry is a question (16) 2: the library yes, police and post office no', () => {
    expect(run(byslug('the-mitchell-library')).description).toContain(' Free. ');
    expect(byslug('broomfield-police-department').input.is_free).toBe(true);
    expect(run(byslug('broomfield-police-department')).description).not.toContain('Free');
    expect(run(byslug('usps-broomfield')).description).not.toContain('Free');
  });
  it('day groups with semicolons, days in a row merged (16) 3; noon and midnight (D): Chipper\'s Lanes, GoMA', () => {
    expect(run(byslug('chippers-lanes-broomfield')).description).toContain('Open Mon–Thu, Sun 10 AM–11 PM; Fri–Sat 10 AM–midnight.');
    expect(run(byslug('gallery-of-modern-art-goma')).description).toContain('Open Mon–Thu, Sat 10am–5pm; Fri, Sun 11am–5pm.');
  });
  it('a street with its own full stop gets no second one (Landfill: "47532 30th St.")', () => {
    expect(run(byslug('landfill-office-collection-shop')).description).not.toContain('..');
  });
  it('Downtown Main Avenue has the handwritten meta (owner order 26 nov (15) 3)', () => {
    expect(run(byslug('downtown-main-avenue')).description).toBe(HANDWRITTEN_META.brookings_sd['downtown-main-avenue']);
    expect(HANDWRITTEN_META.brookings_sd['downtown-main-avenue'].length).toBeLessThanOrEqual(META_MAX);
  });
  it('a closed day within 30 days becomes "Next closed" (changed field: one closed exception, 2026-12-24, on the arena)', () => {
    const arena = byslug('glasgow-international-arena');
    const closed = { ...arena, input: { ...arena.input, exceptions: [{ date: '2026-12-24', opens: null, closes: null }] } };
    expect(run(closed, '2026-12-01').description).toContain('Next closed: Thu 24 Dec.');
    expect(run(closed, '2026-11-20').description).not.toContain('Next closed'); // 34 days away
  });
  it('the year is the town\'s today', () => {
    expect(run(byslug('the-old-man-bar'), '2027-01-01').title).toContain('(2027)');
  });
});

describe('helpers', () => {
  it('weekly rows grouped by identical times, Monday first', () => {
    const rows = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, opens: '07:00', closes: '22:00' }));
    expect(groupHours(rows)).toEqual([{ days: [1, 2, 3, 4, 5, 6, 0], from: '07:00', to: '22:00' }]);
    expect(groupHours([{ day_of_week: 2, opens: null, closes: null }])).toEqual([]);
  });
  it('first sentence; the on-page list', () => {
    expect(firstSentence('A 4.43-acre park in Moreno Valley. It has a playground.')).toBe('A 4.43-acre park in Moreno Valley.');
    expect(firstSentence('')).toBeNull();
    const i = { facility: { name: 'x', phone: '1', services: ['a'] }, hoursRows: [], hoursStale: false, exceptions: [], upcomingEvents: 2 };
    expect(onPageLine(i)).toBe('Includes phone number, services and upcoming events.');
    expect(onPageLines(i)).toEqual(['Includes phone number, services and upcoming events.', 'Includes phone number and services.', 'Includes phone number.']);
  });
});
