import { describe, expect, it } from 'vitest';
import { parseOpeningHours, lateRange, closingLabel } from './osm-hours';

const FR = 4, SA = 5, MO = 0;

describe('parseOpeningHours', () => {
  it('reads day ranges, lists and overrides', () => {
    const w = parseOpeningHours('Mo-Th 12:00-23:00; Fr,Sa 12:00-02:00; Su 12:30-22:30')!;
    expect(w[MO]).toEqual([{ start: 720, end: 1380 }]);
    expect(w[FR]).toEqual([{ start: 720, end: 1560 }]);
    expect(w[6]).toEqual([{ start: 750, end: 1350 }]);
    const o = parseOpeningHours('Mo-Su 10:00-23:30; Su off')!;
    expect(o[6]).toEqual([]);
    expect(o[MO]).toEqual([{ start: 600, end: 1410 }]);
  });
  it('treats a rule without days as every day and reads split shifts', () => {
    const w = parseOpeningHours('11:00-14:00,17:00-24:00')!;
    expect(w[3]).toEqual([{ start: 660, end: 840 }, { start: 1020, end: 1440 }]);
  });
  it('keeps an overnight range that ends by 06:00', () => {
    expect(parseOpeningHours('Fr 22:00-06:00')![FR]).toEqual([{ start: 1320, end: 1800 }]);
  });
  it('reads 24/7', () => {
    expect(parseOpeningHours('24/7')![2]).toEqual([{ start: 0, end: 1440 }]);
  });
  it.each(['Mo-Fr 12:00-23:00; PH off', 'Mo-Su sunrise-sunset', 'Mo-Fr 12:00+', 'Jan-Mar Mo 10:00-12:00', 'by appointment', 'Mo 25:00-26:00', 'Mo-Su 12:00-10:00', '', 'Mo 10:00-23:00 "kitchen closes 21:00"'])(
    'gives up on %j instead of guessing', (s) => { expect(parseOpeningHours(s)).toBeNull(); });
  it('returns null for missing input', () => {
    expect(parseOpeningHours(null)).toBeNull();
    expect(parseOpeningHours(undefined)).toBeNull();
  });
});

describe('lateRange and closingLabel', () => {
  const w = parseOpeningHours('Mo-Th 12:00-23:00; Fr,Sa 12:00-02:00')!;
  it('needs a close after 23:00', () => {
    expect(lateRange(w, MO)).toBeNull();
    expect(lateRange(w, FR)).toEqual({ start: 720, end: 1560 });
    expect(lateRange(parseOpeningHours('Mo 12:00-23:01')!, MO)).not.toBeNull();
  });
  it('does not count the early-morning tail of yesterday as tonight', () => {
    const only = parseOpeningHours('Fr 20:00-03:00')!;
    expect(lateRange(only, SA)).toBeNull();
  });
  it('words the closing time', () => {
    expect(closingLabel({ start: 720, end: 1440 })).toBe('until midnight');
    expect(closingLabel({ start: 720, end: 1560 })).toBe('until 2am');
    expect(closingLabel({ start: 720, end: 1470 })).toBe('until 12:30am');
    expect(closingLabel({ start: 720, end: 1500 })).toBe('until 1am');
    expect(closingLabel({ start: 0, end: 1440 })).toBe('open 24 hours');
  });
});
