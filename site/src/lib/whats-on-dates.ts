/** Date labels for What's On (Q3 2026-10-23): the list runs a year and a half ahead ("Jul 17" next to "Nov 17" with no year looked like
 *  one season), so the YEAR is shown whenever the date is not in the current local year. Pure: `now` and the zone are arguments. */
function localYear(d: Date, timeZone: string): number {
  return Number(new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone }).format(d));
}

/** "Tue, Oct 27" this year, "Sun, Jul 17, 2027" in another year. `withWeekday` false gives "Oct 27" / "Jul 17, 2027". */
export function showDate(iso: string, timeZone: string, now: Date, withWeekday = true): string {
  const d = new Date(iso);
  const otherYear = localYear(d, timeZone) !== localYear(now, timeZone);
  return d.toLocaleDateString('en-US', {
    ...(withWeekday ? { weekday: 'short' as const } : {}), month: 'short', day: 'numeric', ...(otherYear ? { year: 'numeric' as const } : {}), timeZone,
  });
}

function sameLocalDay(a: string, b: string, timeZone: string): boolean {
  const f = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(iso));
  return f(a) === f(b);
}

/** Label for a collapsed run of the same production: "6 dates, Sat, Nov 14 – Sun, Nov 15" or, when every date is the same day,
 *  "2 shows on Tue, Oct 27" (the old label printed "Tue, Oct 27 – Tue, Oct 27"). null for a single date. */
export function runLabel(runSize: number, firstIso: string, lastIso: string, timeZone: string, now: Date): string | null {
  if (runSize <= 1) return null;
  if (sameLocalDay(firstIso, lastIso, timeZone)) return `${runSize} shows on ${showDate(firstIso, timeZone, now)}`;
  return `${runSize} dates, ${showDate(firstIso, timeZone, now)} – ${showDate(lastIso, timeZone, now)}`;
}
