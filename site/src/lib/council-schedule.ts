/** Brookings City Council's standing meeting schedule, as published by the city
 *  (https://www.cityofbrookings-sd.gov/861/City-Council-Meeting-Information, read 2026-10-23):
 *    - regular action meetings: second and fourth Tuesday of each month, 6:00 p.m.
 *    - study sessions: third Tuesday of each month, 6:00 p.m., not scheduled for June, July or August
 *      ("exceptions as needed").
 *  These are EXPECTED dates only: meetings move (the council has met on a Thursday, off-site, and for
 *  special events), so the page shows them as "expected" and prefers the confirmed rows from the
 *  meetings table (Legistar). Pure functions on UTC day numbers; no dates are stored anywhere. */

const DAY = 86_400_000;
const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);

export type MeetingKind = 'regular' | 'study';
export interface ExpectedMeeting { date: number; kind: MeetingKind }

/** The nth (1-based) Tuesday of a month as a UTC day number. */
export function nthTuesday(y: number, m: number, n: number): number {
  const first = utc(y, m, 1);
  const offset = (2 - new Date(first).getUTCDay() + 7) % 7;
  return first + offset * DAY + (n - 1) * 7 * DAY;
}

/** Expected meetings in [from, from + days], oldest first. */
export function expectedMeetings(from: number, days: number): ExpectedMeeting[] {
  const out: ExpectedMeeting[] = [];
  const end = from + days * DAY;
  const start = new Date(from);
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth() + 1;
  for (let i = 0; i < 14; i++) {
    const candidates: ExpectedMeeting[] = [
      { date: nthTuesday(y, m, 2), kind: 'regular' },
      { date: nthTuesday(y, m, 4), kind: 'regular' },
    ];
    if (m < 6 || m > 8) candidates.push({ date: nthTuesday(y, m, 3), kind: 'study' });
    for (const c of candidates) if (c.date >= from && c.date <= end) out.push(c);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    if (utc(y, m, 1) > end) break;
  }
  return out.sort((a, b) => a.date - b.date);
}
