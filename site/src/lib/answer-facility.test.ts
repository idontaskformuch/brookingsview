/** Facility pages: title, meta, fact rows and FAQ from one set of fields (owner order 2026-11-26 (11)). The facility is Broomfield's leaf and
 *  branch drop-off as committed in config/city-answers/broomfield_co.ts (facts read from broomfield.org/2995 on 2026-11-19); a failing case
 *  changes ONE field of it and says which. The old page text is quoted ordagrant from the config before it moved to fields. */
import { describe, expect, it } from 'vitest';
import { BROOMFIELD_ANSWERS } from '../config/city-answers/broomfield_co';
import type { AnswerFacility } from '../config/city-answers/types';
import {
  abbreviateStreet, facilityFaq, facilityMeta, facilityRows, facilityTitle, hoursCompact, hoursLong, META_MAX, nextClosed, shortDate, TITLE_MAX,
} from './answer-facility';
import { answerMeta, todayIn } from './city-answers';

const PAGE = BROOMFIELD_ANSWERS.find((p) => p.slug === 'leaf-branch-drop-off')!;
const LEAF = PAGE.facility!;
const CLOSED = LEAF.closed!;

describe('hours', () => {
  it('the leaf page: "Wednesdays 1 to 5 p.m. and Saturdays 8 a.m. to 5 p.m." long, "Wed 1–5 PM & Sat 8 AM–5 PM" compact', () => {
    expect(hoursLong(LEAF.hours!)).toBe('Wednesdays 1 to 5 p.m. and Saturdays 8 a.m. to 5 p.m.');
    expect(hoursCompact(LEAF.hours!)).toBe('Wed 1–5 PM & Sat 8 AM–5 PM');
  });
  it('a run of days, minutes, a time across noon (changed fields: Wednesday -> Monday to Friday, 08:00 -> 08:30, 17:00 -> 12:00)', () => {
    expect(hoursCompact([{ days: [1, 2, 3, 4, 5], from: '13:00', to: '17:00' }])).toBe('Mon–Fri 1–5 PM');
    expect(hoursLong([{ days: [5, 1, 3], from: '13:00', to: '17:00' }])).toBe('Mondays, Wednesdays and Fridays 1 to 5 p.m.');
    expect(hoursCompact([{ days: [6], from: '08:30', to: '17:00' }])).toBe('Sat 8:30 AM–5 PM');
    expect(hoursCompact([{ days: [6], from: '08:00', to: '12:00' }])).toBe('Sat 8 AM–noon'); // "noon", never "12 PM" (order 26 nov (15) D)
  });
});

describe('next closed: the first closed day from today on, within 30 days, never a past one', () => {
  it('a passed day is skipped (28 Nov is over on 29 Nov: 23 Dec is next); the day itself counts', () => {
    expect(nextClosed(CLOSED, '2026-11-19')).toBe('2026-11-28');
    expect(nextClosed(CLOSED, '2026-11-28')).toBe('2026-11-28');
    expect(nextClosed(CLOSED, '2026-11-29')).toBe('2026-12-23');
    expect(nextClosed([...CLOSED].reverse(), '2026-11-29')).toBe('2026-12-23'); // order in the data does not matter
  });
  it('the window is 30 days: 23 Dec is 30 days from 23 Nov (shown) and 31 from 22 Nov (not)', () => {
    const only = CLOSED.filter((c) => c.date === '2026-12-23');
    expect(nextClosed(only, '2026-11-23')).toBe('2026-12-23');
    expect(nextClosed(only, '2026-11-22')).toBeNull();
  });
  it('none left: null (the last closed day, 2 Jan 2027, is over on 3 Jan); no list at all: null', () => {
    expect(nextClosed(CLOSED, '2027-01-02')).toBe('2027-01-02');
    expect(nextClosed(CLOSED, '2027-01-03')).toBeNull();
    expect(nextClosed(undefined, '2026-11-19')).toBeNull();
  });
  it('the date is written "Sat Nov 28" (us) / "Sat 28 Nov" (gb)', () => {
    expect([shortDate('2026-11-28'), shortDate('2026-11-28', 'gb'), shortDate('2027-01-02')]).toEqual(['Sat Nov 28', 'Sat 28 Nov', 'Sat Jan 2']);
  });
});

