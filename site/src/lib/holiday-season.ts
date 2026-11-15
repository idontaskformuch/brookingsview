/** Day by day on a holiday page that spans a season (/christmas/ in Glasgow: Christmas Eve to the last New Year bank holiday).
 *  Owner 2026-11-14 (.claude/specs/glasgow-christmas-2026.md): one standing page with an anchored section per day, no day URLs;
 *  which days are bank holidays comes from GOV.UK's bank-holidays.json (config/holiday-pages/gb/bank-holidays-scotland.json),
 *  nothing is hard-coded. A substitute day gives two sections: the calendar day ("Boxing Day · bank holiday observed Mon 28 Dec")
 *  and the day off itself. Pure: no clock, no model text. */
import { formatClock, formatEventDay, listWords, localIso, type ConfirmedEvent, type ConfirmedFact, type HolidayPageData } from './holiday-page';
import type { PopDay, PopRow } from './pop-days';

/** One row of GOV.UK's bank-holidays.json, as published. */
export interface BankHoliday { title: string; date: string; notes: string }

/** A day that is not a bank holiday but has a name of its own (Christmas Eve, Hogmanay): month-day and the name; `hero` when the
 *  hero counts down to it. */
export interface NamedDay { mmdd: string; name: string; hero?: boolean }

export interface SeasonDay {
  /** YYYY-MM-DD */
  date: string;
  /** Fragment id: "dec-24". */
  anchor: string;
  /** "Thu 24 Dec" */
  heading: string;
  /** "Christmas Eve", "Christmas Day · bank holiday", "Boxing Day · bank holiday observed Mon 28 Dec". */
  label: string;
  /** A bank holiday (the day off itself), or a named evening people plan around (Hogmanay): the hero counts down to these. */
  hero: boolean;
  /** The name the hero uses ("Christmas Day", "Boxing Day bank holiday"). */
  name: string;
}

/** The day a substitute stands in for, by GOV.UK's title (month-day of the same year as the substitute). */
const NOMINAL: Record<string, string> = { 'Christmas Day': '12-25', 'Boxing Day': '12-26', 'New Year’s Day': '01-01', '2nd January': '01-02' };
/** GOV.UK writes "2nd January"; the page says "2 January" (owner 2026-11-14). */
const DISPLAY: Record<string, string> = { '2nd January': '2 January' };
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const display = (title: string) => DISPLAY[title] ?? title;
const anchorOf = (date: string) => `${MONTHS[Number(date.slice(5, 7)) - 1]}-${date.slice(8, 10)}`;

/** The season around `year`'s Christmas: 20 Dec to 10 Jan of the next year (inclusive). */
export function seasonRange(year: number): { first: string; last: string } {
  return { first: `${year}-12-20`, last: `${year + 1}-01-10` };
}

/** The bank holidays of the season, in date order. */
export function seasonBankHolidays(all: BankHoliday[], year: number): BankHoliday[] {
  const { first, last } = seasonRange(year);
  return all.filter((b) => b.date >= first && b.date <= last).sort((a, b) => a.date.localeCompare(b.date));
}

/** The last bank holiday of the season (YYYY-MM-DD), or null when the data has none for that year. */
export function lastSeasonBankHoliday(all: BankHoliday[], year: number): string | null {
  const s = seasonBankHolidays(all, year);
  return s.length ? s[s.length - 1].date : null;
}

