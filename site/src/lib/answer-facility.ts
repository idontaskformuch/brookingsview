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
/** A week reads Monday first: Saturday and Sunday are "Sat–Sun", never "Sun, Sat". */
const mondayFirst = (d: number) => (d + 6) % 7;
const sortedDays = (h: FacilityHours) => [...new Set(h.days)].sort((a, b) => mondayFirst(a) - mondayFirst(b));
const isRun = (d: number[]) => d.length > 1 && d.every((x, i) => i === 0 || mondayFirst(x) === mondayFirst(d[i - 1]) + 1);

type Clock = { h: number; m: number; pm: boolean; word?: string };
/** "13:00" / "13:00:00" -> 1 p.m.; a word the source uses instead of a time ("sunrise") stays that word. */
function clock(hhmm: string): Clock {
  if (!/^\d{1,2}:\d{2}/.test(hhmm)) return { h: 0, m: 0, pm: false, word: hhmm };
  const [h, m] = hhmm.split(':').map(Number);
  return { h: h % 12 || 12, m: m || 0, pm: h >= 12 };
}
const hm = (c: Clock) => (c.word ?? (c.m ? `${c.h}:${String(c.m).padStart(2, '0')}` : String(c.h)));
/** The closing time is on the next day (11:00 to 02:00). */
const pastMidnight = (from: string, to: string) => /^\d/.test(from) && /^\d/.test(to) && to.slice(0, 5) <= from.slice(0, 5);
/** Open round the clock: 00:00 to 23:59, 24:00 or 00:00. */
const allDay = (from: string, to: string) => from.slice(0, 5) === '00:00' && ['23:59', '24:00', '00:00'].includes(to.slice(0, 5));

