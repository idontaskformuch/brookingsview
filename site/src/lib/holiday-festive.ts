/** The festive holiday layout (owner 2026-11-26, .claude/specs/design-lift-holiday-2026-11-26.md): one shared view for every town's
 *  Christmas page. Pure functions from the page data (lib/holiday-page.ts) and its closures grid (lib/holiday-view.ts); no clock, no
 *  model text. Patterns: an advent strip (one tile per day, a dot for events, an icon for closed / no trains), a holiday matrix (places
 *  by key day), day blocks (date tile, digest line, one featured event, compact rows) and the season's runs as one carousel. */
import { formatClock, type ConfirmedEvent, type HolidayLocale, type HolidayPageData } from './holiday-page';
import type { ClosureGridView, GridRow } from './holiday-view';
import { seriesKey } from './holiday-season';

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MON_ANCHOR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** The strip's days: 20 Dec of the page year to 2 Jan (owner 2026-11-26). */
export function stripRange(year: number): { first: string; last: string } {
  return { first: `${year}-12-20`, last: `${year + 1}-01-02` };
}

/** The matrix's fixed columns (owner 2026-11-26): 24, 25, 26 and 31 Dec and 1 Jan. */
export function keyDays(year: number): string[] {
  return [`${year}-12-24`, `${year}-12-25`, `${year}-12-26`, `${year}-12-31`, `${year + 1}-01-01`];
}

/** Names of the key days where the page has no season label of its own (the US pages; Glasgow's come from GOV.UK). */
const DAY_NAMES: Record<string, Record<HolidayLocale, string>> = {
  '12-24': { 'en-US': 'Christmas Eve', 'en-GB': 'Christmas Eve' },
  '12-25': { 'en-US': 'Christmas Day', 'en-GB': 'Christmas Day' },
  '12-26': { 'en-US': 'Day after Christmas', 'en-GB': 'Boxing Day' },
  '12-31': { 'en-US': "New Year's Eve", 'en-GB': 'Hogmanay' },
  '01-01': { 'en-US': "New Year's Day", 'en-GB': "New Year's Day" },
};

function days(first: string, last: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${first}T00:00:00Z`); t <= Date.parse(`${last}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

const dow = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`)).getUTCDay();
export const anchorOf = (iso: string) => `${MON_ANCHOR[Number(iso.slice(5, 7)) - 1]}-${iso.slice(8, 10)}`;

/** A day's name: the season's own label (GOV.UK bank holiday, "Christmas Day · bank holiday"), else the key day's name, else none. */
export function dayName(page: HolidayPageData, iso: string): string | null {
  const own = page.season?.days.find((d) => d.date === iso)?.label;
  return own ?? DAY_NAMES[iso.slice(5)]?.[page.locale] ?? null;
}

/** "7:30pm" / "7:30 p.m."; 12:00 is "Noon" (owner 2026-11-26: "12:00" or "Noon", never "PM" over a big number). */
export function clock(hhmm: string, locale: HolidayLocale): string {
  return hhmm === '12:00' ? 'Noon' : formatClock(hhmm, locale);
}

/** One-day events (a run over several days is not a day's event: it is in the season carousel). */
const oneDay = (e: ConfirmedEvent) => !e.endDate || e.endDate === e.date;
const byStart = (a: ConfirmedEvent, b: ConfirmedEvent) => (a.date + (a.startTime ?? '')).localeCompare(b.date + (b.startTime ?? ''));

/** The grid rows shut on `iso`, as words: a place's own word ("No trains") or "<short name> closed". */
function closedWords(grid: ClosureGridView | null, iso: string): { words: string[]; closed: boolean; noTransit: boolean } {
  const i = grid?.days.findIndex((d) => d.iso === iso) ?? -1;
  if (!grid || i < 0) return { words: [], closed: false, noTransit: false };
  const rows: GridRow[] = grid.groups.flatMap((g) => g.rows).filter((r) => r.cells[i].kind === 'closed');
  return {
    words: rows.map((r) => (r.cells[i].text === 'Closed' ? `${r.short ?? r.name} closed` : r.cells[i].text)),
    closed: rows.some((r) => !r.transit),
    noTransit: rows.some((r) => r.transit),
  };
}

export interface StripDay {
  iso: string;
  weekday: string;
  day: number;
  /** month name on the first tile and on the 1st of a month, else null */
  month: string | null;
  events: number;
  closed: boolean;
  /** a transit row is closed that day (ScotRail "No trains") */
  noTransit: boolean;
  /** the day's block on the page, when it has one */
  href: string | null;
  name: string | null;
}

/** The empty-state rule (owner 2026-11-26 (6)): the strip is left out when fewer than this many of its days have events. */
export const MIN_STRIP_EVENT_DAYS = 3;

/** The strip's tiles, or null when fewer than MIN_STRIP_EVENT_DAYS days in the range have a one-day event (Broomfield, Nov 2026). */
export function adventStrip(page: HolidayPageData, events: ConfirmedEvent[], grid: ClosureGridView | null, blockDays: Set<string>): StripDay[] | null {
  const { first, last } = stripRange(page.year);
  const tiles = days(first, last).map((iso, i) => {
    const c = closedWords(grid, iso);
    return {
      iso, weekday: WD[dow(iso)], day: Number(iso.slice(8, 10)),
      month: i === 0 || iso.endsWith('-01') ? MON[Number(iso.slice(5, 7)) - 1] : null,
      events: events.filter((e) => e.date === iso && oneDay(e)).length,
      closed: c.closed, noTransit: c.noTransit,
      href: blockDays.has(iso) ? `#${anchorOf(iso)}` : null,
      name: dayName(page, iso),
    };
  });
  return tiles.filter((t) => t.events > 0).length < MIN_STRIP_EVENT_DAYS ? null : tiles;
}

