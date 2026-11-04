import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ALL_CONFIGS } from './site-config';

// Broomfield AdSense audit (.claude/specs/broomfield-adsense-audit.md), owner decisions 2026-11-04.
const broomfield = ALL_CONFIGS.find((c) => c.townId === 'broomfield_co')!;
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('Broomfield audit fixes', () => {
  it('sourceBlurb names no school district (both sources are dead ends, school_alerts enabled:false)', () => {
    expect(broomfield.sourceBlurb).not.toMatch(/Adams 12|Boulder Valley|school/i);
  });
  it('the AI content track is retired and its sections are off', () => {
    expect(broomfield.contentTrackRetired).toBe(true);
    for (const s of ['reviews', 'recipes', 'editorials', 'columns']) expect(broomfield.disabledSections).toContain(s);
  });
  it('only the current week page stays indexable; thin facility pages are noindex under 25 own words', () => {
    expect(broomfield.recentWeeksIndexed).toBe(1);
    expect(broomfield.thinFacilityMinOwnWords).toBe(25);
  });
  it('every story read-back in db.ts that can return the content track filters on RETIRED_TYPES', () => {
    const db = read('./db.ts');
    // getAllStories drives /s/ route generation: without the filter the 34 AI pages would still be built.
    const fn = db.slice(db.indexOf('export async function getAllStories'), db.indexOf('export async function getAllStories') + 700);
    expect(fn).toContain('RETIRED_TYPES');
  });
  it('contact page does not claim a library for Broomfield', () => {
    expect(read('../pages/contact.astro')).toMatch(/isBroomfield \? 'the city and county'/);
  });
  it('the AI content track is retired in every town (owner 2026-11-05): no AI /s/ pages, so nothing may canonicalize to them', () => {
    for (const c of ALL_CONFIGS) expect(c.contentTrackRetired, c.townId).toBe(true);
  });
});
