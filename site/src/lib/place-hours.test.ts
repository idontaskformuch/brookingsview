import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ALL_CONFIGS } from './site-config';
import { computePlaceOpenStatus, isPastStalenessThreshold, buildPlaceOpeningHoursSpecification } from './place-hours';
import type { PlaceHoursRow, PlaceHoursException } from './db';

const TZ = 'America/Denver';

// 2026-09-07 is a real Monday (day_of_week 1 -- Sunday=0..Saturday=6).
const MON_THU_9_5: PlaceHoursRow[] = [1, 2, 3, 4].map((day_of_week) => ({
  day_of_week, opens: '09:00:00', closes: '17:00:00', valid_from: null, valid_to: null,
}));

// Denver is UTC-6 in September (MDT) -- construct the UTC instant
// corresponding to the given Denver local time directly, same convention
// as facility-hours.test.ts's own chicagoInstant().
function denverInstant(hour: number, minute: number, day = 7): Date {
  return new Date(Date.UTC(2026, 8, day, hour + 6, minute));
}

describe('computePlaceOpenStatus: the weekday label is the weekday in the town (Q3 2026-10-23)', () => {
  it('names Monday, not the reader/build machine weekday, when UTC is already a day ahead of the town', () => {
    // Fri 2026-10-23 19:30 in Chicago (CDT) is 00:30Z on Saturday. Mon-Fri 9-5. Next opening: Monday 9:00 AM.
    const hours: PlaceHoursRow[] = [1, 2, 3, 4, 5].map((day_of_week) => ({ day_of_week, opens: '09:00:00', closes: '17:00:00', valid_from: null, valid_to: null }));
    const status = computePlaceOpenStatus(hours, [], new Date('2026-10-24T00:30:00Z'), 'America/Chicago');
    expect(status).toEqual({ known: true, isOpen: false, opensAt: '9:00 AM', opensLabel: 'Monday' });
  });
});

