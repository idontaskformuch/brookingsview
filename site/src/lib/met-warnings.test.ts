import { describe, expect, it } from 'vitest';
import { formatValidity, isInForce, levelLabel, sortWarnings, splitParagraphs, warningName, weatherTypeText } from './met-warnings';

describe('met-warnings helpers', () => {
  it('is in force only while validTo is in the future', () => {
    expect(isInForce({ validTo: '2026-10-25T21:00:00Z' }, new Date('2026-10-25T20:59:59Z'))).toBe(true);
    expect(isInForce({ validTo: '2026-10-25T21:00:00Z' }, new Date('2026-10-25T21:00:00Z'))).toBe(false);
    expect(isInForce({ validTo: 'garbage' }, new Date())).toBe(false);
  });
  it('shows validity in Europe/London time (BST until 25 Oct 01:00 UTC, then GMT)', () => {
    // 20:00Z on 24 Oct is 9pm BST; 21:00Z on 25 Oct is 9pm GMT (clocks go back at 01:00 UTC).
    expect(formatValidity('2026-10-24T20:00:00Z', '2026-10-25T21:00:00Z', 'Europe/London'))
      .toBe('Valid from 9pm Sat 24 Oct to 9pm Sun 25 Oct');
    expect(formatValidity('2026-10-24T11:00:00Z', '2026-10-24T18:30:00Z', 'Europe/London'))
      .toBe('Valid from 12pm to 7:30pm on Sat 24 Oct');
  });
  it('sorts red before amber before yellow, then by start', () => {
    const l = sortWarnings([
      { level: 'yellow' as const, validFrom: '2026-10-24T11:00:00Z' },
      { level: 'amber' as const, validFrom: '2026-10-24T20:00:00Z' },
      { level: 'yellow' as const, validFrom: '2026-10-23T11:00:00Z' },
    ]);
    expect(l.map((w) => w.level + w.validFrom.slice(8, 10))).toEqual(['amber24', 'yellow23', 'yellow24']);
  });
  it('words', () => {
    expect(levelLabel('amber')).toBe('Amber');
    expect(weatherTypeText(['WIND'])).toBe('wind');
    expect(weatherTypeText(['EXTREME_HEAT', 'WIND'])).toBe('extreme heat and wind');
  });
});

describe('splitParagraphs / warningName', () => {
  const long = 'Driving in these conditions can be dangerous, for yourself and other road users. If you must drive, take care. Being outside in high winds makes you more vulnerable to injury. Stay indoors as much as possible. In advance of high winds, check for loose items outside your home and secure them. If you are on the coast, stay safe during stormy weather. In an emergency, call 999.';
  it('splits at sentence ends into short paragraphs and loses no text', () => {
    const p = splitParagraphs(long, 160);
    expect(p.length).toBeGreaterThan(2);
    expect(p.every((x) => x.length <= 160 || !/[.!?] /.test(x))).toBe(true);
    expect(p.join(' ')).toBe(long);
  });
  it('keeps one long sentence whole and handles empty text', () => {
    expect(splitParagraphs('One very long sentence without any stop that goes on and on', 20)).toHaveLength(1);
    expect(splitParagraphs('  ')).toEqual([]);
  });
  it('names a warning', () => expect(warningName({ level: 'amber', weatherTypes: ['WIND'] })).toBe('Amber warning: wind'));
});
