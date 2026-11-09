/** Flat day rows (further out, nearby, coming up) grouped by their local day, in the order given, so the same date-tile list can print them:
 *  the tile sits on the first row of each day. A pure reshaping; nothing is added or dropped. */
import type { DayGroup, DayRow } from './event-day-view';

export function groupRowsByDay(rows: DayRow[]): DayGroup[] {
  const out: DayGroup[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last.dayKey === r.dayKey) { last.rows.push(r); last.count++; continue; }
    out.push({ offset: r.offset, dayKey: r.dayKey, label: '', weekday: '', dateLabel: r.dateLabel, count: 1, rows: [r] });
  }
  return out;
}
