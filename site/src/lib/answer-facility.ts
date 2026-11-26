/** A facility page's title, meta description, fact rows and FAQ sentence from ONE set of fields (config/city-answers/types.ts AnswerFacility;
 *  owner order 2026-11-26 (11)). Pure: the town's today and the build year come in as arguments. Nothing is read out of free text, so the
 *  page and its meta cannot differ, and a missing field leaves its part out (no placeholder, never "hours unavailable").
 *
 *    title  "<Town> <name>: Hours & Rules (<year>)"  -- "Rules" only where the page has a rules part, else "Hours & Address"; at most
 *           TITLE_MAX characters (" & Rules" / " & Address" is dropped when it would be over)
 *    meta   "<Cost> for <who> at <street>. Open <compact hours>. [Next closed: <Day Mon D>.] <what is only on the page>."  at most
 *           META_MAX characters: the last sentence goes first, then "Next closed"
 *    "Next closed" is the first closed day from today on, within NEXT_CLOSED_DAYS; a past day is never shown. */
import type { AnswerFacility, FacilityHours, Inline } from '../config/city-answers/types';

export const TITLE_MAX = 60;
export const META_MAX = 155;
export const NEXT_CLOSED_DAYS = 30;

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Street words shortened in the meta ("2990 W 124th Avenue" -> "2990 W 124th Ave"). */
const STREET_WORD: Record<string, string> = { Avenue: 'Ave', Street: 'St', Road: 'Rd', Boulevard: 'Blvd', Drive: 'Dr', Lane: 'Ln', Court: 'Ct', Parkway: 'Pkwy' };

