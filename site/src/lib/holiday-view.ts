/** View model of a holiday page (components/HolidayPage.astro): hero, grouped rows, one source list. Pure: everything is
 *  derived from the page data (lib/holiday-page.ts) and the date rule; nothing is read out of free text except one
 *  conservative rule for a leading "Closed" (detailFor), and no model text is involved.
 *
 *  Question it answers for a resident: what is closed, what changed, what runs as usual on <holiday>, and what is not
 *  confirmed yet. Layout: .claude/standards.md "Helgsidor". */
import {
  eventWhenWhere, formatIsoDate, isEventPast, lastChecked, listWords, regularHours,
  type CheckAt, type ConfirmedFact, type HolidayChange, type HolidayEvent, type HolidayFact, type HolidayLocale, type HolidayPageData, type LastYear, type Source,
} from './holiday-page';
import { formatDayLong, formatDayShort, occurrenceDay, weekdayLong } from './holiday-calendar';
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

export type GroupId = 'closed' | 'changed' | 'open' | 'info' | 'events' | 'unconfirmed';
export interface GroupView { id: GroupId; heading: string; rows: RowView[] }

/** Render order of the groups; a group without rows is not rendered. */
export const GROUP_ORDER: GroupId[] = ['closed', 'changed', 'open', 'info', 'events', 'unconfirmed'];
export const GROUP_HEADING: Record<GroupId, string> = {
  closed: 'Closed',
  changed: 'Schedule changes',
  open: 'Open as usual',
  info: 'Good to know',
  events: 'Events',
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
    parts: [eventWhenWhere(e, page.locale), ...((past && e.pastDetails) || e.details || []), ...(e.clarify ? [e.clarify] : [])],
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
  const rows: Record<GroupId, RowView[]> = { closed: [], changed: [], open: [], info: [], events: [], unconfirmed: [] };
  for (const f of page.facts) {
    if (f.section === 'hours') continue;
    const id: GroupId = f.status === 'unconfirmed' ? 'unconfirmed' : (f.change ?? 'info');
    rows[id].push(factRow(f, page, newest, over));
  }
  for (const e of page.events) rows[e.status === 'confirmed' ? 'events' : 'unconfirmed'].push(eventRow(e, page, newest, today));
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

/** The count (and the /holidays/ "Closed: ..." line) waits for a `holdsCount` row that is still unconfirmed. */
export function countHeld(page: HolidayPageData): boolean {
  return page.facts.some((f) => f.holdsCount && f.status === 'unconfirmed');
}

export const MAX_INSIGHTS = 2;
/** Lines under the hero, written in the data on the rows that change what people plan around (a moved pickup).
 *  They speak of the day, so none once it is over (`over`). */
export function holidayInsights(page: HolidayPageData, over = false): string[] {
  if (over) return [];
  return page.facts.flatMap((f) => (f.status === 'confirmed' && f.insight ? [f.insight] : [])).slice(0, MAX_INSIGHTS);
}

export interface HeroView { value: string | number; unit?: string; label: string; sub: string }

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
    rows[f.change].push({ name: f.label, pill: PILL[f.change], parts: f.standing ? [f.standing] : [] });
  }
  return order.filter((c) => rows[c].length > 0).map((c) => ({ id: c, heading: TIMELESS_HEADING[c], rows: rows[c] }));
}

/** "Veterans Day is Thursday" over the next date with its year; no count (a count belongs to one day). */
export function timelessHero(label: string, nextDay: number, locale: HolidayLocale = 'en-US'): HeroView {
  return { value: weekdayLong(nextDay), label: `${label} is`, sub: formatDayLong(nextDay, locale) };
}
/** "<Holiday> is <weekday>" with the number of places closed as the hero value. With no confirmed closed place the weekday
 *  itself is the hero (never "0 places closed"). `dayMs` is the holiday in the page's year (UTC midnight), `today` the
 *  local ISO date; a holiday before today reads "was" and carries its year. */
export function holidayHero(page: HolidayPageData, label: string, dayMs: number, today: string): HeroView {
  const past = new Date(dayMs).toISOString().slice(0, 10) < today;
  const named = past ? `${label} ${page.year}` : label;
  const verb = past ? 'was' : 'is';
  const weekday = weekdayLong(dayMs);
  const n = countHeld(page) ? 0 : closedPlaces(page, new Date(dayMs).toISOString().slice(0, 10));
  const sub = formatDayShort(dayMs, page.locale);
  if (n > 0) return { value: n, unit: n === 1 ? 'place closed' : 'places closed', label: `${named} ${verb} ${weekday}`, sub };
  return { value: weekday, label: `${named} ${verb}`, sub: past ? formatDayLong(dayMs, page.locale) : sub };
}

/** One entry per distinct source page, in order of first use, named by the organization ("City and County of Broomfield");
 *  two pages of the same organization keep their page title so the entries stay apart. */
export function groupSources(page: HolidayPageData): { name: string; href: string }[] {
  const all: Source[] = [];
  const add = (s: Source | undefined) => { if (s && !all.some((x) => x.url === s.url)) all.push(s); };
  for (const f of page.facts) { add(f.source); if (f.status === 'unconfirmed') add(f.lastYear?.source); }
  for (const e of page.events) { add(e.source); if (e.status === 'unconfirmed') add(e.lastYear?.source); }
  const org = (s: Source) => s.name.split(':')[0].trim();
  return all.map((s) => ({ name: all.filter((x) => org(x) === org(s)).length > 1 ? s.name : org(s), href: s.url }));
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
