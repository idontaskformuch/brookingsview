import { describe, it, expect } from 'vitest';
import { ALL_CONFIGS } from './site-config';
import { DESCRIPTION_KINDS, DESCRIPTION_MAX, DESCRIPTION_MIN, facilityDescription, fitDescription, metaDescription, weekDescription } from './meta-description';

describe('fitDescription', () => {
  it('trims at a sentence end, else a word, and never past 160', () => {
    const long = `${'First sentence is here and is quite a bit long. '.repeat(2)}${'word '.repeat(40)}`;
    const out = fitDescription(long);
    expect(out.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(out).toMatch(/[.!?]$/);
  });
  it('appends fillers only while short, and only if they fit', () => {
    const short = 'A short page description.';
    const out = fitDescription(short, ['Filler sentence number one that adds some useful length here.', 'Second filler that adds still more length to the description.']);
    expect(out.length).toBeGreaterThanOrEqual(DESCRIPTION_MIN);
    expect(out.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });
});

describe('every template, every town', () => {
  for (const c of ALL_CONFIGS) {
    describe(c.townId, () => {
      const d = { ...c, siteName: c.siteName };
      for (const k of DESCRIPTION_KINDS) {
        it(`${k} is ${DESCRIPTION_MIN}-${DESCRIPTION_MAX} characters`, () => {
          const s = metaDescription(k, d);
          expect(s.length, s).toBeGreaterThanOrEqual(DESCRIPTION_MIN);
          expect(s.length, s).toBeLessThanOrEqual(DESCRIPTION_MAX);
        });
      }
      it('no two page types share a description', () => {
        const all = DESCRIPTION_KINDS.map((k) => metaDescription(k, d));
        expect(new Set(all).size).toBe(all.length);
      });
      it('no digits (no daily numbers)', () => {
        for (const k of DESCRIPTION_KINDS) expect(metaDescription(k, d), k).not.toMatch(/\d/);
      });
      it('facility and week pages fit and differ per page', () => {
        const a = facilityDescription(d, { name: 'Briggs Library', street_address: '1 Main St' });
        const b = facilityDescription(d, { name: 'Lions Park' });
        expect(a).not.toBe(b);
        expect(facilityDescription(d, { name: 'North Fire Station', description: 'A fire station.' })).not.toBe(facilityDescription(d, { name: 'South Fire Station', description: 'A fire station.' }));
        for (const s of [a, b, weekDescription(d, 'Oct 19 to Oct 25', true), facilityDescription(d, { name: 'X', description: 'Short curated text.' })]) {
          expect(s.length, s).toBeGreaterThanOrEqual(DESCRIPTION_MIN);
          expect(s.length, s).toBeLessThanOrEqual(DESCRIPTION_MAX);
        }
      });
    });
  }
});