export type MatrixKind = 'closed' | 'hours' | 'normal';
/** `note`: the number of the footnote under the matrix that holds the source's full text (a cell longer than MAX_CELL). */
export interface MatrixCell { kind: MatrixKind; text: string; note?: number }
export interface MatrixView {
  days: { iso: string; weekday: string; label: string; name: string | null }[];
  rows: { name: string; href?: string; note?: string; cells: MatrixCell[] }[];
  /** numbered footnotes, 1 first: the full source text of every cell that was too long */
  notes: string[];
  checked: string;
}

/** A matrix cell holds at most about this many characters ("Closed", "No trains", "Last 21:00", "10:00–20:00"); longer source text
 *  goes to a numbered footnote under the matrix (owner 2026-11-26 (6); ScotRail's "Last trains leave earlier than normal"). */
export const MAX_CELL = 15;
/** The cell word in place of a too-long text: no wording of our own beyond the kind of change. */
const CELL_FALLBACK: Record<Exclude<MatrixKind, 'normal'>, string> = { closed: 'Closed', hours: 'Changed' };
/** Changed hours whose text says outright that something ends or closes earlier (owner 2026-11-26 (7)): "Early finish". "Changed"
 *  stays the word when the direction is not stated. */
const EARLY = /\b(earlier|early)\b/i;
const ENDS = /\b(last|clos\w*|finish\w*|end\w*|leave\w*)\b/i;
export const earlyFinish = (text: string): boolean => EARLY.test(text) && ENDS.test(text);

/** Too-long cells get the fallback word ("Early finish" for stated earlier endings) and a footnote; the same text is the same footnote. */
export function footnoteCells(rows: MatrixView['rows']): { rows: MatrixView['rows']; notes: string[] } {
  const notes: string[] = [];
  const out = rows.map((r) => ({
    ...r,
    cells: r.cells.map((c): MatrixCell => {
      if (c.kind === 'normal' || c.text.length <= MAX_CELL) return c;
      let n = notes.indexOf(c.text) + 1;
      if (n === 0) n = notes.push(c.text);
      return { kind: c.kind, text: c.kind === 'hours' && earlyFinish(c.text) ? 'Early finish' : CELL_FALLBACK[c.kind], note: n };
    }),
  }));
  return { rows: out, notes };
}

