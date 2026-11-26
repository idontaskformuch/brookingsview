/** View model of a holiday page (components/HolidayPage.astro): hero, grouped rows, one source list. Pure: everything is
 *  derived from the page data (lib/holiday-page.ts) and the date rule; nothing is read out of free text except one
 *  conservative rule for a leading "Closed" (detailFor), and no model text is involved.
 *
 *  Question it answers for a resident: what is closed, what changed, what runs as usual on <holiday>, and what is not
 *  confirmed yet. Layout: .claude/standards.md "Helgsidor". */
import {
  eventWhenWhere, formatIsoDate, isEventPast, lastChecked, listWords, regularHours,
  type CheckAt, type ConfirmedFact, type GridArea, type HolidayChange, type HolidayEvent, type HolidayFact, type HolidayLocale, type HolidayPageData, type LastYear, type Source,
} from './holiday-page';
import { formatDayLong, formatDayShort, occurrenceDay, weekdayLong } from './holiday-calendar';
import { relWords } from './client/time-status';
import { driveLabel, driveMinutes } from './evening-items';
import type { HolidayPageDef } from '../config/holiday-pages/calendar';

export type PillTone = 'alert' | 'warn' | 'ok' | 'neutral';
export interface PillView { tone: PillTone; text: string }

export interface RowView {
  name: string;
  /** The organizer's own page (events): the name links to it. */
  href?: string;
  pill: PillView | null;
  /** Detail sentences, shown inline in one paragraph. */
  parts: string[];
  lastYear?: { text: string; source: Source };
  check?: CheckAt;
  /** A phone number for a row whose name already links to the place's page. */
  phone?: string;
  /** Only when this row was read before the page's newest check ("Checked Oct 24, 2026"). */
  checkedNote?: string;
}

export type GroupId = 'closed' | 'changed' | 'open' | 'info' | 'events' | 'nearby' | 'unconfirmed';
export interface GroupView { id: GroupId; heading: string; rows: RowView[] }

/** Render order of the groups; a group without rows is not rendered. */
export const GROUP_ORDER: GroupId[] = ['closed', 'changed', 'open', 'info', 'events', 'nearby', 'unconfirmed'];
export const GROUP_HEADING: Record<GroupId, string> = {
  closed: 'Closed',
  changed: 'Schedule changes',
  open: 'Open as usual',
  info: 'Good to know',
  events: 'Events',
  nearby: 'Nearby',
  unconfirmed: 'Check before you go',
};
/** A group longer than this shows the first FOLD_AFTER rows and the rest behind a "Show N more" toggle. */
export const FOLD_AFTER = 8;

const PILL: Record<HolidayChange, PillView> = {
  closed: { tone: 'alert', text: 'Closed' },
  changed: { tone: 'warn', text: 'Changed' },
  open: { tone: 'ok', text: 'Open' },
};

/** The Closed pill already says "Closed", so a value that starts "Closed Nov 11: ..." or "Closed on Thu Nov 26" shows
 *  "Nov 11: ..." / "Thu Nov 26". Only when what follows is a date (weekday, month or digit); anything else is left whole. */
const LEADING_CLOSED = /^Closed(?: on)? (?=(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d))/;
export function detailFor(change: HolidayChange | undefined, value: string): string {
  return change === 'closed' ? value.replace(LEADING_CLOSED, '') : value;
}

function olderNote(checkedOn: string, newest: string, locale: HolidayLocale): string | undefined {
  return checkedOn < newest ? `Checked ${formatIsoDate(checkedOn, false, locale)}` : undefined;
}

