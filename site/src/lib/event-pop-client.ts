/** Browser side of the event and calendar lists: fills in "Today / Tomorrow / In N days" and dims what is already over today, from the real clock in
 *  the TOWN's timezone. Without JavaScript none of it appears and nothing is wrong (the build never prints a relative word: a static page goes stale).
 *  Rows carry data-pop-row plus data-start (+ data-end) for events or data-day for calendar dates; the label slot is [data-pop-rel]. */
import { isOverToday, relativeDayLabel, relativeDayLabelForDate } from './event-pop';

export function applyEventPop(doc: Document, now: Date, tz: string): void {
  doc.querySelectorAll<HTMLElement>('[data-pop-row]').forEach((row) => {
    const rowTz = row.dataset.tz || tz;
    const slot = row.querySelector<HTMLElement>('[data-pop-rel]');
    let label: string | null = null;
    if (row.dataset.day) label = relativeDayLabelForDate(row.dataset.day, now, rowTz);
    else if (row.dataset.start) {
      const over = isOverToday({ start: row.dataset.start, end: row.dataset.end || null }, now, rowTz);
      row.classList.toggle('is-over', over);
      label = over ? null : relativeDayLabel(row.dataset.start, now, rowTz);
    }
    if (slot) { slot.textContent = label ?? ''; slot.hidden = !label; }
  });
}