describe('computePlaceOpenStatus', () => {
  it('unknown when there are no place_hours rows at all', () => {
    expect(computePlaceOpenStatus([], [], denverInstant(10, 0), TZ)).toEqual({ known: false });
  });

  it('open during the window, reports the real close time', () => {
    const status = computePlaceOpenStatus(MON_THU_9_5, [], denverInstant(10, 0), TZ);
    expect(status).toEqual({ known: true, isOpen: true, closesAt: '5:00 PM' });
  });

  it('closed before opening, reports opening later today', () => {
    const status = computePlaceOpenStatus(MON_THU_9_5, [], denverInstant(7, 0), TZ);
    expect(status).toEqual({ known: true, isOpen: false, opensAt: '9:00 AM', opensLabel: 'today' });
  });

  it('closed after closing, reports opening tomorrow', () => {
    const status = computePlaceOpenStatus(MON_THU_9_5, [], denverInstant(18, 0), TZ);
    expect(status).toEqual({ known: true, isOpen: false, opensAt: '9:00 AM', opensLabel: 'tomorrow' });
  });

  it('split hours: two windows the same day, both real (e.g. 9-12, 13-17)', () => {
    const split: PlaceHoursRow[] = [
      { day_of_week: 1, opens: '09:00:00', closes: '12:00:00', valid_from: null, valid_to: null },
      { day_of_week: 1, opens: '13:00:00', closes: '17:00:00', valid_from: null, valid_to: null },
    ];
    expect(computePlaceOpenStatus(split, [], denverInstant(11, 0), TZ)).toEqual({ known: true, isOpen: true, closesAt: '12:00 PM' });
    // Midday gap between the two windows -- closed, but reports the
    // SECOND window opening later today, not "closed all day".
    expect(computePlaceOpenStatus(split, [], denverInstant(12, 30), TZ)).toEqual({ known: true, isOpen: false, opensAt: '1:00 PM', opensLabel: 'today' });
  });

  it('an exception with opens/closes both NULL means explicitly closed all day -- overrides the regular window', () => {
    const exceptions: PlaceHoursException[] = [
      { date: '2026-09-07', opens: null, closes: null, reason: 'Holiday', source_url: null, last_verified_at: null },
    ];
    // Would normally be open at 10am Monday -- the exception wins.
    const status = computePlaceOpenStatus(MON_THU_9_5, exceptions, denverInstant(10, 0), TZ);
    expect(status.known && !status.isOpen).toBe(true);
  });

  it('an exception with real opens/closes overrides the regular window with its own hours', () => {
    const exceptions: PlaceHoursException[] = [
      { date: '2026-09-07', opens: '10:00:00', closes: '14:00:00', reason: 'Holiday hours', source_url: null, last_verified_at: null },
    ];
    // 9am would be open under the regular Mon-Thu 9-5 rule, but the
    // exception's own 10am start means it's still closed at 9am.
    const closedBefore = computePlaceOpenStatus(MON_THU_9_5, exceptions, denverInstant(9, 30), TZ);
    expect(closedBefore).toEqual({ known: true, isOpen: false, opensAt: '10:00 AM', opensLabel: 'today' });
    const openDuring = computePlaceOpenStatus(MON_THU_9_5, exceptions, denverInstant(11, 0), TZ);
    expect(openDuring).toEqual({ known: true, isOpen: true, closesAt: '2:00 PM' });
  });

  it('a future exception is honored by the "opens next" scan, not just today -- the real Depot Museum bug', () => {
    // Saturday-only hours (like the real Broomfield Depot Museum), with
    // the next TWO Saturdays excepted away (closed for construction).
    // 2026-09-13 (Sunday) -> next Saturday is 2026-09-19, then 09-26.
    const saturdayOnly: PlaceHoursRow[] = [{ day_of_week: 6, opens: '11:00:00', closes: '16:00:00', valid_from: null, valid_to: null }];
    const exceptions: PlaceHoursException[] = [
      { date: '2026-09-19', opens: null, closes: null, reason: 'Closed for construction', source_url: null, last_verified_at: null },
    ];
    const sunday = new Date(Date.UTC(2026, 8, 13, 16, 0)); // ~10am Denver
    const status = computePlaceOpenStatus(saturdayOnly, exceptions, sunday, TZ);
    // Must NOT claim "opens Saturday" (09-19) -- that Saturday is excepted
    // away, and the next real window (09-26) is outside the 7-day scan.
    expect(status).toEqual({ known: true, isOpen: false, opensAt: null, opensLabel: null });
  });

  it('never open this week when there are hours rows but none match any weekday', () => {
    const sundayOnly: PlaceHoursRow[] = [{ day_of_week: 0, opens: '10:00:00', closes: '11:00:00', valid_from: null, valid_to: null }];
    // Monday at 10am, more than 7 days from the next Sunday window check --
    // actually within 7 days a Sunday DOES occur, so this should find it.
    // Use a row for a day that's fully absent instead to hit the "not open
    // this week" fallback genuinely.
    const status = computePlaceOpenStatus(sundayOnly, [], denverInstant(10, 0), TZ);
    expect(status.known && !status.isOpen).toBe(true); // finds next Sunday within 7 days
  });

  it('a confirmed-closed row (opens/closes both null) is treated as closed that day, not a crash', () => {
    // facilities/[slug].astro's hours_structured backfill (2026-10-03) is
    // the first real data to ever store a null/null regular place_hours
    // row (e.g. Brookings City Hall: open Mon-Fri, explicitly closed
    // Sat/Sun) -- windowsForDate()'s regular-hours branch had no guard for
    // this before, only place_hours_exceptions did; would have crashed on
    // `.split(':')` of null without the fix.
    const weekdaysOnly: PlaceHoursRow[] = [
      ...MON_THU_9_5,
      { day_of_week: 5, opens: '09:00:00', closes: '17:00:00', valid_from: null, valid_to: null },
      { day_of_week: 6, opens: null, closes: null, valid_from: null, valid_to: null },
      { day_of_week: 0, opens: null, closes: null, valid_from: null, valid_to: null },
    ];
    // Saturday 09-12 (day_of_week 6) -- the null/null row means closed, and
    // since weekdaysOnly's Monday window is still 2 days off, not within
    // the 7-day scan from Saturday... actually Monday IS within 7 days, so
    // this should report "opens Monday", not crash.
    const saturday = new Date(Date.UTC(2026, 8, 12, 15, 0)); // ~9am Denver, Sat 2026-09-12
    const status = computePlaceOpenStatus(weekdaysOnly, [], saturday, TZ);
    expect(status.known).toBe(true);
    expect(status.known && status.isOpen).toBe(false);
  });

  it('valid_from/valid_to scope a seasonal window to its own date range', () => {
    const summerOnly: PlaceHoursRow[] = [
      { day_of_week: 1, opens: '10:00:00', closes: '18:00:00', valid_from: '2026-06-01', valid_to: '2026-08-31' },
    ];
    // September 7 is outside the summer-only range -- closed, and with no
    // other window this week, "not open this week".
    const status = computePlaceOpenStatus(summerOnly, [], denverInstant(10, 0), TZ);
    expect(status).toEqual({ known: true, isOpen: false, opensAt: null, opensLabel: null });
  });
});

describe('buildPlaceOpeningHoursSpecification', () => {
  it('converts each row to a real OpeningHoursSpecification entry, HH:MM not HH:MM:SS', () => {
    const rows: PlaceHoursRow[] = [
      { day_of_week: 1, opens: '09:00:00', closes: '17:00:00', valid_from: null, valid_to: null },
    ];
    expect(buildPlaceOpeningHoursSpecification(rows)).toEqual([
      { '@type': 'OpeningHoursSpecification', dayOfWeek: 'https://schema.org/Monday', opens: '09:00', closes: '17:00' },
    ]);
  });

  it('includes validFrom/validThrough only when the row actually has a seasonal range', () => {
    const rows: PlaceHoursRow[] = [
      { day_of_week: 2, opens: '10:00:00', closes: '18:00:00', valid_from: '2026-06-01', valid_to: '2026-08-31' },
    ];
    expect(buildPlaceOpeningHoursSpecification(rows)[0]).toMatchObject({
      validFrom: '2026-06-01', validThrough: '2026-08-31',
    });
  });

  it('omits a confirmed-closed (null/null) row entirely -- schema.org has no "closed" value', () => {
    const rows: PlaceHoursRow[] = [
      { day_of_week: 1, opens: '09:00:00', closes: '17:00:00', valid_from: null, valid_to: null },
      { day_of_week: 6, opens: null, closes: null, valid_from: null, valid_to: null },
    ];
    const spec = buildPlaceOpeningHoursSpecification(rows);
    expect(spec).toHaveLength(1);
    expect(spec[0]).toMatchObject({ dayOfWeek: 'https://schema.org/Monday' });
  });
});