function unconfirmedRow(
  name: string, x: { clarify?: string; usual?: string; lastYear?: LastYear; checkAt?: CheckAt; checkedOn: string }, page: HolidayPageData, newest: string,
): RowView {
  // A plain link to the place's own page, no status pill (Broomfield AdSense plan F9, 2026-11-11): the row names where
  // this year's hours will be posted, it does not announce that they are missing.
  return {
    name,
    href: x.checkAt?.url,
    pill: null,
    parts: [...(x.clarify ? [x.clarify] : []), ...(x.usual ? [`Usual hours: ${x.usual}`] : [])],
    lastYear: x.lastYear ? { text: `${x.lastYear.season ?? page.year - 1}: ${x.lastYear.value}`, source: x.lastYear.source } : undefined,
    check: x.checkAt?.url ? undefined : x.checkAt,
    phone: x.checkAt?.url ? x.checkAt.phone : undefined,
    checkedNote: olderNote(x.checkedOn, newest, page.locale),
  };
}

function factRow(f: HolidayFact, page: HolidayPageData, newest: string, over = false): RowView {
  if (f.status === 'unconfirmed') return unconfirmedRow(f.label, f, page, newest);
  return {
    name: f.label,
    pill: f.change ? PILL[f.change] : null,
    parts: [detailFor(f.change, over && f.past ? f.past : f.value), ...(f.clarify ? [f.clarify] : [])],
    checkedNote: olderNote(f.checkedOn, newest, page.locale),
  };
}

/** The Nearby group's distance text: "about N min drive" (NB1), or null for a row that does not belong there. */
export function nearbyDrive(e: HolidayEvent, page: HolidayPageData): string | null {
  return page.nearbySection && e.status === 'confirmed' && e.nearby?.miles != null ? driveLabel(driveMinutes(e.nearby.miles)) : null;
}

function eventRow(e: HolidayEvent, page: HolidayPageData, newest: string, today: string): RowView {
  if (e.status === 'unconfirmed') {
    const row = unconfirmedRow(e.name, e, page, newest);
    return e.date ? { ...row, parts: [eventWhenWhere(e, page.locale), ...row.parts] } : row;
  }
  const past = isEventPast(e, today);
  return {
    name: e.name,
    href: e.url,
    pill: past ? { tone: 'neutral', text: `Held ${formatIsoDate(e.endDate ?? e.date, true, page.locale)}` } : null,
    parts: [eventWhenWhere(e, page.locale, nearbyDrive(e, page) ?? undefined), ...((past && e.pastDetails) || e.details || []), ...(e.clarify ? [e.clarify] : [])],
    checkedNote: olderNote(e.checkedOn, newest, page.locale),
  };
}

/** The rows of the page, grouped. Standing opening hours (section "hours") are not here; see regularHoursRows.
 *  `dayIso` is the holiday in the page's season: once `today` is after it the rows speak in the past tense (`past`,
 *  `pastDetails`) and the "Check before you go" group is dropped -- nothing is left to check for a day that is over
 *  (owner 2026-11-11). */
export function buildGroups(page: HolidayPageData, today: string, dayIso?: string): GroupView[] {
  const newest = lastChecked(page);
  const over = !!dayIso && today > dayIso;
  const rows: Record<GroupId, RowView[]> = { closed: [], changed: [], open: [], info: [], events: [], nearby: [], unconfirmed: [] };
  for (const f of page.facts) {
    if (f.section === 'hours') continue;
    if (f.status === 'confirmed' && f.days) continue; // shown in the closures grid (closureGrid)
    const id: GroupId = f.status === 'unconfirmed' ? 'unconfirmed' : (f.change ?? 'info');
    rows[id].push(factRow(f, page, newest, over));
  }
  for (const e of page.events) {
    const id: GroupId = e.status !== 'confirmed' ? 'unconfirmed' : nearbyDrive(e, page) ? 'nearby' : 'events';
    rows[id].push(eventRow(e, page, newest, today));
  }
  if (over) rows.unconfirmed = [];
  return GROUP_ORDER.filter((id) => rows[id].length > 0).map((id) => ({ id, heading: GROUP_HEADING[id], rows: rows[id] }));
}

export function regularHoursRows(page: HolidayPageData): RowView[] {
  const newest = lastChecked(page);
  return regularHours(page).map((f) => factRow(f, page, newest));
}

