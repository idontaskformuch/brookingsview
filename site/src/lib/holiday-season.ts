/** Day by day on a holiday page that spans a season (/christmas/ in Glasgow: Christmas Eve to the last New Year bank holiday).
 *  Owner 2026-11-14 (.claude/specs/glasgow-christmas-2026.md): one standing page with an anchored section per day, no day URLs;
 *  which days are bank holidays comes from GOV.UK's bank-holidays.json (config/holiday-pages/gb/bank-holidays-scotland.json),
 *  nothing is hard-coded. A substitute day gives two sections: the calendar day ("Boxing Day · bank holiday observed Mon 28 Dec")
 *  and the day off itself. Pure: no clock, no model text. */
import { formatEventDay, type ConfirmedEvent, type ConfirmedFact, type HolidayPageData } from './holiday-page';

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

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** QA data.holiday-hours-dates (owner 2026-11-15): a run with opening hours (openHours) and a standing-hours row for the same place
 *  (an `hours` fact whose label names the run's venue): that row must name the run's first day with its month ("6 November" or "6 Nov").
 *  St Enoch Square's row said "6 to 20 Dec" for a run from 6 November. One line per row that does not. */
export function hoursRowsMissingRunStart(page: HolidayPageData): string[] {
  const out: string[] = [];
  for (const e of page.events) {
    if (e.status !== 'confirmed' || !e.openHours) continue;
    const day = Number(e.date.slice(8, 10));
    const month = MONTH_NAMES[Number(e.date.slice(5, 7)) - 1];
    const named = new RegExp(`\\b${day} (${month}|${month.slice(0, 3)})\\b`);
    for (const f of page.facts) {
      if (f.status !== 'confirmed' || f.section !== 'hours' || !f.label.includes(e.venue.name)) continue;
      if (!named.test(f.value)) out.push(`${f.label}: does not name the run's first day ${day} ${month} ("${f.value}")`);
    }
  }
  return out;
}

/** Confirmed facts that apply on `date` (their `on` list), in data order. */
export function factsOn(page: HolidayPageData, date: string): ConfirmedFact[] {
  return page.facts.filter((f): f is ConfirmedFact => f.status === 'confirmed' && f.section !== 'hours' && !!f.on?.includes(date));
}

const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();

/** Same title and same venue (case and spacing aside) = performances of one series (owner 2026-11-15: a general rule, not a case for
 *  the Òran Mór panto). */
export const seriesKey = (e: ConfirmedEvent): string => `${norm(e.name)}|${norm(e.venue.name)}`;
