import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VENUE_CATEGORIES, isPublicPlace, FACILITY_CATEGORY_LABELS, FACILITY_SCHEMA_TYPE } from './db';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

// Real rows: The Old Man Bar / Chipper's Lanes Broomfield / FlatIron Crossing as prepared in .claude/prepared/add_venues_broomfield.sql
// (slug, name, category verbatim); Mamie Doud Eisenhower Public Library = places slug 'library', broomfield_co.
const oldMan = { slug: 'the-old-man-bar', name: 'The Old Man Bar', category: 'bar_brewery' };
const chippers = { slug: 'chippers-lanes-broomfield', name: "Chipper's Lanes Broomfield", category: 'music_venue' };
const flatiron = { slug: 'flatiron-crossing', name: 'FlatIron Crossing', category: 'shopping' };
const library = { slug: 'library', name: 'Mamie Doud Eisenhower Public Library', category: 'library' };

describe('venue categories (bars, music venues, shopping) are place rows, not public facilities (owner 2026-11-13)', () => {
  it('a venue is not a public place; a library is', () => {
    for (const v of [oldMan, chippers, flatiron]) expect(isPublicPlace(v)).toBe(false);
    expect(isPublicPlace(library)).toBe(true);
  });

  it('each venue category has a label and a schema.org type', () => {
    for (const c of VENUE_CATEGORIES) {
      expect(FACILITY_CATEGORY_LABELS[c]).toBeTruthy();
      expect(FACILITY_SCHEMA_TYPE[c]).toBeTruthy();
    }
    expect([FACILITY_SCHEMA_TYPE.bar_brewery, FACILITY_SCHEMA_TYPE.music_venue, FACILITY_SCHEMA_TYPE.shopping])
      .toEqual(['BarOrPub', 'MusicVenue', 'ShoppingCenter']);
  });

  it('astro.config.mjs keeps exactly the same categories out of the sitemap', () => {
    const m = read('../../astro.config.mjs').match(/const VENUE_CATEGORIES = (\[[^\]]*\]);/);
    expect(m).not.toBeNull();
    const mirror = Function(`return ${m![1]}`)() as string[];
    expect(new Set(mirror)).toEqual(new Set(VENUE_CATEGORIES));
    expect(read('../../astro.config.mjs')).toMatch(/if \(VENUE_CATEGORIES\.includes\(f\.category\)\) noindexThinPageUrls\.add/);
  });

  it('the hub, Today\'s "Hours today" and llms.txt filter on isPublicPlace; a venue page is noindex', () => {
    expect(read('../pages/facilities/index.astro')).toMatch(/\(await getFacilities\(\)\)\.filter\(isPublicPlace\)/);
    expect(read('../pages/llms.txt.ts')).toMatch(/\(await getFacilities\(\)\)\.filter\(isPublicPlace\)/);
    expect(read('../pages/today.astro')).toMatch(/const withHours = facilities\.filter\(\(f\) => isPublicPlace\(f\) &&/);
    const slugPage = read('../pages/facilities/[slug].astro');
    expect(slugPage).toMatch(/const isVenue = !isPublicPlace\(facility\);/);
    expect(slugPage).toMatch(/noindex=\{[^}]*\bisVenue\b[^}]*\}/);
  });
});