/** Places by key day. Columns: the five key days, plus any other day a place changes (Glasgow's substitute bank holidays), in date
 *  order. A cell: "Closed" or the place's own word (marked), the changed hours, or "Normal" (no change announced by the source). */
export function holidayMatrix(page: HolidayPageData, grid: ClosureGridView | null): MatrixView | null {
  if (!grid) return null;
  const rows = grid.groups.flatMap((g) => g.rows);
  const changed = grid.days.filter((_, i) => rows.some((r) => r.cells[i].kind !== 'usual')).map((d) => d.iso);
  const isos = [...new Set([...keyDays(page.year), ...changed])].sort();
  const sep = page.locale === 'en-GB' ? (d: number, m: string) => `${d} ${m}` : (d: number, m: string) => `${m} ${d}`;
  const { rows: noted, notes } = footnoteCells(rows.map((r) => ({
      name: r.name, ...(r.href ? { href: r.href } : {}), ...(r.note ? { note: r.note } : {}),
      cells: isos.map((iso): MatrixCell => {
        const i = grid.days.findIndex((d) => d.iso === iso);
        const c = i < 0 ? null : r.cells[i];
        if (!c || c.kind === 'usual') return { kind: 'normal', text: 'Normal' };
        return c.kind === 'closed' ? { kind: 'closed', text: c.text } : { kind: 'hours', text: c.short ?? c.text };
      }),
  })));
  return {
    days: isos.map((iso) => ({ iso, weekday: WD[dow(iso)], label: sep(Number(iso.slice(8, 10)), MON[Number(iso.slice(5, 7)) - 1]), name: dayName(page, iso) })),
    rows: noted,
    notes,
    checked: grid.checked,
  };
}

export interface DayBlock {
  iso: string;
  anchor: string;
  weekday: string;
  day: number;
  month: string;
  name: string | null;
  /** "3 events · St Enoch closed · No trains" */
  digest: string;
  featured: ConfirmedEvent | null;
  rows: ConfirmedEvent[];
}

/** MAX_CLOSED in a digest line, then "+N more". */
export const MAX_CLOSED = 3;

/** "3 events · St Enoch closed · No trains"; the parts that have data, nothing else. */
export function digestLine(eventCount: number, closed: string[]): string {
  const parts: string[] = [];
  if (eventCount > 0) parts.push(`${eventCount} ${eventCount === 1 ? 'event' : 'events'}`);
  parts.push(...closed.slice(0, MAX_CLOSED));
  if (closed.length > MAX_CLOSED) parts.push(`+${closed.length - MAX_CLOSED} more closed`);
  return parts.join(' · ');
}

/** The featured event of a day: the one whose series is on the fewest days of the season (a one-off before the panto's daily
 *  performance), the earliest on a tie. */
export function featuredOf(dayEvents: ConfirmedEvent[], all: ConfirmedEvent[]): ConfirmedEvent | null {
  if (dayEvents.length === 0) return null;
  const daysOf = (e: ConfirmedEvent) => new Set(all.filter((x) => seriesKey(x) === seriesKey(e)).map((x) => x.date)).size;
  return [...dayEvents].sort((a, b) => daysOf(a) - daysOf(b) || byStart(a, b))[0];
}

/** One performance per series and day (two shows of the panto are one row with both times). */
function perSeries(events: ConfirmedEvent[]): ConfirmedEvent[] {
  const groups = new Map<string, ConfirmedEvent[]>();
  for (const e of [...events].sort(byStart)) groups.set(seriesKey(e), [...(groups.get(seriesKey(e)) ?? []), e]);
  return [...groups.values()].map((g) => {
    const times = [...new Set(g.flatMap((e) => (e.startTime ? [e.startTime] : [])))];
    return times.length < 2 ? g[0] : { ...g[0], times, endTime: undefined };
  });
}

