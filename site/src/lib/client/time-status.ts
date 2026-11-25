/** Designsystem Fas 3 (owner spec 2026-11-20, "Tidsberoende status"): a static page never prints a word that goes wrong during the
 *  day. "today" / "tomorrow" / "in 3 days" / "6 days away" are written HERE, in the visitor's browser, from a town-local date in the
 *  HTML (data-rel-day="YYYY-MM-DD") and the TOWN's zone (<html data-timezone>), never the visitor's zone or the build's clock.
 *
 *  Markup contract:
 *   - data-rel-day="YYYY-MM-DD"   the town-local day the words are about.
 *   - data-rel-style              'in' (default: today / tomorrow / in N days / yesterday / N days ago),
 *                                 'away' (today / tomorrow / N days away / yesterday / N days ago),
 *                                 'day' (Today / Tomorrow; any other day keeps the element's own text, e.g. "Thu").
 *   - data-rel-prefix             text put before the words (" · ").
 *   - data-rel-past="hide"        a day before today hides the closest [data-rel-scope] (or the element).
 *  Fallback without JavaScript (the spec: never a status computed at build): an element with only relative words is rendered
 *  empty and `hidden`, so the absolute date beside it is all a reader sees; a 'day' element holds the absolute weekday/date.
 *  Called once on load and every minute by layouts/BaseLayout.astro, so an open tab rolls over at midnight. */
import { localDayNumber } from '../local-day';

export type RelStyle = 'in' | 'away' | 'day';

/** Day number (days since epoch) of a plain "YYYY-MM-DD", or null when it is not one. */
export function ymdDayNumber(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86_400_000) : null;
}

/** "YYYY-MM-DD" of a day number (days since epoch, as lib/local-day.ts localDayNumber gives): what a page writes into data-rel-day. */
export const ymdOfDayNumber = (day: number): string => new Date(day * 86_400_000).toISOString().slice(0, 10);

/** Whole town-local days from today to `ymd` (0 = today, negative = past), or null for a malformed date. */
export function daysFromToday(ymd: string, now: Date, tz: string): number | null {
  const day = ymdDayNumber(ymd);
  return day === null ? null : day - localDayNumber(now, tz);
}

/** The words for a day `n` days from today; null = keep the element's own text (style 'day' beyond tomorrow, or in the past). */
export function relWords(n: number, style: RelStyle = 'in'): string | null {
  if (style === 'day') return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : null;
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  if (n < 0) return `${-n} days ago`;
  return style === 'away' ? `${n} days away` : `in ${n} days`;
}

interface RelEl {
  dataset: DOMStringMap;
  textContent: string | null;
  hidden: boolean;
  closest?: (sel: string) => { hidden: boolean } | null;
}

/** Writes every [data-rel-day] in `root` for `now` in `tz`. Returns how many were written (tests). */
export function applyRelDays(root: Pick<Document, 'querySelectorAll'>, now: Date, tz: string): number {
  let written = 0;
  root.querySelectorAll<HTMLElement>('[data-rel-day]').forEach((node) => {
    const el = node as unknown as RelEl;
    const n = daysFromToday(el.dataset.relDay ?? '', now, tz);
    if (n === null) return;
    if (n < 0 && el.dataset.relPast === 'hide') {
      (el.closest?.('[data-rel-scope]') ?? el).hidden = true;
      return;
    }
    const words = relWords(n, (el.dataset.relStyle as RelStyle | undefined) ?? 'in');
    if (words === null) return;
    el.textContent = (el.dataset.relPrefix ?? '') + words;
    el.hidden = false;
    written++;
  });
  return written;
}