/** "1 to 5 p.m." / "8 a.m. to 5 p.m.": the p.m./a.m. once when both times are in the same half of the day. */
export function timesLong(from: string, to: string): string {
  const a = clock(from), b = clock(to);
  const mer = (c: { pm: boolean }) => (c.pm ? 'p.m.' : 'a.m.');
  return a.pm === b.pm && !pastMidnight(from, to) ? `${hm(a)} to ${hm(b)} ${mer(b)}` : `${hm(a)} ${mer(a)} to ${hm(b)} ${mer(b)}`;
}
/** "1–5 PM" / "8 AM–5 PM" (us); "1–5pm" / "8am–5pm" (gb, the site's own clock style); "24 hours" round the clock; a word ("sunrise") as is. */
export function timesCompact(from: string, to: string, country: 'us' | 'gb' = 'us'): string {
  if (allDay(from, to)) return '24 hours';
  const a = clock(from), b = clock(to);
  const mer = (c: Clock) => (c.word ? '' : country === 'gb' ? (c.pm ? 'pm' : 'am') : (c.pm ? ' PM' : ' AM'));
  // 12:00 is "noon" and 00:00 "midnight", never "12 PM" / "12 AM" (owner order 2026-11-26 (15) D).
  const named = (c: Clock) => (!c.word && c.h === 12 && c.m === 0 ? (c.pm ? 'noon' : 'midnight') : null);
  const one = (c: Clock) => named(c) ?? `${hm(c)}${mer(c)}`;
  if (!a.word && !b.word && !named(a) && !named(b) && a.pm === b.pm && !pastMidnight(from, to)) return `${hm(a)}–${hm(b)}${mer(b)}`;
  return `${one(a)}–${one(b)}`;
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
/** A group's days, Monday first, with each run of days in a row as a range: "Mon–Thu, Sat" (owner order 2026-11-26 (16) 3), "Wed, Sat". */
export function daysCompact(d: number[]): string {
  const runs: number[][] = [];
  for (const x of d) {
    const last = runs[runs.length - 1];
    if (last && mondayFirst(x) === mondayFirst(last[last.length - 1]) + 1) last.push(x); else runs.push([x]);
  }
  return runs.map((r) => (r.length > 1 ? `${DAY_SHORT[r[0]]}–${DAY_SHORT[r[r.length - 1]]}` : DAY_SHORT[r[0]])).join(', ');
}

/** "Wed 1–5 PM & Sat 8 AM–5 PM" ("Mon–Fri 9 AM–5 PM" for a run of days, "daily" for all seven). */
export function hoursCompact(hours: FacilityHours[], country: 'us' | 'gb' = 'us', join = ' & '): string {
  return hours.map((h) => {
    const d = sortedDays(h);
    const days = d.length === 7 ? 'daily' : daysCompact(d);
    return `${days} ${timesCompact(h.from, h.to, country)}`;
  }).join(join);
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

/** What the title promises: "Hours & Rules" where the page has a rules part, otherwise only what the page really has ("Hours & Address",
 *  "Address", "Hours", or "Phone" when it has neither). */
export function titleFacts(f: AnswerFacility): string[] {
  if (f.rules) return ['Hours', 'Rules'];
  const hours = (f.hours?.length ?? 0) > 0 || !!f.hoursAsText;
  const parts = [hours ? 'Hours' : null, f.street ? 'Address' : null].filter((p): p is string => !!p);
  return parts.length > 0 ? parts : f.phone ? ['Phone'] : [];
}

/** "<Town> <name>: Hours & Rules (<year>)". A name that already says the town is not prefixed again ("Brookings Public Library"), and a
 *  name's leading "The" goes after the town ("Glasgow Mitchell Library"). Over TITLE_MAX it is shortened in the owner's order (2026-11-26
 *  (15)) until it fits: (a) the name's parenthesis, (b) the year, (c) the second fact (" & Address", " & Rules"); then, as a last resort,
 *  the town prefix. The shortest is kept when none fits. */
export function facilityTitle(f: AnswerFacility, town: string, year: number | string): string {
  const named = new RegExp(`\\b${town.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(f.name);
  const noParen = f.name.replace(/\s*\([^)]*\)/g, '').trim();
  const prefixed = (n: string) => (named ? n : `${town} ${n.replace(/^the\s+/i, '')}`);
  const facts = titleFacts(f);
  const one = Math.min(facts.length, 1);
  const t = (b: string, n: number, withYear: boolean) => `${b}${n > 0 ? `: ${facts.slice(0, n).join(' & ')}` : ''}${withYear ? ` (${year})` : ''}`;
  const variants = [
    t(prefixed(f.name), facts.length, true),
    t(prefixed(noParen), facts.length, true), // (a)
    t(prefixed(noParen), facts.length, false), // (b)
    t(prefixed(noParen), one, false), // (c)
    ...(named ? [] : [t(noParen, one, false)]), // last resort: no town prefix
  ];
  return variants.find((v) => v.length <= TITLE_MAX) ?? [...variants].sort((a, b) => a.length - b.length)[0];
}

/** The meta description (see the module comment). Parts with no data are left out; the last sentence goes first, then "Next closed". */
export function facilityMeta(f: AnswerFacility, today: string, country: 'us' | 'gb' = 'us'): string {
  const street = f.street ? abbreviateStreet(f.street) : '';
  // Who and cost: "Free for Broomfield residents at <street>." Without a who (a facility page), the name and street, then the cost alone.
  const first = f.who
    ? endSentence(`${f.cost ? `${f.cost.label} for ${f.who.label}` : f.who.label}${street ? ` at ${street}` : ''}`)
    // A street that ends in its own full stop ("47532 30th St.") gets no second one.
    : `${endSentence(street ? `${f.name}, ${street}` : f.name)}${f.cost ? ` ${f.cost.label}.` : ''}`;
  const open = f.hours?.length ? `Open ${hoursCompact(f.hours, country, f.hoursJoin)}.` : '';
  const nc = nextClosed(f.closed, today);
  const next = nc ? `Next closed: ${shortDate(nc, country)}.` : '';
  const tails = [f.rulesLine, ...(f.tailOptions ?? [])].filter((t): t is string => !!t);
  const join = (...p: string[]) => p.filter(Boolean).join(' ');
  const options = [...tails.map((t) => join(first, open, next, t)), join(first, open, next), join(first, open), first];
  return options.find((s) => s.length <= META_MAX) ?? options[options.length - 1];
}