/** Places shut ON the holiday: confirmed "closed" rows about a place or service people visit (closures, help) whose
 *  `closedOn` (if any) includes `dayIso`. A pickup or a train that does not run is not a place. Built from the rows, never
 *  written by hand: Broomfield's Thanksgiving hero said "2 places closed" while Tree Branch closes Sat Nov 28 (F9). */
export function closedPlaceRows(page: HolidayPageData, dayIso?: string): ConfirmedFact[] {
  return page.facts.filter((f): f is ConfirmedFact => f.status === 'confirmed' && f.change === 'closed' && (f.section === 'closures' || f.section === 'help')
    && (!dayIso || !f.closedOn || f.closedOn.includes(dayIso)));
}
export function closedPlaces(page: HolidayPageData, dayIso?: string): number {
  return closedPlaceRows(page, dayIso).length;
}

/** The count (and the /holidays/ "Closed: ..." line) waits for a `holdsCount` row that is still unconfirmed; a page marked
 *  `noClosedCount` never shows one. */
export function countHeld(page: HolidayPageData): boolean {
  return !!page.noClosedCount || page.facts.some((f) => f.holdsCount && f.status === 'unconfirmed');
}

export const MAX_INSIGHTS = 2;
/** Lines under the hero, written in the data on the rows that change what people plan around (a moved pickup).
 *  They speak of the day, so none once it is over (`over`). */
export function holidayInsights(page: HolidayPageData, over = false): string[] {
  if (over) return [];
  return page.facts.flatMap((f) => (f.status === 'confirmed' && f.insight ? [f.insight] : [])).slice(0, MAX_INSIGHTS);
}

/** The standing (timeless) page (owner 2026-11-11): the page is outside its window and its facts are for an earlier season
 *  than the next occurrence, so it must not say that anything happened. It shows what the day is, what is normally closed or
 *  different according to the source, and the next date: no past tense, no dated values, no events, no "Check before you go". */
export function isTimeless(page: HolidayPageData, nextYear: number | null): boolean {
  return nextYear !== null && nextYear > page.year;
}

export const TIMELESS_HEADING: Record<HolidayChange, string> = {
  closed: 'Normally closed',
  changed: 'Normally different',
  open: 'Normally open',
};

/** Groups of the standing page: confirmed closed / changed / open rows, each with its `standing` text or only its name. */
export function timelessGroups(page: HolidayPageData): GroupView[] {
  const order: HolidayChange[] = ['closed', 'changed', 'open'];
  const rows: Record<HolidayChange, RowView[]> = { closed: [], changed: [], open: [] };
  for (const f of page.facts) {
    if (f.status !== 'confirmed' || !f.change || f.section === 'hours') continue;
    // A place with one row per day (season pages, `on`) is named once per group.
    if (rows[f.change].some((r) => r.name === f.label)) continue;
    rows[f.change].push({ name: f.label, pill: PILL[f.change], parts: f.standing ? [f.standing] : [] });
  }
  return order.filter((c) => rows[c].length > 0).map((c) => ({ id: c, heading: TIMELESS_HEADING[c], rows: rows[c] }));
}

/** Closures grid (Tillägg B, owner 2026-11-20): one row per place with `days`, one column per affected day (the union of the
 *  rows' days, in order). A cell is 'closed' (muted), 'hours' (bold: differs from usual) or 'usual' (a day the source does
 *  not list for that place: its usual hours, which for some places means closed that weekday, so it never says "Open").
 *  More than GRID_GROUP_AFTER places -> grouped City services / Recreation / Food & help. One "Checked" date for the
 *  grid: the newest row check, not a span. Null when no row has `days`. */
export const GRID_GROUP_AFTER = 6;
export type GridCellKind = 'closed' | 'hours' | 'usual';
/** `short`: the phone label (<40rem), where four day columns leave no room for "Usual hours" on one line (owner 2026-11-20).
 *  A transit row (section 'transit', set in the data, never read from the name) says "Regular schedule" / "Regular" instead. */