describe('title', () => {
  it('"<Town> <name>: Hours & Rules (<year>)"; 55 characters for the leaf page', () => {
    const t = facilityTitle(LEAF, 'Broomfield', 2026);
    expect(t).toBe('Broomfield Leaf & Branch Drop-Off: Hours & Rules (2026)');
    expect(t.length).toBeLessThanOrEqual(TITLE_MAX);
  });
  it('"Hours & Address" where the page has no rules part (changed field: rules false)', () => {
    expect(facilityTitle({ ...LEAF, rules: false }, 'Broomfield', 2026)).toBe('Broomfield Leaf & Branch Drop-Off: Hours & Address (2026)');
  });
  it('over 60 characters: the year goes before " & Rules" (order 26 nov (15): parenthesis, year, second fact; changed field: name)', () => {
    const f = { ...LEAF, name: 'Tree Branch Recycling Facility' };
    expect(`Broomfield ${f.name}: Hours & Rules (2026)`.length).toBe(63);
    expect(facilityTitle(f, 'Broomfield', 2026)).toBe('Broomfield Tree Branch Recycling Facility: Hours & Rules'); // 56
    // Changed field: a longer name, so that only dropping " & Rules" as well fits.
    const g = { ...LEAF, name: 'Tree and Branch Recycling Facility West' };
    expect(facilityTitle(g, 'Broomfield', 2026)).toBe('Broomfield Tree and Branch Recycling Facility West: Hours');
  });
  it('year rollover: the year is the town\'s own today (Denver is still 31 Dec at 06:30Z on 1 Jan, and 1 Jan an hour later)', () => {
    const at = (iso: string) => answerMeta(PAGE, { siteName: 'Broomfield View', town: 'Broomfield', today: todayIn('America/Denver', new Date(iso)) }).title;
    expect(at('2027-01-01T06:30:00Z')).toBe('Broomfield Leaf & Branch Drop-Off: Hours & Rules (2026)');
    expect(at('2027-01-01T07:30:00Z')).toBe('Broomfield Leaf & Branch Drop-Off: Hours & Rules (2027)');
  });
});

