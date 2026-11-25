/** Designsystem Fas 3 (owner spec 2026-11-20): /events/'s "N things on today · N tonight · N free" is counted HERE, in the browser, from
 *  the entries the page carries (data-evg-entries: every listed entry's occurrences and whether it is free) and the town's zone. The
 *  build's count went wrong as the day went on (events ended, the day turned over before the next build). Without JavaScript the block
 *  is not shown at all (like the header ticker's count): the day strip and the day lists below still say what is on each date.
 *  Counting rule: THE "events today" (lib/local-day.ts countEventsToday); "tonight" = an entry with an occurrence in tonight's bucket. */
import { bucketOf, countEventsToday, hasEnded, localDayNumber, type TimedEvent } from '../local-day';
import { eventsStrings, thingsOnToday } from '../events-strings';
import { heroHtml } from '../ui/ui-html';

export interface GlanceEntry { occ: TimedEvent[]; free?: boolean }

export interface GlanceCounts {
  today: number;
  tonight: number;
  free: number;
  /** The first later town day with something on, and how many entries are on it. */
  next: { day: number; count: number } | null;
}

export function glanceCounts(entries: GlanceEntry[], now: Date, tz: string): GlanceCounts {
  const todayNo = localDayNumber(now, tz);
  let tonight = 0;
  let free = 0;
  const later = new Map<number, number>();
  for (const e of entries) {
    const buckets = e.occ.map((o) => bucketOf(o, now, tz));
    const on = buckets.some((b) => b === 'today' || b === 'tonight');
    if (on && buckets.includes('tonight')) tonight++;
    if (on && e.free) free++;
    const days = new Set(e.occ.filter((o) => !hasEnded(o, now, tz)).map((o) => localDayNumber(new Date(o.start), tz)).filter((d) => d > todayNo));
    for (const d of days) later.set(d, (later.get(d) ?? 0) + 1);
  }
  const today = countEventsToday(entries.map((e) => ({ occ: e.occ })), now, tz).town;
  const first = [...later.keys()].sort((a, b) => a - b)[0];
  return { today, tonight, free, next: first === undefined ? null : { day: first, count: later.get(first)! } };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** "YYYY-MM-DD" of a day number. */
export const ymdOfDay = (day: number): string => new Date(day * 86_400_000).toISOString().slice(0, 10);

/** The top of the glance for these counts: the hero (from `heroMin` things) or a plain heading, or the pointer to the next day that has
 *  something when nothing is left today, or '' (nothing to say: the block stays hidden). */
export function glanceHtml(c: GlanceCounts, o: { country: 'us' | 'gb'; heroMin: number; base: string; idPrefix: string; todayNo: number }): string {
  if (c.today > 0) {
    const sub = [c.tonight > 0 && c.tonight < c.today ? `${c.tonight} tonight` : null, c.free > 0 ? `${c.free} free` : null].filter(Boolean).join(' · ');
    const unit = thingsOnToday(c.today, o.country);
    if (c.today >= o.heroMin) return heroHtml({ value: c.today, unit, sub: sub || undefined });
    return `<div class="evg__plain"><h2 class="evg__title">${c.today} ${esc(unit)}</h2>${sub ? `<p class="evg__sub">${esc(sub)}</p>` : ''}</div>`;
  }
  if (!c.next) return '';
  const ymd = ymdOfDay(c.next.day);
  const label = c.next.day - o.todayNo === 1 ? 'Tomorrow'
    : new Intl.DateTimeFormat(o.country === 'gb' ? 'en-GB' : 'en-US', { weekday: 'short', timeZone: 'UTC' }).format(new Date(c.next.day * 86_400_000));
  const link = `${label}: ${c.next.count} ${c.next.count === 1 ? 'thing' : 'things'}`;
  return `<div class="ui-empty"><p class="ui-empty__line">Next on the calendar:</p><a class="ui-empty__link" href="${esc(`${o.base}#${o.idPrefix}-${ymd}`)}">${esc(link)}</a></div>`;
}

/** Fills every [data-evg] block on the page. */
export function applyEventsGlance(doc: Document, now: Date): void {
  doc.querySelectorAll<HTMLElement>('[data-evg]').forEach((root) => {
    const slot = root.querySelector<HTMLElement>('[data-evg-top]');
    if (!slot) return;
    let entries: GlanceEntry[];
    try { entries = JSON.parse(root.dataset.evgEntries || '[]'); } catch { return; }
    const tz = root.dataset.tz || doc.documentElement.dataset.timezone || 'UTC';
    const country = root.dataset.country === 'gb' ? 'gb' : 'us';
    const html = glanceHtml(glanceCounts(entries, now, tz), {
      country, heroMin: Number(root.dataset.heroMin) || eventsStrings(country).hero_min_count,
      base: root.dataset.base ?? '', idPrefix: root.dataset.idPrefix || 'day', todayNo: localDayNumber(now, tz),
    });
    slot.innerHTML = html;
    slot.hidden = html === '';
    root.hidden = html === '' && !root.querySelector('[data-evg-strip]');
  });
}
