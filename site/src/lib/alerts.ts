/** Shared "is this alert still in force?" logic -- the ONE place every alert
 *  surface (status strip, Right Now, /today, homepage lead, Closure Watch,
 *  CityStatus) goes through, so none of them can show an expired alert.
 *
 *  Rule (Time/alerts handoff, Phase 1): an alert is shown only while its end
 *  is in the future. End = events.ends_at (NWS: `ends`, else `expires`);
 *  county_alert rows (CivicPlus alert center, a re-post of NWS text) have
 *  ends_at NULL, so the end is parsed out of the title/body text ("UNTIL 2 AM
 *  CDT TUESDAY"); if that fails too, the alert is hidden 24 h after it
 *  started (owner decision 2026-10-20 -- `sent` is not stored, `starts_at` is
 *  the closest stand-in).
 *
 *  Pure functions of (row, now): no Date.now(), no machine timezone -- the
 *  build machine is UTC in CI and Europe/Stockholm on the owner's laptop, and
 *  neither may leak into a result.
 */

export interface AlertRow {
  /** events.ends_at (ISO) -- authoritative when present. */
  ends_at: string | null;
  /** events.starts_at, else the alert story's occurs_at (ISO). */
  starts_at: string | null;
  /** Raw alert headline and, when available, the raw body text. */
  title: string;
  body?: string | null;
  /** events.source ('nws_alert' | 'county_alert') and raw_data.category. */
  source?: string | null;
  category?: string | null;
}

/** county_alert rows in this category are CivicPlus re-posts of NWS products
 *  (often for a whole multi-state area -- the "Iowa" freeze warning on
 *  Brookings). nws_alert already carries the real, scoped record, so they are
 *  never an alert surface (owner decision 2026-10-20; accepted cost: the few
 *  short NWS products our 6-hourly poll misses). */
export function isCountyWeatherRepost(row: AlertRow): boolean {
  return row.source === 'county_alert' && row.category === 'Hazardous Weather Alerts';
}

/** A county_alert is only ever a *current* notice. Any county_alert (e.g. the
 *  2022-23 road-work posts) older than the no-end TTL is excluded outright,
 *  whatever its text says -- a parsed "UNTIL ..." must not resurrect it. */
export function isStaleCountyNotice(row: AlertRow, now: Date): boolean {
  if (row.source !== 'county_alert' || !row.starts_at) return false;
  return now.getTime() - new Date(row.starts_at).getTime() > ALERT_NO_END_TTL_MS;
}

export const ALERT_NO_END_TTL_MS = 24 * 3_600_000;

/** Fixed UTC offsets (hours) for the US zone abbreviations NWS text uses. */
const TZ_OFFSET: Record<string, number> = {
  EST: -5, EDT: -4, CST: -6, CDT: -5, MST: -7, MDT: -6, PST: -8, PDT: -7,
};
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

/** Offset (hours) of an IANA zone at an instant, via Intl -- never the
 *  machine's own zone. */
function zoneOffsetHours(timezone: string, at: Date): number {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(at);
  const g = (t: string) => Number(p.find((x) => x.type === t)!.value);
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 3_600_000 * 4) / 4;
}

/** Pulls an end instant out of NWS-style text. `fallbackTz` is only used when
 *  the text carries no zone abbreviation. Returns null when no end clause is
 *  found or the result is implausible (before the start, or >10 days out). */