describe('meta description', () => {
  it('the leaf page on 26 Nov 2026: 154 characters with "Next closed: Sat Nov 28"', () => {
    const m = facilityMeta(LEAF, '2026-11-26');
    expect(m).toBe('Free for Broomfield residents at 2990 W 124th Ave. Open Wed 1–5 PM & Sat 8 AM–5 PM. Next closed: Sat Nov 28. Accepted items, size limits, residency rules.');
    expect(m.length).toBe(154);
  });
  it('after 28 Nov the next closed day is 23 Dec; with none left (3 Jan) the part is left out', () => {
    expect(facilityMeta(LEAF, '2026-11-29')).toContain('Next closed: Wed Dec 23. Accepted');
    expect(facilityMeta(LEAF, '2027-01-03')).toBe('Free for Broomfield residents at 2990 W 124th Ave. Open Wed 1–5 PM & Sat 8 AM–5 PM. Accepted items, size limits, residency rules.');
  });
  it('every day from 1 Nov 2026 to 1 Feb 2027: at most 155 characters, at least the sitewide 120, no past date', () => {
    for (let t = Date.parse('2026-11-01T00:00:00Z'); t <= Date.parse('2027-02-01T00:00:00Z'); t += 86_400_000) {
      const today = new Date(t).toISOString().slice(0, 10);
      const m = facilityMeta(LEAF, today);
      expect(m.length, `${today}: ${m}`).toBeLessThanOrEqual(META_MAX);
      expect(m.length, today).toBeGreaterThanOrEqual(120);
      const next = /Next closed: \w{3} (\w{3}) (\d+)\./.exec(m);
      if (next) expect(CLOSED.some((c) => c.date >= today && shortDate(c.date) === `${shortDate(c.date).slice(0, 3)} ${next[1]} ${next[2]}`), today).toBe(true);
    }
  });
  it('too long: the last sentence goes first (changed field: rulesLine of 100 characters), then "Next closed" (changed field: street)', () => {
    const noTail = 'Free for Broomfield residents at 2990 W 124th Ave. Open Wed 1–5 PM & Sat 8 AM–5 PM. Next closed: Sat Nov 28.';
    expect(facilityMeta({ ...LEAF, rulesLine: 'x'.repeat(100) }, '2026-11-26')).toBe(noTail);
    const long: AnswerFacility = { ...LEAF, street: '2990 W 124th Avenue, within the Tree Branch Recycle & RV Wastewater Disposal Facility' };
    const m = facilityMeta(long, '2026-11-26');
    expect(m).toBe('Free for Broomfield residents at 2990 W 124th Ave, within the Tree Branch Recycle & RV Wastewater Disposal Facility. Open Wed 1–5 PM & Sat 8 AM–5 PM.');
    expect(m.length).toBeLessThanOrEqual(META_MAX);
  });
  it('fallbacks: no hours, no address, no who/cost, nothing but a name: that part is left out, no placeholder', () => {
    const base = { name: LEAF.name, place: LEAF.place, rules: false } as AnswerFacility;
    expect(facilityMeta({ ...LEAF, hours: undefined }, '2027-01-03')).toBe('Free for Broomfield residents at 2990 W 124th Ave. Accepted items, size limits, residency rules.');
    expect(facilityMeta({ ...LEAF, street: undefined }, '2027-01-03')).toBe('Free for Broomfield residents. Open Wed 1–5 PM & Sat 8 AM–5 PM. Accepted items, size limits, residency rules.');
    expect(facilityMeta({ ...LEAF, who: undefined, cost: undefined }, '2027-01-03')).toBe('Leaf & Branch Drop-Off, 2990 W 124th Ave. Open Wed 1–5 PM & Sat 8 AM–5 PM. Accepted items, size limits, residency rules.');
    expect(facilityMeta(base, '2027-01-03')).toBe('Leaf & Branch Drop-Off.');
    for (const f of [LEAF, { ...LEAF, hours: undefined }, { ...LEAF, street: undefined }, base]) expect(facilityMeta(f, '2027-01-03')).not.toMatch(/unavailable|tbd|n\/a|undefined|null/i);
  });
  it('street words are shortened ("Avenue" -> "Ave", "Boulevard" -> "Blvd")', () => {
    expect([abbreviateStreet('2990 W 124th Avenue'), abbreviateStreet('1 Main Street'), abbreviateStreet('5 Sunset Boulevard')]).toEqual(['2990 W 124th Ave', '1 Main St', '5 Sunset Blvd']);
  });
});

describe('the visible rows and the FAQ sentence are the old text, from the same fields', () => {
  it('Where, Hours, Who, Cost as the page had them before the fields', () => {
    expect(facilityRows(LEAF)).toEqual([
      { label: 'Where', value: '**Tree Branch Recycling Facility, 2990 W 124th Avenue**, within the Tree Branch Recycle & RV Wastewater Disposal Facility.' },
      { label: 'Hours', value: 'Wednesdays 1 to 5 p.m. and Saturdays 8 a.m. to 5 p.m., year-round, with some exceptions for holidays.' },
      { label: 'Who', value: 'Broomfield residents only, no contractors or non-residents. Proof of residency is required at the gate.' },
      { label: 'Cost', value: 'Free. Free mulch is available year-round for residents: bring a shovel.' },
    ]);
  });
  it('no note after the hours: one full stop, not two (changed field: hoursNote removed)', () => {
    expect(facilityRows({ ...LEAF, hoursNote: undefined }).find((r) => r.label === 'Hours')!.value).toBe('Wednesdays 1 to 5 p.m. and Saturdays 8 a.m. to 5 p.m.');
    expect(facilityFaq({ ...LEAF, hours: undefined })).toBe('Broomfield residents can drop off leaves, branches and yard waste for free at the Tree Branch Recycling Facility, 2990 W 124th Avenue.');
  });
  it('a missing part is no row (changed fields: hours, who and cost removed)', () => {
    expect(facilityRows({ ...LEAF, hours: undefined, who: undefined, cost: undefined }).map((r) => r.label)).toEqual(['Where']);
  });
  it('the FAQ sentence', () => {
    expect(facilityFaq(LEAF)).toBe('Broomfield residents can drop off leaves, branches and yard waste for free at the Tree Branch Recycling Facility, 2990 W 124th Avenue, Wednesdays 1 to 5 p.m. and Saturdays 8 a.m. to 5 p.m.');
  });
});