export interface GridCell { kind: GridCellKind; text: string; short?: string }
/** `href`: the page the row was read from (season pages, where every place links to its source). `summary`: the phone card of a
 *  grid with more than GRID_COMPACT_AFTER days, only the days that differ from usual (owner 2026-11-21). */
export interface GridRow { name: string; note?: string; href?: string; cells: GridCell[]; summary: string; short?: string; /** section 'transit' in the data */ transit?: boolean }
export interface ClosureGridView {
  days: { iso: string; label: string }[];
  groups: { heading: string | null; rows: GridRow[] }[];
  checked: string;
  /** The line above the grid, "Usual = no change announced by the source.", only when a cell says "Usual hours" (owner 2026-11-20). */
  legend: string | null;
  /** More than GRID_COMPACT_AFTER days: below 40rem every place is one card with its `summary` instead of a column per day, and
   *  the legend is hidden there (usual days are not shown on the phone). Owner 2026-11-21, all towns. */
  compact: boolean;
}
export const GRID_COMPACT_AFTER = 4;
export const GRID_LEGEND = 'Usual = no change announced by the source.';
const USUAL_CELL: GridCell = { kind: 'usual', text: 'Usual hours', short: 'Usual' };
const REGULAR_CELL: GridCell = { kind: 'usual', text: 'Regular schedule', short: 'Regular' };
export const GRID_AREA_HEADING: Record<GridArea, string> = { city: 'City services', rec: 'Recreation', help: 'Food & help' };
const GRID_AREA_ORDER: GridArea[] = ['city', 'rec', 'help'];
const WD_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Phone label for an hours cell (owner 2026-11-21): "9 a.m.–5 p.m." -> "9–5", "9:30 a.m.–5 p.m." -> "9:30–5", so it fits one
 *  line in a 390px card. a.m./p.m. stay only where the bare numbers would read wrong: a range that crosses noon (or midnight)
 *  with the end number above the start ("7 a.m.–9 p.m." would read as 7–9 a.m.). Anything that is not exactly one range
 *  ("Closes 5 p.m.", "8 a.m. group fitness only") is returned unchanged; phoneHours shortens those. Desktop always shows the full text. */
export function shortHourRange(v: string): string {
  const m = /^(\d{1,2})(:\d\d)?(?: ([ap])\.m\.)?–(\d{1,2})(:\d\d)? ([ap])\.m\.$/.exec(v);
  if (!m) return v;
  const [, h1, m1 = '', a1, h2, m2 = '', a2] = m;
  const start = a1 ?? a2;
  const rank = (h: string) => Number(h) % 12; // 12 sorts before 1 within its half
  const crosses = start !== a2;
  if (crosses && (start === 'p' || rank(h2) > rank(h1))) return v;
  return `${h1}${m1}–${h2}${m2}`;
}

/** The phone text of an hours cell (owner 2026-11-21): a range as shortHourRange; any other clock time loses its space and
 *  periods, "Closes 5 p.m." -> "Closes 5pm", "8 a.m. group fitness only" -> "8am group fitness only", "7 a.m.–9 p.m." -> "7am–9pm". */
export function phoneHours(v: string): string {
  const range = shortHourRange(v);
  return range !== v ? range : v.replace(/(\d) ([ap])\.m\./g, '$1$2m');
}

/** "25–26 Dec, 1–2 Jan" (en-GB) / "Dec 25–26, Jan 1–2" (en-US): days in order, a run of calendar days as a range, the month
 *  once per month. A run over the month end keeps both months ("31 Dec–1 Jan"). */