/** Day blocks for every day from `today` that has a one-day event, and every strip day that has a closure. */
export function dayBlocks(page: HolidayPageData, events: ConfirmedEvent[], grid: ClosureGridView | null, today: string, range?: { first: string; last: string }): DayBlock[] {
  const { first, last } = range ?? stripRange(page.year);
  const inRange = (iso: string) => iso >= first && iso <= last && iso >= today;
  const dates = new Set([
    ...events.filter((e) => oneDay(e) && inRange(e.date)).map((e) => e.date),
    ...(grid?.days.map((d) => d.iso) ?? []).filter((iso) => inRange(iso) && closedWords(grid, iso).words.length > 0),
  ]);
  return [...dates].sort().map((iso) => {
    const dayEvents = perSeries(events.filter((e) => e.date === iso && oneDay(e)));
    const featured = featuredOf(dayEvents, events);
    return {
      iso, anchor: anchorOf(iso), weekday: WD[dow(iso)], day: Number(iso.slice(8, 10)), month: MON[Number(iso.slice(5, 7)) - 1],
      name: dayName(page, iso),
      digest: digestLine(dayEvents.length, closedWords(grid, iso).words),
      featured,
      rows: dayEvents.filter((e) => e !== featured),
    };
  });
}

/** Runs over several days still on by `today` (Winter Wonderland, a drone show season): the carousel, in start order. */
export function seasonRuns(events: ConfirmedEvent[], today: string): ConfirmedEvent[] {
  return events.filter((e) => !oneDay(e) && (e.endDate ?? e.date) >= today).sort(byStart);
}

/** The time line of an event row: "7:30pm", "2pm and 7pm", "7pm–10pm"; '' without a time. */
export function timeText(e: ConfirmedEvent, locale: HolidayLocale): string {
  if (e.times) return e.times.map((t) => clock(t, locale)).join(' & ');
  if (!e.startTime) return '';
  return e.endTime ? `${clock(e.startTime, locale)}–${clock(e.endTime, locale)}` : clock(e.startTime, locale);
}

/** "20 Nov – 31 Dec" / "Nov 20 – Dec 31" for a run. */
export function runDates(e: ConfirmedEvent, locale: HolidayLocale): string {
  const f = (iso: string) => {
    const d = Number(iso.slice(8, 10));
    const m = MON[Number(iso.slice(5, 7)) - 1];
    return locale === 'en-GB' ? `${d} ${m}` : `${m} ${d}`;
  };
  return e.endDate ? `${f(e.date)} – ${f(e.endDate)}` : f(e.date);
}

export interface WeekGroup {
  /** Monday of the week, YYYY-MM-DD */
  monday: string;
  /** "Week of 30 Nov" / "Week of Nov 30" */
  heading: string;
  /** "8 events" */
  digest: string;
  rows: { e: ConfirmedEvent; day: string }[];
}

/** One-day events from `today` that are outside the strip (before 20 Dec, after 2 Jan), grouped by week (Monday first), one row per
 *  series and day. `day`: "Sat 5" / "Sat 5" — the row's own day, since a week has seven. */
export function weekGroups(page: HolidayPageData, events: ConfirmedEvent[], today: string): WeekGroup[] {
  const { first, last } = stripRange(page.year);
  const outside = events.filter((e) => oneDay(e) && e.date >= today && (e.date < first || e.date > last));
  const byDate = new Map<string, ConfirmedEvent[]>();
  for (const e of outside) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
  const weeks = new Map<string, WeekGroup>();
  for (const iso of [...byDate.keys()].sort()) {
    const t = Date.parse(`${iso}T00:00:00Z`);
    const monday = new Date(t - ((dow(iso) + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
    const d = Number(monday.slice(8, 10));
    const m = MON[Number(monday.slice(5, 7)) - 1];
    const w = weeks.get(monday) ?? { monday, heading: `Week of ${page.locale === 'en-GB' ? `${d} ${m}` : `${m} ${d}`}`, digest: '', rows: [] };
    for (const e of perSeries(byDate.get(iso)!)) w.rows.push({ e, day: `${WD[dow(iso)]} ${Number(iso.slice(8, 10))}` });
    weeks.set(monday, w);
  }
  return [...weeks.values()].map((w) => ({ ...w, digest: `${w.rows.length} ${w.rows.length === 1 ? 'event' : 'events'}` }));
}