export function parseAlertEnd(text: string, startsAt: Date, fallbackTz: string): Date | null {
  const t = text.toUpperCase().replace(/\s+/g, ' ');
  const clause = /(?:\bUNTIL\b|\bTHROUGH\b|\bTO\b|\s-\s|\s–\s)\s*(MIDNIGHT|NOON|(\d{1,2})(?::?(\d{2}))?\s*([AP])\.?M\.?)\s*([ECMP][SD]T)?/g;
  let last: RegExpExecArray | null = null;
  for (let m = clause.exec(t); m; m = clause.exec(t)) last = m;
  if (!last) return null;

  const [whole, timeWord, hStr, minStr, ap, zone] = last;
  let hour: number; let minute = 0; let midnightNextDay = false;
  if (timeWord === 'MIDNIGHT') { hour = 0; midnightNextDay = true; }
  else if (timeWord === 'NOON') hour = 12;
  else {
    hour = Number(hStr) % 12 + (ap === 'P' ? 12 : 0);
    minute = minStr ? Number(minStr) : 0;
  }

  const offset = zone ? TZ_OFFSET[zone] : zoneOffsetHours(fallbackTz, startsAt);
  const shifted = new Date(startsAt.getTime() + offset * 3_600_000);
  let y = shifted.getUTCFullYear(), mo = shifted.getUTCMonth(), d = shifted.getUTCDate();
  const startWeekday = shifted.getUTCDay();

  const tail = t.slice(last.index + whole.length, last.index + whole.length + 45);
  const explicit = tail.match(/^\s*(?:(SUNDAY|MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY),?\s*)?(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\.?\s*(\d{1,2})(?:,?\s*(\d{4}))?/);
  const weekday = tail.match(/^\s*(?:ON\s+)?(SUNDAY|MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY)/);
  const sameDay = /^\s*(?:THIS\s+(?:AFTERNOON|EVENING|MORNING)|TONIGHT|TODAY)/.test(tail);
  const dated = t.slice(0, last.index).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?!.*\d{1,2}\/\d{1,2}\/\d{4})/);

  let needsRoll = false;
  if (explicit) {
    mo = MONTHS.indexOf(explicit[2]); d = Number(explicit[3]);
    if (explicit[4]) y = Number(explicit[4]);
  } else if (weekday) {
    const target = WEEKDAYS.indexOf(weekday[1]);
    let delta = (target - startWeekday + 7) % 7;
    const candidate = Date.UTC(y, mo, d + delta, hour, minute) - offset * 3_600_000;
    if (delta === 0 && candidate <= startsAt.getTime()) delta = 7;
    d += delta;
  } else if (dated && !sameDay) {
    mo = Number(dated[1]) - 1; d = Number(dated[2]); y = Number(dated[3]);
    needsRoll = true;
  } else {
    needsRoll = true;
  }
  if (midnightNextDay) d += 1;

  let end = Date.UTC(y, mo, d, hour, minute) - offset * 3_600_000;
  if (needsRoll && end <= startsAt.getTime()) end += 86_400_000;
  if (end <= startsAt.getTime() || end - startsAt.getTime() > 10 * 86_400_000) return null;
  return new Date(end);
}

/** The instant this alert stops being in force. Never null: the 24 h rule is
 *  the floor. Returns null only when the row has no usable start at all, in
 *  which case it is not shown (callers treat null as "expired"). */
export function alertEndsAt(row: AlertRow, timezone: string): Date | null {
  if (row.ends_at) {
    const e = new Date(row.ends_at);
    if (!Number.isNaN(e.getTime())) return e;
  }
  if (!row.starts_at) return null;
  const start = new Date(row.starts_at);
  if (Number.isNaN(start.getTime())) return null;
  const parsed = parseAlertEnd(row.title, start, timezone)
    ?? (row.body ? parseAlertEnd(row.body.slice(0, 700), start, timezone) : null);
  return parsed ?? new Date(start.getTime() + ALERT_NO_END_TTL_MS);
}

export function isAlertActive(row: AlertRow, now: Date, timezone: string): boolean {
  if (isCountyWeatherRepost(row) || isStaleCountyNotice(row, now)) return false;
  const end = alertEndsAt(row, timezone);
  return end !== null && end.getTime() > now.getTime();
}

/** Filters any list of alert-shaped rows to those still in force, keeping
 *  order, and attaches the resolved `endsAt`. */
export function activeAlerts<T extends AlertRow>(
  rows: T[], now: Date, timezone: string,
): (T & { endsAt: Date })[] {
  const out: (T & { endsAt: Date })[] = [];
  for (const row of rows) {
    if (isCountyWeatherRepost(row) || isStaleCountyNotice(row, now)) continue;
    const endsAt = alertEndsAt(row, timezone);
    if (endsAt && endsAt.getTime() > now.getTime()) out.push({ ...row, endsAt });
  }
  return out;
}

/** "until 9 AM Sat Oct 24" in the town's own zone (weekday + date always, so
 *  a Tuesday reader can't mistake Saturday's end for today's). */
export function formatAlertUntil(end: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true,
    weekday: 'short', month: 'short', day: 'numeric',
  }).formatToParts(end);
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  const time = g('minute') === '00' ? `${g('hour')} ${g('dayPeriod')}` : `${g('hour')}:${g('minute')} ${g('dayPeriod')}`;
  return `until ${time} ${g('weekday')} ${g('month')} ${g('day')}`;
}
