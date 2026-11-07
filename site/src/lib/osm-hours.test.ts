import { describe, expect, it } from 'vitest';
import { parseOpeningHours, parseOpeningHoursDetailed, lateRange, closingLabel, type HoursParse } from './osm-hours';

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

describe('parseOpeningHoursDetailed (owner 2026-11-07: read more of OSM, never guess)', () => {
  const week = (raw: string) => {
    const r: HoursParse = parseOpeningHoursDetailed(raw);
    if (r.kind !== 'week') throw new Error(`${raw}: ${r.kind}`);
    return r.week;
  };
  const TU = 1, TH = 3, SU = 6;

  it('comma-separated rules add to each other; Fr,Sa day lists work', () => {
    const w = week('Su-Th 12:00-23:00, Fr,Sa 12:00-01:00');
    expect(w[SU]).toEqual([{ start: 720, end: 1380 }]);
    expect(w[FR]).toEqual([{ start: 720, end: 1500 }]);
    expect(week('Mo-Th,Su 11:00-22:00; Fr,Sa 11:00-23:00')[SU]).toEqual([{ start: 660, end: 1320 }]);
    expect(week('Mo-Th, Su 11:00-22:00; Fr, Sa 11:00-23:00')[SA]).toEqual([{ start: 660, end: 1380 }]);
  });
  it('an added rule that overlaps a day merges into one range', () => {
    expect(week('Th-Su 16:00-22:00, Fr,Sa 16:00-22:30')[FR]).toEqual([{ start: 960, end: 1350 }]);
    expect(week('Th-Su 16:00-22:00, Fr,Sa 16:00-22:30')[TH]).toEqual([{ start: 960, end: 1320 }]);
  });
  it('a ";" rule overrides the days it names (OSM semantics)', () => {
    const w = week('Mo-Sa 11:30-14:30; Mo-Th 16:30-21:00');
    expect(w[MO]).toEqual([{ start: 990, end: 1260 }]);
    expect(w[FR]).toEqual([{ start: 690, end: 870 }]);
  });
  it('spaces around the hyphen', () => {
    expect(week('16:00 - 23:00')[TU]).toEqual([{ start: 960, end: 1380 }]);
    expect(week('Mo - Fr 09:00 - 17:00')[MO]).toEqual([{ start: 540, end: 1020 }]);
  });
  it('closing after midnight: 24:00, 00:00, 25:00 and 01:00 all read as the next day; a late "close" past 06:00 does not', () => {
    expect(week('Mo-Su 09:00-00:00')[MO]).toEqual([{ start: 540, end: 1440 }]);
    expect(week('Su-Th 12:00-24:00')[SU]).toEqual([{ start: 720, end: 1440 }]);
    expect(week('Fr-Sa 11:00-25:00')[FR]).toEqual([{ start: 660, end: 1500 }]);
    expect(week('Fr,Sa 18:00-02:00')[SA]).toEqual([{ start: 1080, end: 1560 }]);
    expect(parseOpeningHoursDetailed('Fr 11:00-31:00').kind).toBe('unparsed');
    expect(parseOpeningHoursDetailed('Fr 12:00-10:00').kind).toBe('unparsed');
  });
  it('a comma rule may follow an "off" / "Closed" rule', () => {
    expect(week('Mo 22:00-02:00; Tu off, We 22:00-02:00')[TU]).toEqual([]);
    expect(week('Mo-We Closed, Th-Fr 17:00-23:00')[TH]).toEqual([{ start: 1020, end: 1380 }]);
  });
  it('closed / off means closed', () => {
    expect(parseOpeningHoursDetailed('closed').kind).toBe('closed');
    expect(parseOpeningHoursDetailed('off').kind).toBe('closed');
    const w = week('Mo-Fr 09:00-17:00; Sa,Su off');
    expect(w[SA]).toEqual([]);
    expect(week('Mo-Su 10:00-22:00; Su closed')[SU]).toEqual([]);
  });
  it('public / school holiday rules hide the time', () => {
    expect(parseOpeningHoursDetailed('Mo-Fr 09:00-17:00; PH off')).toEqual({ kind: 'untimed', reason: 'holiday' });
    expect(parseOpeningHoursDetailed('Mo-Sa 10:00-20:00; SH 12:00-18:00')).toEqual({ kind: 'untimed', reason: 'holiday' });
  });
  it('an open end and a comment show the place without a time', () => {
    expect(parseOpeningHoursDetailed('Mo-Su 11:00+')).toEqual({ kind: 'untimed', reason: 'open-end' });
    expect(parseOpeningHoursDetailed('11:00-12:00+ "until it is gone"').kind).toBe('untimed');
    expect(parseOpeningHoursDetailed('Mo-Fr 09:00-17:00 "by appointment"')).toEqual({ kind: 'untimed', reason: 'comment' });
  });
  it('anything else outside the subset stays unparsed (never guessed)', () => {
    for (const raw of ['', 'Mo-Fr 9-5', 'sunrise-sunset', 'Mo-Fr 09:00-17:00; Jan-Mar off', 'Mo-Fr 25:99-17:00']) expect(parseOpeningHoursDetailed(raw).kind, raw).toBe('unparsed');
  });
  it('parseOpeningHours (open-late block) still returns only exact weeks', () => {
    expect(parseOpeningHours('Mo-Su 11:00+')).toBeNull();
    expect(parseOpeningHours('Mo-Fr 09:00-17:00; PH off')).toBeNull();
    expect(parseOpeningHours('Fr,Sa 12:00-01:00')![FR]).toEqual([{ start: 720, end: 1500 }]);
  });
});
