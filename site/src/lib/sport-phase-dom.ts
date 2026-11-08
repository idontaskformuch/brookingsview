/** Brings a page's sport rows up to date in the browser. The phase of every row is decided by lib/sport-events.ts (the same module the
 *  build uses, so the rules exist once); this file only reads the row's data-* attributes and writes the result cell. Without JavaScript the
 *  build-time phase stays, which is correct as of the build. No live data and no live score: only the clock is consulted. */
import { rowNote, sportPhase, isOpen, type RowNote, type SportEventLike, type SportPhase } from './sport-events';

/** The data-* attributes a row carries (GameTable.astro writes them). */
export interface RowData {
  sport?: string; start?: string; tz?: string; status?: string; tba?: string; result?: string; section?: string;
}

const STATUSES = ['scheduled', 'final', 'postponed', 'cancelled'] as const;

export function eventOf(d: RowData): SportEventLike | null {
  if (!d.sport || !d.start || !d.tz) return null;
  const startAt = new Date(d.start);
  const status = STATUSES.find((s) => s === d.status);
  if (Number.isNaN(startAt.getTime()) || !status) return null;
  return { sport: d.sport, startAt, tz: d.tz, status, timeTba: d.tba === '1', exhibition: false, scoreHome: null, scoreAway: null, homeProgramId: null, awayProgramId: null };
}

export interface RowUpdate {
  phase: SportPhase;
  /** The key of the word for the result cell, or null to leave the cell as it is (a result, or still just upcoming). */
  note: RowNote;
  /** A row listed under Schedule that is now history belongs under Results. */
  toResults: boolean;
}

export function updateFor(d: RowData, now: Date): RowUpdate | null {
  const ev = eventOf(d);
  if (!ev) return null;
  const phase = sportPhase(ev, now);
  return { phase, note: rowNote(ev.status, phase, d.result === '1'), toResults: d.section === 'schedule' && !isOpen(phase) };
}

const data = (el: HTMLElement): RowData => ({
  sport: el.dataset.sport, start: el.dataset.start, tz: el.dataset.tz, status: el.dataset.status, tba: el.dataset.tba,
  result: el.dataset.result, section: el.dataset.section,
});

export function refreshSportPhases(root: ParentNode, now: Date = new Date()): void {
  const holder = root.querySelector<HTMLElement>('[data-sport-terms]');
  if (!holder) return;
  let terms: Record<string, string> = {};
  try { terms = JSON.parse(holder.dataset.sportTerms ?? '{}'); } catch { return; }

  for (const tr of Array.from(root.querySelectorAll<HTMLElement>('tr[data-start]'))) {
    const u = updateFor(data(tr), now);
    if (!u) continue;
    tr.dataset.phase = u.phase;
    const cell = tr.querySelector<HTMLElement>('[data-note]');
    if (cell && tr.dataset.result !== '1') cell.textContent = u.note ? (terms[u.note] ?? '—') : '—';
    if (u.toResults) moveToResults(tr);
  }
  for (const wrap of Array.from(root.querySelectorAll<HTMLElement>('[data-schedule]'))) {
    if (!wrap.querySelector('tr[data-start]')) wrap.hidden = true;
  }
  const next = root.querySelector<HTMLElement>('[data-next-up]');
  if (next) {
    const u = updateFor(data(next), now);
    if (u && u.phase !== 'upcoming' && u.phase !== 'inProgress') next.hidden = true;
    const tag = next.querySelector<HTMLElement>('[data-next-tag]');
    if (u && tag && u.phase === 'inProgress') { tag.textContent = ` · ${terms.in_progress}`; tag.hidden = false; }
  }
}

/** Newest first, like the Results table the build writes. A group with no Results table keeps the row where it is (its note is already right). */
function moveToResults(tr: HTMLElement): void {
  const group = tr.closest<HTMLElement>('[data-group]');
  const body = group?.querySelector<HTMLElement>('[data-results] tbody');
  if (!body) return;
  const t = Date.parse(tr.dataset.start ?? '');
  const before = Array.from(body.querySelectorAll<HTMLElement>('tr[data-start]')).find((r) => Date.parse(r.dataset.start ?? '') < t);
  body.insertBefore(tr, before ?? null);
  tr.dataset.section = 'results';
}