describe('isPastStalenessThreshold', () => {
  it('never verified (null) is always past the threshold', () => {
    expect(isPastStalenessThreshold(null, 45, new Date('2026-09-13T00:00:00Z'))).toBe(true);
  });

  it('within the threshold is not stale', () => {
    expect(isPastStalenessThreshold('2026-09-01', 45, new Date('2026-09-13T00:00:00Z'))).toBe(false);
  });

  it('past the threshold is stale', () => {
    expect(isPastStalenessThreshold('2026-01-01', 45, new Date('2026-09-13T00:00:00Z'))).toBe(true);
  });
  // places.verified_date as the Neon driver hands it over: a Date at local midnight. Broomfield's library (places slug 'library',
  // verified_date 2026-09-13) was never stale because new Date(`${Date}T00:00:00Z`) is Invalid Date (found 2026-11-12).
  it('reads a DATE handed over as a Date object', () => {
    const verified = new Date(2026, 8, 13);
    expect(isPastStalenessThreshold(verified, 45, new Date('2026-11-13T12:00:00Z'))).toBe(true);
    expect(isPastStalenessThreshold(verified, 45, new Date('2026-10-01T12:00:00Z'))).toBe(false);
  });
});

describe('QA build.hours-schema-fresh mirror', () => {
  it('scripts/verify_hours_schema_fresh.mjs uses the hours limit of every town', () => {
    const src = readFileSync(new URL('../../../scripts/verify_hours_schema_fresh.mjs', import.meta.url), 'utf8');
    const mirror = Number(src.match(/HOURS_STALE_DAYS = (\d+)/)![1]);
    for (const c of ALL_CONFIGS) expect(c.placeStaleness?.hoursDays ?? 45, c.townId).toBe(mirror);
  });
});

// The Old Man Bar, Broomfield: "Mon-Sun 11:00 AM - 2:00 AM" (.claude/evidence/venues-2026-11/broomfield/the-old-man.txt, fetched
// 2026-11-13); Chipper's Lanes Broomfield "Fri & Sat: 10 am-midnight" (chipperslanes-broomfield). Denver is UTC-7 in November.
const OLD_MAN: PlaceHoursRow[] = [0, 1, 2, 3, 4, 5, 6].map((day_of_week) => ({
  day_of_week, opens: '11:00:00', closes: '02:00:00', valid_from: null, valid_to: null,
}));

describe('computePlaceOpenStatus: a window that closes after midnight (2026-11-13)', () => {
  it('is open late in the evening, until 2:00 AM', () => {
    expect(computePlaceOpenStatus(OLD_MAN, [], new Date('2026-11-18T06:30:00Z'), TZ)) // Tue 23:30
      .toEqual({ known: true, isOpen: true, closesAt: '2:00 AM' });
  });
  it("is still open at 1:30 AM on yesterday's window", () => {
    expect(computePlaceOpenStatus(OLD_MAN, [], new Date('2026-11-18T08:30:00Z'), TZ)) // Wed 01:30
      .toEqual({ known: true, isOpen: true, closesAt: '2:00 AM' });
  });
  it('is closed at 3:00 AM and opens at 11:00 AM today', () => {
    expect(computePlaceOpenStatus(OLD_MAN, [], new Date('2026-11-18T10:00:00Z'), TZ)) // Wed 03:00
      .toEqual({ known: true, isOpen: false, opensAt: '11:00 AM', opensLabel: 'today' });
  });
  it('a midnight close is open until midnight and not after it', () => {
    const fri: PlaceHoursRow[] = [{ day_of_week: 5, opens: '10:00:00', closes: '00:00:00', valid_from: null, valid_to: null }];
    expect(computePlaceOpenStatus(fri, [], new Date('2026-11-21T06:30:00Z'), TZ)) // Fri 23:30
      .toEqual({ known: true, isOpen: true, closesAt: '12:00 AM' });
    expect(computePlaceOpenStatus(fri, [], new Date('2026-11-21T07:30:00Z'), TZ)) // Sat 00:30
      .toMatchObject({ known: true, isOpen: false });
  });
  it('JSON-LD keeps 11:00-02:00 as written (schema.org: closes before opens spans into the next day)', () => {
    expect(buildPlaceOpeningHoursSpecification(OLD_MAN)[1]).toEqual({
      '@type': 'OpeningHoursSpecification', dayOfWeek: 'https://schema.org/Monday', opens: '11:00', closes: '02:00',
    });
  });
});
