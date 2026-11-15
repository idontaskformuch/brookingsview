import { describe, expect, it } from 'vitest';
import { occurrenceDay } from './holiday-calendar';
import { holidayPageDef } from '../config/holiday-pages/calendar';
import { buildThanksgivingPage, computeBrookingsMoves, yardWasteClaimsWithoutMove } from '../config/holiday-pages/thanksgiving';
import type { HolidayFact } from './holiday-page';

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const def = holidayPageDef('thanksgiving')!;

describe('Thanksgiving Day (shared date rule with the photo pool)', () => {
  it('is the fourth Thursday of November', () => {
    expect(iso(occurrenceDay(def, 2026))).toBe('2026-11-26');
    expect(iso(occurrenceDay(def, 2025))).toBe('2025-11-27');
    expect(iso(occurrenceDay(def, 2027))).toBe('2027-11-25');
    expect(iso(occurrenceDay(def, 2023))).toBe('2023-11-23'); // November starts on a Wednesday
    expect(iso(occurrenceDay(def, 2022))).toBe('2022-11-24'); // November starts on a Tuesday
  });
});

describe('QA data.holiday-yard-waste (Brookings, owner 2026-11-15)', () => {
  const moves = computeBrookingsMoves();
  it('Thanksgiving week 2026 has no yard waste move (season ends Nov 24)', () => {
    expect([...moves.south, ...moves.north].some((m) => m.startsWith('Yard waste'))).toBe(false);
  });
  it('the page says nothing about yard waste being picked up that week', () => {
    expect(yardWasteClaimsWithoutMove(buildThanksgivingPage('brookings_sd', moves)!, moves)).toEqual([]);
  });
  it('regression: the Holiday rule row as committed before the fix fails', () => {
    const page = buildThanksgivingPage('brookings_sd', moves)!;
    const before: HolidayFact = {
      ...(page.facts.find((f) => f.label === 'Holiday rule') as HolidayFact & { status: 'confirmed' }),
      value: 'Thanksgiving is a collection holiday: recycling and yard waste are picked up Wednesday.',
      insight: 'Recycling and yard waste are picked up Wed Nov 25.',
      meta: 'Recycling and yard waste move to Wed Nov 25',
    } as HolidayFact;
    const old = { ...page, facts: page.facts.map((f) => (f.label === 'Holiday rule' ? before : f)) };
    expect(yardWasteClaimsWithoutMove(old, moves)).toEqual([
      'Holiday rule: "Thanksgiving is a collection holiday: recycling and yard waste are picked up Wednesday."',
      'Holiday rule: "Recycling and yard waste are picked up Wed Nov 25."',
      'Holiday rule: "Recycling and yard waste move to Wed Nov 25"',
    ]);
  });
});
