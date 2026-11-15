/** The holiday group of the evening layer (owner 2026-11-15, .claude/specs/evening-season-group-and-unknown-state-2026-11-15.md): while a
 *  holiday page's window is open, /tonight and /this-weekend get a group named after the holiday (its config label, "Christmas") that
 *  links to the page. It holds the page's confirmed rows that are on that evening and not already listed in another group: a run with
 *  opening hours (Winter Wonderland) on the evenings it is still open, with that day's hours; a timed event on its day(s). A row without
 *  a time is never placed on an evening. The evening layer's own time rules then apply (lib/evening-page.ts, lib/evening-weekend.ts),
 *  and the group counts toward the threshold like any other (lib/evening-items.ts toThresholdItems).
 *  Same for every town and holiday: nothing here names a town. Pure: no I/O, no clock. */
import type { HolidayPageData, OpenHoursRule } from './holiday-page';
import { formatClock, localIso, localToday } from './holiday-page';
import { sameShow, showTitleKey, type EveningEntry } from './evening-items';
import { DEFAULT_EVENT_MS, hasEnded } from './local-day';
import { EVENING_NIGHTS } from './evening-threshold';
import { HOLIDAY_PAGE_DEFS } from '../config/holiday-pages/calendar';
import { holidayPageFor, type HolidayPageEntry } from '../config/holiday-pages/registry';
import { resolvePageState } from './holiday-calendar';

/** An open holiday page as the evening layer reads it: the group's name and link, and the page with its rows. */
export interface SeasonSource { label: string; href: string; page: HolidayPageData }

/** The town's holiday pages whose window is open at `nowMs` (the page's own window, lib/holiday-calendar.ts). */
export function openHolidayPages(townId: string, nowMs: number, timezone: string): HolidayPageEntry[] {
  return HOLIDAY_PAGE_DEFS.flatMap((d) => {
    const entry = holidayPageFor(d.slug, townId);
    return entry && resolvePageState(entry.def, entry.page.year, nowMs, timezone).kind === 'active' ? [entry] : [];
  });
}

const DAY_MS = 86_400_000;
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const isoWeekday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay() || 7;

/** The hours of `date` (YYYY-MM-DD): the last rule that covers it; null when closed or not covered. */
export function hoursOn(rules: OpenHoursRule[], date: string): { open: string; close: string } | null {
  let hit: OpenHoursRule | null = null;
  for (const r of rules) if (date >= r.from && date <= r.to && (!r.days || r.days.includes(isoWeekday(date)))) hit = r;
  return hit?.open && hit.close ? { open: hit.open, close: hit.close } : null;
}

const venueKey = (v: string | null) => showTitleKey(v ?? '');

/** Already listed: the row the page matched from the town's calendar or Ticketmaster (same key), or the same show by start and title
 *  (lib/evening-items.ts sameShow), or the same start at the same venue (a hand row named differently from the feed's). */
function listedIn(existing: EveningEntry[], c: EveningEntry, fromCalendar: string | undefined): boolean {
  return existing.some((x) => (fromCalendar && (x.id === fromCalendar || x.id === `own:${fromCalendar}`))
    || sameShow(x, c)
    || (x.start === c.start && venueKey(x.venue) !== '' && venueKey(c.venue) !== '' && (venueKey(x.venue).includes(venueKey(c.venue)) || venueKey(c.venue).includes(venueKey(x.venue)))));
}

/** The rows of the open holiday pages for today and the next `days` days, minus what `existing` (the evening layer's own rows) already lists. */
export function seasonEveningEntries(sources: SeasonSource[], existing: EveningEntry[], o: { now: Date; timezone: string; days?: number }): EveningEntry[] {
  const today = localToday(o.now.getTime(), o.timezone);
  const last = addDays(today, o.days ?? EVENING_NIGHTS + 1);
  const out: EveningEntry[] = [];
  for (const { label, href, page } of sources) {
    for (const e of page.events) {
      if (e.status !== 'confirmed' || (!e.openHours && !e.startTime)) continue;
      for (let d = e.date < today ? today : e.date; d <= (e.endDate ?? e.date) && d <= last; d = addDays(d, 1)) {
        const h = e.openHours ? hoursOn(e.openHours, d) : null;
        if (e.openHours && !h) continue;
        const start = localIso(d, h ? h.open : e.startTime!, o.timezone);
        const endTime = h ? h.close : e.endTime;
        const row: EveningEntry = {
          id: `season:${page.holiday}|${showTitleKey(e.name)}|${venueKey(e.venue.name)}|${start}`,
          title: e.name, start: new Date(start).toISOString(), end: endTime ? new Date(localIso(d, endTime, o.timezone)).toISOString() : null,
          group: null, labels: [], venue: e.venue.name, href: e.url, source: 'season',
          distanceMiles: e.nearby?.miles ?? null, driveMinutes: null, checked: e.checkedOn, season: { label, href },
          ...(h ? { hours: `${formatClock(h.open, page.locale)}–${formatClock(h.close, page.locale)}` } : {}),
        };
        if (hasEnded({ start: row.start, end: row.end ?? new Date(Date.parse(row.start) + DEFAULT_EVENT_MS).toISOString() }, o.now, o.timezone)) continue;
        if (out.some((x) => x.id === row.id) || listedIn(existing, row, e.fromCalendar)) continue;
        out.push(row);
      }
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}
