import { describe, expect, it } from 'vitest';
import { orientationDateLabel, orientationDateIso } from './orientation-header';

// Handoff's own fixture: a single instant, 2026-09-10T05:30Z, reads as a
// DIFFERENT local calendar date in each town depending on its own IANA
// timezone -- the exact class of bug a naive `new Date()`/build-machine-
// local-time header would get wrong.
const INSTANT = new Date('2026-09-10T05:30:00Z');

describe('orientationDateLabel / orientationDateIso per town timezone', () => {
  it('Moreno Valley (America/Los_Angeles, PDT): shows Sep 9', () => {
    expect(orientationDateIso(INSTANT, 'America/Los_Angeles')).toBe('2026-09-09');
    expect(orientationDateLabel(INSTANT, 'America/Los_Angeles')).toBe('Wednesday, Sep 9');
  });

  it('Broomfield (America/Denver, MDT): shows Sep 9', () => {
    expect(orientationDateIso(INSTANT, 'America/Denver')).toBe('2026-09-09');
    expect(orientationDateLabel(INSTANT, 'America/Denver')).toBe('Wednesday, Sep 9');
  });

  it('Brookings (America/Chicago, CDT): shows Sep 10', () => {
    expect(orientationDateIso(INSTANT, 'America/Chicago')).toBe('2026-09-10');
    expect(orientationDateLabel(INSTANT, 'America/Chicago')).toBe('Thursday, Sep 10');
  });

  it('never falls back to UTC or build-machine local time -- three different towns, one instant, three different answers', () => {
    const results = new Set([
      orientationDateIso(INSTANT, 'America/Los_Angeles'),
      orientationDateIso(INSTANT, 'America/Denver'),
      orientationDateIso(INSTANT, 'America/Chicago'),
    ]);
    expect(results.size).toBe(2); // MoVal and Broomfield agree (Sep 9), Brookings differs (Sep 10)
  });
});