export function dayList(isos: string[], locale: HolidayLocale): string {
  const DAY = 86_400_000;
  const ms = [...isos].sort().map((iso) => Date.parse(`${iso}T00:00:00Z`));
  const runs: [number, number][] = [];
  for (const t of ms) { const last = runs[runs.length - 1]; if (last && t - last[1] === DAY) last[1] = t; else runs.push([t, t]); }
  const mon = (t: number) => formatDayShort(t, locale).replace(/\d+/, '').trim();
  const day = (t: number) => String(new Date(t).getUTCDate());
  const parts: string[] = [];
  let i = 0;
  while (i < runs.length) {
    const [a, b] = runs[i];
    if (mon(a) !== mon(b)) { parts.push(`${formatDayShort(a, locale)}–${formatDayShort(b, locale)}`); i++; continue; }
    const same: string[] = [];
    while (i < runs.length && mon(runs[i][0]) === mon(a) && mon(runs[i][1]) === mon(a)) {
      same.push(runs[i][0] === runs[i][1] ? day(runs[i][0]) : `${day(runs[i][0])}–${day(runs[i][1])}`);
      i++;
    }
    parts.push(locale === 'en-GB' ? `${same.join(', ')} ${mon(a)}` : `${mon(a)} ${same.join(', ')}`);
  }
  return parts.join(', ');
}

/** A place's phone card in a compact grid (owner 2026-11-21): only the days that differ from usual, closed first, then the
 *  changed hours in day order: "Closed 25–26 Dec, 1–2 Jan · 24 Dec until 4pm". Usual days are left out. */
export function gridSummary(cells: GridCell[], isos: string[], locale: HolidayLocale): string {
  const by = new Map<string, { kind: GridCellKind; text: string; days: string[] }>();
  cells.forEach((c, i) => {
    if (c.kind === 'usual') return;
    const key = `${c.kind}|${c.text}`;
    by.set(key, { kind: c.kind, text: c.text, days: [...(by.get(key)?.days ?? []), isos[i]] });
  });
  const lc = (t: string) => (/^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t);
  // A date never breaks over two lines on the card ("26–" / "27 Dec"): no-break space before the month, word joiner after a dash.
  const dates = (d: string[]) => dayList(d, locale).replace(/(?<=\d) (?=[A-Z][a-z]{2}\b)|(?<=\b[A-Z][a-z]{2}) (?=\d)/g, '\u00a0').replace(/–/g, '–\u2060');
  const groups = [...by.values()];
  const segs = [
    ...groups.filter((g) => g.kind === 'closed').map((g) => `${g.text} ${dates(g.days)}`),
    ...groups.filter((g) => g.kind !== 'closed').map((g) => `${dates(g.days)} ${lc(phoneHours(g.text))}`),
  ];
  return segs.length ? segs.join(' · ') : 'No change announced';
}

/** One place in the grid, before the columns are known: its cells by day. */
interface GridSourceRow { fact: ConfirmedFact; href?: string; cells: Record<string, GridCell> }

function gridFromRows(page: HolidayPageData, src: GridSourceRow[]): ClosureGridView | null {
  if (src.length === 0) return null;
  const isos = [...new Set(src.flatMap((r) => Object.keys(r.cells)))].sort();
  // Days in two months (Dec 24 ... Jan 1) carry the month, or "Fri 1" next to "Fri 25" reads as December.
  const twoMonths = new Set(isos.map((iso) => iso.slice(0, 7))).size > 1;
  const days = isos.map((iso) => {
    const ms = Date.parse(`${iso}T00:00:00Z`);
    const wd = WD_SHORT[new Date(ms).getUTCDay()];
    return { iso, label: twoMonths ? `${wd} ${formatDayShort(ms, page.locale)}` : `${wd} ${Number(iso.slice(8, 10))}` };
  });
  const row = ({ fact: f, href, cells: byDay }: GridSourceRow): GridRow => {
    const note = [f.dayNote, f.clarify].filter(Boolean).join(' ');
    const cells = isos.map((iso): GridCell => byDay[iso] ?? { ...(f.section === 'transit' ? REGULAR_CELL : USUAL_CELL) });
    return { name: f.label, ...(note ? { note } : {}), ...(href ? { href } : {}), cells, summary: gridSummary(cells, isos, page.locale), ...(f.dayShort ? { short: f.dayShort } : {}), ...(f.section === 'transit' ? { transit: true } : {}) };
  };
  const area = (f: ConfirmedFact): GridArea => f.area ?? (f.section === 'help' ? 'help' : 'city');
  const groups = src.length > GRID_GROUP_AFTER
    ? GRID_AREA_ORDER.map((a) => ({ heading: GRID_AREA_HEADING[a], rows: src.filter((r) => area(r.fact) === a).map(row) })).filter((g) => g.rows.length > 0)
    : [{ heading: null, rows: src.map(row) }];
  const checked = src.map((r) => r.fact.checkedOn).sort().reverse()[0];
  const legend = groups.some((g) => g.rows.some((r) => r.cells.some((c) => c.text === USUAL_CELL.text))) ? GRID_LEGEND : null;
  return { days, groups, checked, legend, compact: days.length > GRID_COMPACT_AFTER };
}