/** The sections of the season, in date order: every bank holiday, the calendar day of each substitute, and the named days. */
export function seasonDays(all: BankHoliday[], year: number, named: NamedDay[]): SeasonDay[] {
  const { first, last } = seasonRange(year);
  const byDate = new Map<string, SeasonDay>();
  const put = (date: string, label: string, hero: boolean, name: string) => {
    if (date < first || date > last || byDate.has(date)) return;
    byDate.set(date, { date, anchor: anchorOf(date), heading: formatEventDay(date, 'en-GB'), label, hero, name });
  };
  for (const b of seasonBankHolidays(all, year)) {
    const name = display(b.title);
    if (b.notes === 'Substitute day' && NOMINAL[b.title]) {
      put(`${b.date.slice(0, 4)}-${NOMINAL[b.title]}`, `${name} · bank holiday observed ${formatEventDay(b.date, 'en-GB')}`, false, name);
      put(b.date, `${name} bank holiday · substitute day`, true, `${name} bank holiday`);
    } else {
      put(b.date, `${name} · bank holiday`, true, name);
    }
  }
  for (const n of named) {
    const y = n.mmdd.startsWith('12') ? year : year + 1;
    put(`${y}-${n.mmdd}`, n.name, n.hero ?? false, n.name);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** The days still to come (today included): past sections are not built (owner 2026-11-14: no passed dates). */
export function upcomingDays(days: SeasonDay[], today: string): SeasonDay[] {
  return days.filter((d) => d.date >= today);
}

/** Hero: the next bank holiday or Hogmanay on or after today, "<name> is" over the weekday; null once the season is over. */
export function seasonHero(days: SeasonDay[], today: string): { label: string; value: string; sub: string } | null {
  const next = days.find((d) => d.hero && d.date >= today);
  if (!next) return null;
  const [weekday, ...rest] = formatEventDay(next.date, 'en-GB').split(' ');
  const long: Record<string, string> = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
  return { label: `${next.name} is`, value: long[weekday], sub: rest.join(' ') };
}

/** Confirmed facts that apply on `date` (their `on` list), in data order. */
export function factsOn(page: HolidayPageData, date: string): ConfirmedFact[] {
  return page.facts.filter((f): f is ConfirmedFact => f.status === 'confirmed' && f.section !== 'hours' && !!f.on?.includes(date));
}

/** The day sections to build: the days still to come that have at least one card (a fact or an event). No card, no section and no
 *  day chip (owner 2026-11-14, Mon 4 Jan); the day comes back by itself once a row for it exists. */
export function daysWithCards(page: HolidayPageData, events: ConfirmedEvent[], today: string): (SeasonDay & { facts: ConfirmedFact[]; events: ConfirmedEvent[] })[] {
  if (!page.season) return [];
  return upcomingDays(page.season.days, today)
    .map((d) => ({ ...d, facts: factsOn(page, d.date), events: eventsOn(events, d.date) }))
    .filter((d) => d.facts.length > 0 || d.events.length > 0);
}

const byStart = (a: ConfirmedEvent, b: ConfirmedEvent) => (a.date + (a.startTime ?? '')).localeCompare(b.date + (b.startTime ?? ''));
const lastDay = (e: ConfirmedEvent) => e.endDate ?? e.date;
const oneDay = (e: ConfirmedEvent) => !e.endDate || e.endDate === e.date;
const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();

/** Same title and same venue (case and spacing aside) = performances of one series (owner 2026-11-15: a general rule, not a case for
 *  the Òran Mór panto). */
export const seriesKey = (e: ConfirmedEvent): string => `${norm(e.name)}|${norm(e.venue.name)}`;

/** The events grouped by series, each group in start order. */
function bySeries(events: ConfirmedEvent[]): ConfirmedEvent[][] {
  const groups = new Map<string, ConfirmedEvent[]>();
  for (const e of [...events].sort(byStart)) groups.set(seriesKey(e), [...(groups.get(seriesKey(e)) ?? []), e]);
  return [...groups.values()];
}

/** One card for a series' performances on one day: the first of them (its link), with every start time of the day. */
function dayCard(group: ConfirmedEvent[]): ConfirmedEvent {
  const times = [...new Set(group.flatMap((e) => (e.startTime ? [e.startTime] : [])))];
  if (times.length < 2) return group[0];
  const { endTime: _end, ...first } = group[0];
  return { ...first, times };
}

/** Confirmed one-day events on `date`, one card per series (a run over several days is listed with the season's events, not per day). */
export function eventsOn(events: ConfirmedEvent[], date: string): ConfirmedEvent[] {
  return bySeries(events.filter((e) => e.date === date && oneDay(e))).map(dayCard).sort(byStart);
}

/** Confirmed events not over by `today`, one row per series, in date order. A series over several days is one row from its next
 *  performance to its last, linking to the next one (its days still get their own cards); one-day rows on a day with a section are
 *  shown there instead. */
export function seasonEvents(events: ConfirmedEvent[], days: SeasonDay[], today: string): ConfirmedEvent[] {
  const dayDates = new Set(days.map((d) => d.date));
  const rows: ConfirmedEvent[] = [];
  for (const group of bySeries(events.filter((e) => lastDay(e) >= today))) {
    const next = group[0];
    const end = group.map(lastDay).sort().pop()!;
    if (end === next.date) { if (!dayDates.has(next.date)) rows.push(dayCard(group)); continue; }
    if (group.length === 1) { rows.push(next); continue; }
    const { startTime: _start, endTime: _end, ...rest } = next;
    rows.push({ ...rest, endDate: end });
  }
  return rows.sort(byStart);
}

/** Confirmed events as rows of the date-tile list (components/pop/PopEventList.astro). Times as the source gives them, 12h-compact
 *  (gb profile); a date-only row ends at the end of its last day so the list does not drop it while it is still on. */
export function eventPopDays(events: ConfirmedEvent[], timeZone: string): PopDay[] {
  const days: PopDay[] = [];
  for (const e of events) {
    const start = localIso(e.date, e.startTime ?? '00:00', timeZone);
    const end = e.endTime ? localIso(e.endDate ?? e.date, e.endTime, timeZone) : localIso(e.endDate ?? e.date, '23:59', timeZone);
    const time = e.times ? listWords(e.times.map((t) => formatClock(t, 'en-GB'))) : e.startTime ? (e.endTime ? `${formatClock(e.startTime, 'en-GB')}–${formatClock(e.endTime, 'en-GB')}` : formatClock(e.startTime, 'en-GB')) : '';
    const row: PopRow = {
      dayKey: e.date, timeLabel: time, title: e.name, venue: e.venue.name, area: null,
      free: false, kids: false, teens: false, cat: null, start, end, recurrence: 'one_off',
      href: e.url, note: [...(e.details ?? []), ...(e.clarify ? [e.clarify] : [])].join(' ') || undefined,
      attrs: { 'data-hp-item': '', 'data-source': e.source.url, 'data-hp-venue': e.venue.name },
    };
    const last = days[days.length - 1];
    if (last && last.dayKey === row.dayKey) last.rows.push(row); else days.push({ dayKey: row.dayKey, rows: [row] });
  }
  return days;
}
