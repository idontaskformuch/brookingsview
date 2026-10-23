import { describe, expect, it } from 'vitest';
import { holidaysFor, nextPickup, upcomingHolidayShifts, type Side, type Stream } from './trash-schedule';

const d = (y: number, m: number, day: number) => Date.UTC(y, m - 1, day);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const next = (side: Side, stream: Stream, today: number) => nextPickup(side, stream, today);

describe('holidaysFor', () => {
  it('computes the 2026 dates the city observes', () => {
    const byName = Object.fromEntries(holidaysFor(2026).map((h) => [h.name, iso(h.date)]));
    expect(byName["New Year's Day"]).toBe('2026-01-01');
    expect(byName['Martin Luther King Jr. Day']).toBe('2026-01-19');
    expect(byName["Presidents' Day"]).toBe('2026-02-16');
    expect(byName['Memorial Day']).toBe('2026-05-25');
    expect(byName.Juneteenth).toBe('2026-06-19');
    expect(byName['Independence Day']).toBe('2026-07-04');
    expect(byName['Labor Day']).toBe('2026-09-07');
    expect(byName['Native American Day']).toBe('2026-10-12');
    expect(byName['Veterans Day']).toBe('2026-11-11');
    expect(byName['Thanksgiving Day']).toBe('2026-11-26');
    expect(byName['Christmas Day']).toBe('2026-12-25');
  });
});

describe('nextPickup, normal weeks', () => {
  it('south: garbage Monday, recycling Thursday (week of Oct 19, 2026)', () => {
    expect(iso(next('south', 'garbage', d(2026, 10, 22))!.date)).toBe('2026-10-26');
    expect(iso(next('south', 'recycling', d(2026, 10, 22))!.date)).toBe('2026-10-22'); // today counts
    expect(iso(next('south', 'recycling', d(2026, 10, 23))!.date)).toBe('2026-10-29');
  });
  it('north: garbage Tuesday, recycling Friday', () => {
    expect(iso(next('north', 'garbage', d(2026, 10, 22))!.date)).toBe('2026-10-27');
    expect(iso(next('north', 'recycling', d(2026, 10, 22))!.date)).toBe('2026-10-23');
  });
});

describe('the city holiday rule', () => {
  it('Thursday holiday (Thanksgiving Nov 26, 2026): Thursday recycling moves to Wednesday Nov 25', () => {
    const r = next('south', 'recycling', d(2026, 11, 23))!;
    expect(iso(r.date)).toBe('2026-11-25');
    expect(r.shifted).toBe(true);
    expect(r.holiday).toBe('Thanksgiving Day');
  });
  it('Thanksgiving does not move north Friday recycling or either garbage day', () => {
    expect(iso(next('north', 'recycling', d(2026, 11, 23))!.date)).toBe('2026-11-27');
    expect(iso(next('south', 'garbage', d(2026, 11, 23))!.date)).toBe('2026-11-23');
    expect(iso(next('north', 'garbage', d(2026, 11, 24))!.date)).toBe('2026-11-24');
  });
  it('Friday holiday (Christmas Dec 25, 2026): Friday recycling to Thursday, Thursday recycling to Wednesday', () => {
    expect(iso(next('north', 'recycling', d(2026, 12, 21))!.date)).toBe('2026-12-24');
    expect(iso(next('south', 'recycling', d(2026, 12, 21))!.date)).toBe('2026-12-23');
  });
  it("Friday holiday (New Year's Day Jan 1, 2027) works across the year change", () => {
    expect(iso(next('north', 'recycling', d(2026, 12, 28))!.date)).toBe('2026-12-31');
    expect(iso(next('south', 'recycling', d(2026, 12, 28))!.date)).toBe('2026-12-30');
  });
  it('Monday holiday (Labor Day Sep 7, 2026): Monday garbage to Tuesday, Tuesday garbage to Wednesday', () => {
    expect(iso(next('south', 'garbage', d(2026, 9, 3))!.date)).toBe('2026-09-08');
    expect(iso(next('north', 'garbage', d(2026, 9, 3))!.date)).toBe('2026-09-09');
  });
  it('Tuesday holiday: only Tuesday garbage moves (Wednesday)', () => {
    // synthetic: apply the rule through upcomingHolidayShifts on a year where Jul 4 is a Tuesday (2023)
    const shifts = upcomingHolidayShifts(d(2023, 6, 30), 10, 'north');
    expect(shifts.find((s) => s.name === 'Independence Day')!.moves).toContain('Garbage: Tuesday to Wednesday');
    expect(upcomingHolidayShifts(d(2023, 6, 30), 10, 'south').find((s) => s.name === 'Independence Day')!.moves)
      .not.toContain('Garbage: Monday to Tuesday');
  });
  it('Sunday holiday affects the Monday after; Saturday holiday affects the Friday before', () => {
    // Jan 1 2023 was a Sunday: Monday Jan 2 garbage (south) moves to Tuesday
    expect(upcomingHolidayShifts(d(2022, 12, 30), 5, 'south').find((s) => s.name === "New Year's Day")!.moves)
      .toContain('Garbage: Monday to Tuesday');
    // Jul 4 2026 is a Saturday: Friday Jul 3 recycling (north) moves to Thursday
    expect(upcomingHolidayShifts(d(2026, 6, 30), 6, 'north').find((s) => s.name === 'Independence Day')!.moves)
      .toContain('Recycling: Friday to Thursday');
  });
  it('Wednesday holiday (Veterans Day Nov 11, 2026) changes nothing', () => {
    const shifts = upcomingHolidayShifts(d(2026, 11, 9), 5, 'south').find((s) => s.name === 'Veterans Day')!;
    expect(shifts.moves).toEqual([]);
    expect(iso(next('south', 'recycling', d(2026, 11, 9))!.date)).toBe('2026-11-12');
  });
});

describe('yard waste season (2026: April 6 to November 24)', () => {
  it('runs in October', () => {
    expect(iso(next('south', 'yard', d(2026, 10, 22))!.date)).toBe('2026-10-22');
  });
  it('is over after November 24 and returns null', () => {
    expect(next('south', 'yard', d(2026, 11, 25))).toBeNull();
    expect(next('north', 'yard', d(2026, 12, 15))).toBeNull();
  });
  it('last day of the season still counts (Tuesday Nov 24, north)', () => {
    expect(iso(next('north', 'yard', d(2026, 11, 24))!.date)).toBe('2026-11-24');
  });
});

describe('upcomingHolidayShifts and yard waste', () => {
  it('lists no yard waste move when the holiday week is outside the 2026 season', () => {
    const thanksgiving = upcomingHolidayShifts(d(2026, 11, 20), 10, 'south').find((x) => x.name === 'Thanksgiving Day')!;
    expect(thanksgiving.moves).toEqual(['Recycling: Thursday to Wednesday']);
    const mlk = upcomingHolidayShifts(d(2027, 1, 15), 5, 'south').find((x) => x.name === 'Martin Luther King Jr. Day')!;
    expect(mlk.moves).toEqual(['Garbage: Monday to Tuesday']);
  });
  it('keeps yard waste moves inside the season (Labor Day 2026)', () => {
    const labor = upcomingHolidayShifts(d(2026, 9, 1), 10, 'south').find((x) => x.name === 'Labor Day')!;
    expect(labor.moves).toEqual(['Garbage: Monday to Tuesday', 'Yard waste: Monday to Tuesday']);
  });
});
