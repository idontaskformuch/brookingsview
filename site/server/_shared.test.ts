import { describe, expect, it } from 'vitest';
import { isoWeekSlugForInstant, timezoneForTown, townFromHostname } from './_shared';

// Mirrors site/src/lib/this-week.test.ts's own isoWeekInfo coverage --
// _shared.ts's isoWeekSlugForInstant is a deliberate, self-contained
// duplicate of that file's algorithm (see this-week.ts can't be imported
// into the Worker bundle -- it transitively pulls in lib/db.ts's
// neon(import.meta.env.DATABASE_URL) module-load-time call), so both need
// their own coverage for the same edge cases rather than trusting one
// implementation's tests to stand in for the other's.
describe('isoWeekSlugForInstant', () => {
  it('a mid-year Thursday lands on its own week', () => {
    // 2026-08-27 is a Thursday in ISO week 35.
    expect(isoWeekSlugForInstant(new Date('2026-08-27T12:00:00Z'), 'UTC')).toBe('2026-w35');
  });

  it('2027-01-01 (a Friday) belongs to ISO week-numbering year 2026, not 2027', () => {
    // Verified independently via Python's date.isocalendar() before writing
    // this assertion: 2026-01-01 is itself a Thursday, so it's already
    // week 1 of 2026 -- NOT the previous-year case this test needs. A year
    // starting on Friday/Saturday/Sunday is what actually pushes Jan 1
    // into the prior ISO year; 2027-01-01 (Friday) is the nearest example.
    expect(isoWeekSlugForInstant(new Date('2027-01-01T12:00:00Z'), 'UTC')).toBe('2026-w53');
  });

  it('2026-12-31 (a Thursday) is in ISO week 53 of 2026', () => {
    expect(isoWeekSlugForInstant(new Date('2026-12-31T12:00:00Z'), 'UTC')).toBe('2026-w53');
  });

  it('2027-01-03 (a Sunday) is still the last week of 2026', () => {
    expect(isoWeekSlugForInstant(new Date('2027-01-03T12:00:00Z'), 'UTC')).toBe('2026-w53');
  });

  it('2027-01-04 (a Monday) rolls over into week 1 of 2027', () => {
    expect(isoWeekSlugForInstant(new Date('2027-01-04T12:00:00Z'), 'UTC')).toBe('2027-w01');
  });

  it('US DST spring-forward date (2026-03-08) resolves correctly in America/Denver', () => {
    // Local noon that day -- unaffected by the 2am transition itself, but
    // exercises the Intl.DateTimeFormat(timeZone=...) path across a
    // transition day rather than assuming UTC offset math would work.
    expect(isoWeekSlugForInstant(new Date('2026-03-08T19:00:00Z'), 'America/Denver')).toBe('2026-w10');
  });

  it('US DST fall-back date (2026-11-01) resolves correctly in America/Denver', () => {
    expect(isoWeekSlugForInstant(new Date('2026-11-01T19:00:00Z'), 'America/Denver')).toBe('2026-w44');
  });

  it('the same instant near midnight Sunday can land on different weeks in different timezones', () => {
    // 2026-08-31T05:30Z is 23:30 Sunday Aug 30 in America/Denver (MDT,
    // UTC-6 -- still week 35) but already 00:30 Monday Aug 31 in
    // America/Chicago (CDT, UTC-5, one hour east -- week 36). Verified via
    // Intl.DateTimeFormat directly before writing this assertion, not
    // assumed from the UTC offset alone.
    const instant = new Date('2026-08-31T05:30:00Z');
    expect(isoWeekSlugForInstant(instant, 'America/Denver')).toBe('2026-w35');
    expect(isoWeekSlugForInstant(instant, 'America/Chicago')).toBe('2026-w36');
  });
});

describe('townFromHostname', () => {
  it('resolves broomfieldview.com to broomfield_co', () => {
    expect(townFromHostname('https://broomfieldview.com/this-week/')).toBe('broomfield_co');
  });

  it('resolves www.brookingsview.com to brookings_sd', () => {
    expect(townFromHostname('https://www.brookingsview.com/')).toBe('brookings_sd');
  });

  it('falls back to devFallback for an unknown hostname (e.g. localhost)', () => {
    expect(townFromHostname('http://localhost:8787/', 'moreno_valley_ca')).toBe('moreno_valley_ca');
  });

  it('returns null for an unknown hostname with no devFallback', () => {
    expect(townFromHostname('http://localhost:8787/')).toBeNull();
  });
});

describe('timezoneForTown', () => {
  it('returns each town\'s real IANA zone', () => {
    expect(timezoneForTown('broomfield_co')).toBe('America/Denver');
    expect(timezoneForTown('brookings_sd')).toBe('America/Chicago');
    expect(timezoneForTown('moreno_valley_ca')).toBe('America/Los_Angeles');
  });

  it('falls back to Brookings\' zone for an unknown/null town', () => {
    expect(timezoneForTown(null)).toBe('America/Chicago');
  });
});
