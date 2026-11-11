import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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

describe('facilityDescription on the real facility data', () => {
  // Broomfield AdSense plan F6 (2026-11-11): the recycling center's meta description ended "... Two official City of Broomfield pages."
  // -- a word cut dressed up with a period. Its curated description must be cut at one of its own sentence ends. (23 other facilities
  // still get a word cut; widening this to every facility waits for the owner, see .claude/state.md.)
  const CHECKED = new Set(['broomfield-recycling-center']);
  for (const c of ALL_CONFIGS) {
    const file = join(__dirname, '../../../data/facilities', `${c.townId}.json`);
    if (!existsSync(file)) continue;
    const facilities: { name: string; slug: string; description?: string | null }[] = JSON.parse(readFileSync(file, 'utf8')).facilities;
    if (!facilities.some((f) => CHECKED.has(f.slug))) continue;
    it(`${c.townId}: the meta description ends where a sentence of the description ends`, () => {
      const bad = facilities.filter((f) => CHECKED.has(f.slug) && f.description?.trim()).filter((f) => {
        const meta = facilityDescription(c, f);
        const body = meta.startsWith(`${f.name}: `) ? meta.slice(f.name.length + 2) : meta;
        const src = f.description!.replace(/\s+/g, ' ').trim();
        // whole text (perhaps with a filler sentence after it), or cut right after one of its own sentence ends
        const wholeText = body.startsWith(src);
        const sentenceCut = src.startsWith(body) && /[.!?]$/.test(body) && src[body.length] === ' ';
        return !(wholeText || sentenceCut);
      }).map((f) => `${f.slug}: ${facilityDescription(c, f)}`);
      expect(bad).toEqual([]);
    });
  }
});