const dayNum = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`) / 86_400_000;
const sortedDays = (h: FacilityHours) => [...new Set(h.days)].sort((a, b) => a - b);
const isRun = (d: number[]) => d.length > 1 && d.every((x, i) => i === 0 || x === d[i - 1] + 1);

function clock(hhmm: string): { h: number; m: number; pm: boolean } {
  const [h, m] = hhmm.split(':').map(Number);
  return { h: h % 12 || 12, m: m || 0, pm: h >= 12 };
}
const hm = (c: { h: number; m: number }) => (c.m ? `${c.h}:${String(c.m).padStart(2, '0')}` : String(c.h));

/** "1 to 5 p.m." / "8 a.m. to 5 p.m.": the p.m./a.m. once when both times are in the same half of the day. */
export function timesLong(from: string, to: string): string {
  const a = clock(from), b = clock(to);
  const mer = (c: { pm: boolean }) => (c.pm ? 'p.m.' : 'a.m.');
  return a.pm === b.pm ? `${hm(a)} to ${hm(b)} ${mer(b)}` : `${hm(a)} ${mer(a)} to ${hm(b)} ${mer(b)}`;
}
/** "1–5 PM" / "8 AM–5 PM". */
export function timesCompact(from: string, to: string): string {
  const a = clock(from), b = clock(to);
  const mer = (c: { pm: boolean }) => (c.pm ? 'PM' : 'AM');
  return a.pm === b.pm ? `${hm(a)}–${hm(b)} ${mer(b)}` : `${hm(a)} ${mer(a)}–${hm(b)} ${mer(b)}`;
}

/** The text with one full stop at the end ("5 p.m." already has one: never "5 p.m.."). */
const endSentence = (s: string) => (s.endsWith('.') ? s : `${s}.`);

function listWords(parts: string[]): string {
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** "Wednesdays 1 to 5 p.m. and Saturdays 8 a.m. to 5 p.m." ("Monday to Friday 9 a.m. to 5 p.m." for a run of days). */
export function hoursLong(hours: FacilityHours[]): string {
  return listWords(hours.map((h) => {
    const d = sortedDays(h);
    const days = isRun(d) ? `${DAY_LONG[d[0]]} to ${DAY_LONG[d[d.length - 1]]}` : listWords(d.map((x) => `${DAY_LONG[x]}s`));
    return `${days} ${timesLong(h.from, h.to)}`;
  }));
}
/** "Wed 1–5 PM & Sat 8 AM–5 PM" ("Mon–Fri 9 AM–5 PM" for a run of days). */
export function hoursCompact(hours: FacilityHours[]): string {
  return hours.map((h) => {
    const d = sortedDays(h);
    const days = isRun(d) ? `${DAY_SHORT[d[0]]}–${DAY_SHORT[d[d.length - 1]]}` : d.map((x) => DAY_SHORT[x]).join(', ');
    return `${days} ${timesCompact(h.from, h.to)}`;
  }).join(' & ');
}

/** "Sat Nov 28" (us) / "Sat 28 Nov" (gb), from the date alone (no time zone: the date is the town's own). */
export function shortDate(ymd: string, country: 'us' | 'gb' = 'us'): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  const wd = DAY_SHORT[d.getUTCDay()], mon = MONTH_SHORT[d.getUTCMonth()], day = d.getUTCDate();
  return country === 'gb' ? `${wd} ${day} ${mon}` : `${wd} ${mon} ${day}`;
}

/** The first closed day on or after `today` and at most `days` days away; null when there is none (a passed day is never returned). */
export function nextClosed(closed: { date: string }[] | undefined, today: string, days = NEXT_CLOSED_DAYS): string | null {
  const next = (closed ?? []).map((c) => c.date).filter((d) => d >= today).sort()[0];
  return next && dayNum(next) - dayNum(today) <= days ? next : null;
}

export const abbreviateStreet = (street: string): string => street.replace(/\b(Avenue|Street|Road|Boulevard|Drive|Lane|Court|Parkway)\b/g, (w) => STREET_WORD[w]);

/** The page's fact rows (Where, Hours, Who, Cost), as inline text for AnswerBlocks' `facts`. */
export function facilityRows(f: AnswerFacility): { label: Inline; value: Inline }[] {
  const rows: { label: Inline; value: Inline }[] = [{ label: 'Where', value: `**${f.place}${f.street ? `, ${f.street}` : ''}**${f.within ? `, within ${f.within}` : ''}.` }];
  if (f.hours?.length) rows.push({ label: 'Hours', value: endSentence(`${hoursLong(f.hours)}${f.hoursNote ? `, ${f.hoursNote}` : ''}`) });
  if (f.who) rows.push({ label: 'Who', value: `${f.who.label}${f.who.only ? ' only' : ''}${f.who.detail ? `, ${f.who.detail}` : '.'}` });
  if (f.cost) rows.push({ label: 'Cost', value: `${f.cost.label}.${f.cost.detail ? ` ${f.cost.detail}` : ''}` });
  return rows;
}

/** The FAQ sentence: the lead, the place and address, the hours (all from the fields). */
export function facilityFaq(f: AnswerFacility): string {
  const hours = f.hours?.length ? `, ${hoursLong(f.hours)}` : '';
  return endSentence(`${f.faqLead ?? f.name} at the ${f.place}${f.street ? `, ${f.street}` : ''}${hours}`);
}

/** "<Town> <name>: Hours & Rules (<year>)"; " & Rules" (" & Address") dropped when the title would be over TITLE_MAX. */
export function facilityTitle(f: AnswerFacility, town: string, year: number | string): string {
  const base = `${town} ${f.name}`;
  const variants = [`${base}: Hours & ${f.rules ? 'Rules' : 'Address'} (${year})`, `${base}: Hours (${year})`];
  return variants.find((t) => t.length <= TITLE_MAX) ?? variants[variants.length - 1];
}

/** The meta description (see the module comment). Parts with no data are left out; the last sentence goes first, then "Next closed". */
export function facilityMeta(f: AnswerFacility, today: string, country: 'us' | 'gb' = 'us'): string {
  const whoCost = f.cost && f.who ? `${f.cost.label} for ${f.who.label}` : (f.cost?.label ?? f.who?.label ?? '');
  const street = f.street ? abbreviateStreet(f.street) : '';
  const first = whoCost ? `${whoCost}${street ? ` at ${street}` : ''}.` : (street ? `${f.name}, ${street}.` : `${f.name}.`);
  const open = f.hours?.length ? `Open ${hoursCompact(f.hours)}.` : '';
  const nc = nextClosed(f.closed, today);
  const next = nc ? `Next closed: ${shortDate(nc, country)}.` : '';
  const tail = f.rulesLine ?? '';
  const join = (...p: string[]) => p.filter(Boolean).join(' ');
  const options = [join(first, open, next, tail), join(first, open, next), join(first, open)];
  return options.find((s) => s.length <= META_MAX) ?? options[options.length - 1];
}