function hoursCell(v: string): GridCell {
  const short = phoneHours(v);
  return { kind: 'hours', text: v, ...(short !== v ? { short } : {}) };
}

export function closureGrid(page: HolidayPageData): ClosureGridView | null {
  const facts = page.facts.filter((f): f is ConfirmedFact & { days: Record<string, string> } => f.status === 'confirmed' && !!f.days);
  return gridFromRows(page, facts.map((f) => ({
    fact: f,
    cells: Object.fromEntries(Object.entries(f.days).map(([iso, v]): [string, GridCell] => [iso, v === 'closed' ? { kind: 'closed', text: 'Closed' } : hoursCell(v)])),
  })));
}

/** The closures grid of a season page (Glasgow Christmas, owner 2026-11-21): its data rows are one per place and value with `on`
 *  (what the day cards showed), merged per place in data order. A 'closed' row is Closed with its own word (ScotRail "No trains"),
 *  an 'open' row is the place's usual hours on those days (plain, not bold, left out of the phone card), anything else is changed
 *  hours. Each place links to the page its first row was read from. */
/** MAX_CLOSED_LINE places in a day's closures line, then "+N more". */
export const MAX_CLOSED_LINE = 3;

/** A season day without events (owner 2026-11-21): one line of what is shut that day, from the closures grid, closures only:
 *  "St Enoch closed · Glasgow Green closed · No trains" (a place's own word when the source has one, else "<short name> closed"),
 *  at most MAX_CLOSED_LINE, then "+N more". `source`: the first of those places' pages. Null when nothing is shut that day. */
export function gridClosedLine(grid: ClosureGridView | null, iso: string): { text: string; source: string } | null {
  const i = grid?.days.findIndex((d) => d.iso === iso) ?? -1;
  if (!grid || i < 0) return null;
  const shut = grid.groups.flatMap((g) => g.rows).filter((r) => r.cells[i].kind === 'closed');
  if (shut.length === 0) return null;
  const words = shut.map((r) => (r.cells[i].text === 'Closed' ? `${r.short ?? r.name} closed` : r.cells[i].text));
  const more = words.length - MAX_CLOSED_LINE;
  const text = words.slice(0, MAX_CLOSED_LINE).join(' · ') + (more > 0 ? ` · +${more} more` : '');
  return { text, source: shut.find((r) => r.href)?.href ?? '' };
}

export function seasonClosureGrid(page: HolidayPageData): ClosureGridView | null {
  const rows = new Map<string, GridSourceRow>();
  for (const f of page.facts) {
    if (f.status !== 'confirmed' || !f.on || f.section === 'hours' || f.section === 'help') continue;
    const r = rows.get(f.label) ?? { fact: f, href: f.source.url, cells: {} };
    if (f.dayShort && !r.fact.dayShort) r.fact = { ...r.fact, dayShort: f.dayShort };
    const cell: GridCell = f.change === 'closed' ? { kind: 'closed', text: f.value }
      : f.change === 'open' ? { kind: 'usual', text: f.value }
      : hoursCell(f.value);
    for (const iso of f.on) r.cells[iso] = cell;
    rows.set(f.label, r);
  }
  return gridFromRows(page, [...rows.values()]);
}

