import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { ALL_CONFIGS } from './site-config';
import { DESCRIPTION_KINDS, DESCRIPTION_MAX, DESCRIPTION_MIN, facilityDescription, fitDescription, isWordCut, requireDescription, metaDescription, monthDescription, projectDescription, weekDescription, wholeSentences } from './meta-description';

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
      it('no template needs a word cut (2026-11-11: weather and month descriptions ended "...updated through the…")', () => {
        const all = [...DESCRIPTION_KINDS.map((k) => metaDescription(k, d)), monthDescription(d, 'September 2026'), weekDescription(d, 'Oct 19 to Oct 25', true)];
        for (const s of all) expect(s, s).toMatch(/[.!?]$/);
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

describe('wholeSentences / word cuts', () => {
  it('keeps whole sentences and skips abbreviations', () => {
    expect(wholeSentences('One two. Three four five.', 12)).toBe('One two.');
    expect(wholeSentences('At 225 Commerce St. in town. Next one.', 30)).toBe('At 225 Commerce St. in town.');
    expect(wholeSentences('A sentence far too long for the room', 10)).toBeNull();
  });
  it('a text without a sentence end is cut with an ellipsis, never a fake period', () => {
    const out = fitDescription('word '.repeat(60));
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });
});

describe('projectDescription and dashes', () => {
  const c = ALL_CONFIGS.find((x) => x.townId === 'moreno_valley_ca')!;
  it('a planning text whose first sentence runs past 160 characters gets the whole-sentence template (Moreno 2026-11-11)', () => {
    const p = { title: 'Edgemont Commerce Center', description: 'Change of Zone (PEN23-0076) from Business Park to Light Industrial, Plot Plan (PEN23-0074) for a 142,797 square-foot light industrial building, Tentative Parcel Map and more on a site.' };
    const d = projectDescription(c, p);
    expect(d).toMatch(/^Edgemont Commerce Center in .*\.$/);
    expect(isWordCut(d)).toBe(false);
  });
  it('a short project text is kept as it is', () => {
    expect(projectDescription(c, { title: 'X', description: 'A small park upgrade.' })).toBe('A small park upgrade.');
  });
  it('" -- " becomes a real dash', () => {
    expect(fitDescription('SDSU\'s public garden -- part of the South Dakota Arboretum.')).toBe('SDSU\'s public garden — part of the South Dakota Arboretum.');
  });
});

describe('facilityDescription on the real facility data', () => {
  // Broomfield AdSense plan F6 (2026-11-11): the recycling center's meta description ended "... Two official City of Broomfield pages."
  // -- a word cut dressed up with a period; 23 more facilities in all four towns did the same. Every curated description must be cut
  // at one of its own sentence ends, or give way to the whole-sentence template.
  for (const c of ALL_CONFIGS) {
    const file = join(__dirname, '../../../data/facilities', `${c.townId}.json`);
    if (!existsSync(file)) continue;
    const facilities: { name: string; slug: string; description?: string | null }[] = JSON.parse(readFileSync(file, 'utf8')).facilities;
    it(`${c.townId}: every meta description is whole sentences of the description, or the template`, () => {
      const bad = facilities.filter((f) => f.description?.trim()).filter((f) => {
        const meta = facilityDescription(c, f);
        if (meta.includes('address, phone number and opening hours')) return false; // the template
        const body = meta.startsWith(`${f.name}: `) ? meta.slice(f.name.length + 2) : meta;
        const src = f.description!.replace(/\s+/g, ' ').trim();
        // whole text, or cut right after one of its own sentence ends -- either perhaps followed by a filler sentence
        if (body.startsWith(src)) return false;
        const ends = [...src.matchAll(/[.!?](?= )/g)].map((m) => src.slice(0, m.index + 1));
        return !ends.some((p) => body === p || (body.startsWith(`${p} `) && !src.startsWith(body)));
      }).map((f) => `${f.slug}: ${facilityDescription(c, f)}`);
      expect(bad).toEqual([]);
    });
  }
});

describe('requireDescription (QA build.meta-missing, 2026-11-12)', () => {
  it('an empty or blank description fails the build, naming the page', () => {
    expect(() => requireDescription('', '/s/meeting-2026-11-17-15082/')).toThrow('/s/meeting-2026-11-17-15082/: empty meta description');
    expect(() => requireDescription('   ', '/x/')).toThrow('empty meta description');
    expect(requireDescription('Planning Applications Committee.', '/x/')).toBe('Planning Applications Committee.');
  });
  it('BaseLayout passes every description through it', () => {
    const src = readFileSync(new URL('../layouts/BaseLayout.astro', import.meta.url), 'utf8');
    expect(src).toContain('requireDescription(fitDescription(');
  });
});
