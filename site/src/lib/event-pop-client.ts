/** Browser side of the event and calendar lists, from the real clock in the TOWN's timezone:
 *  - fills in "Today / Tomorrow / In N days" (nothing is printed at build time: a static page goes stale; without JavaScript there is no label);
 *  - removes rows that are over, as the older lists did (an item with an end counts until its end, so a multi-day item that is on stays);
 *  - keeps the date tile on the first row of each day that is still shown (the server puts it on the day's first row; when that row has gone, the
 *    next one carries it).
 *  Rows carry data-pop-row plus data-start (+ data-end) for events or data-day for calendar dates, data-day-key (the local day) and a [data-pop-tile]
 *  box; the label slot is [data-pop-rel]. */
import { isOver, relativeDayLabel, relativeDayLabelForDate } from './event-pop';

export function applyEventPop(doc: Document, now: Date, tz: string): void {
  const dayHasTile = new Set<string>();
  doc.querySelectorAll<HTMLElement>('[data-pop-row]').forEach((row) => {
    const rowTz = row.dataset.tz || tz;
    const over = row.dataset.start ? isOver({ start: row.dataset.start, end: row.dataset.end || null }, now, rowTz) : false;
    row.hidden = over;
    const slot = row.querySelector<HTMLElement>('[data-pop-rel]');
    let label: string | null = null;
    if (!over) label = row.dataset.day ? relativeDayLabelForDate(row.dataset.day, now, rowTz) : row.dataset.start ? relativeDayLabel(row.dataset.start, now, rowTz) : null;
    if (slot) { slot.textContent = label ?? ''; slot.hidden = !label; }
    const key = row.dataset.dayKey;
    if (key && !over) {
      row.querySelector<HTMLElement>('[data-pop-tile]')?.classList.toggle('tile--dup', dayHasTile.has(key));
      dayHasTile.add(key);
    }
  });
}