/** Status line under the holiday page's photo band (owner 2026-11-20, Tillägg A): the date and how far away it is, in normal
 *  heading size, never a display number ("8 places closed" and "Friday" were display numbers that were not measurements).
 *  "Thursday, Nov 26 · 6 days away" (en-GB "Friday 25 Dec · 35 days away"); a past day counts back ("Wednesday, Nov 11 ·
 *  9 days ago", owner 2026-11-20). The year is added only when the day is not in `today`'s year.
 *  `dayMs` = the day at UTC midnight, `today` = local ISO date. */
export function holidayStatus(dayMs: number, today: string, locale: HolidayLocale = 'en-US'): string {
  const n = Math.round((dayMs - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return `${holidayStatusDate(dayMs, today, locale)} · ${relWords(n, 'away')}`;
}

/** The status line's date part, all the page prints at build (Fas 3): "Thursday, Nov 26". The "· 6 days away" after it is written by
 *  the browser from the same day (lib/client/time-status.ts, style 'away'), so the page never counts from the build's clock.
 *  holidayStatus above is the whole line for one `today` (the browser's result, used by the tests). */
export function holidayStatusDate(dayMs: number, today: string, locale: HolidayLocale = 'en-US'): string {
  const dayIso = new Date(dayMs).toISOString().slice(0, 10);
  const withYear = dayIso.slice(0, 4) !== today.slice(0, 4);
  return withYear ? formatDayLong(dayMs, locale) : `${weekdayLong(dayMs)}${locale === 'en-GB' ? ' ' : ', '}${formatDayShort(dayMs, locale)}`;
}

/** Which day the status line names (owner 2026-11-20): after the holiday the passed day ("9 days ago") stays until the page
 *  has data for the next year; only then does it switch to the next date and count down. `seasonDay` = the day of the page's
 *  data season, `nextYear`/`nextDay` = the next occurrence (null inside the window). Data older than the season just passed
 *  shows the next date, so a page never counts back over a year. */
export function statusDay(seasonDay: number, pageYear: number, nextYear: number | null, nextDay: number | null): number {
  if (nextYear === null || nextDay === null || nextYear <= pageYear) return seasonDay;
  return nextYear === pageYear + 1 ? seasonDay : nextDay;
}

/** One entry per distinct source page, in order of first use, named by the organization ("City and County of Broomfield");
 *  two pages of the same organization keep their page title so the entries stay apart. Pages that would still show the
 *  same name (two event pages of one venue, "Farm House Collective") are one entry, linked to the first (owner 2026-11-14). */
export function groupSources(page: HolidayPageData): { name: string; href: string }[] {
  const all: Source[] = [];
  const add = (s: Source | undefined) => { if (s && !all.some((x) => x.url === s.url)) all.push(s); };
  for (const f of page.facts) { add(f.source); if (f.status === 'unconfirmed') add(f.lastYear?.source); }
  for (const e of page.events) { add(e.source); if (e.status === 'unconfirmed') add(e.lastYear?.source); }
  const org = (s: Source) => s.name.split(':')[0].trim();
  const named = all.map((s) => ({ name: all.filter((x) => org(x) === org(s)).length > 1 ? s.name : org(s), href: s.url }));
  return named.filter((s, i) => named.findIndex((x) => x.name === s.name) === i);
}

/** /holidays/ (F9, 2026-11-11): one sentence per holiday saying what is shut on the day, from the confirmed rows of the
 *  page's own season. `nextDay` is the next occurrence; when it is in a later year than the data, the sentence names
 *  the season it describes. Null when no place is confirmed closed on the day (no filler sentence). */
export function holidayOverviewLine(page: HolidayPageData, def: HolidayPageDef, nextDay: number): string | null {
  const day = new Date(occurrenceDay(def, page.year)).toISOString().slice(0, 10);
  const names = countHeld(page) ? [] : closedPlaceRows(page, day).map((f) => f.label);
  if (names.length === 0) return null;
  const sameSeason = new Date(nextDay).getUTCFullYear() === page.year;
  return `${sameSeason ? 'Closed' : `Closed in ${page.year}`}: ${listWords(names)}.`;
}
