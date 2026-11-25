/** Browser side of the Open tonight list (components/OpenTonightList.astro, owner 2026-11-25). For `now`:
 *   - a place that has closed (data-end passed) is hidden;
 *   - "closes soon" shows when less than CLOSES_SOON_MS is left;
 *   - the kind chip (data-otl-chip) keeps only that kind (data-kind);
 *   - each group shows at most OPEN_TONIGHT_GROUP_MAX of what is left, then a "Show all (N)" button; a group with nothing left goes,
 *     heading included, and the whole list goes when no place is left.
 *  Without JavaScript every row shows, with no status. Rows are hidden here with classes, never `hidden`, so /tonight's own area chips
 *  (lib/tonight-cards-client.ts, which set `hidden`) and this list never undo each other. */
import { CLOSES_SOON_MS, OPEN_TONIGHT_GROUP_MAX } from '../open-tonight-list';

export interface OtlRow {
  dataset: DOMStringMap;
  hidden: boolean;
  classList: { toggle(c: string, on: boolean): void; contains(c: string): boolean };
  querySelector(sel: string): { hidden: boolean } | null;
}
export interface OtlGroup {
  dataset: DOMStringMap;
  hidden: boolean;
  querySelectorAll(sel: string): ArrayLike<OtlRow>;
  querySelector(sel: string): { hidden: boolean; textContent: string | null } | null;
}

/** One group for `now`, the selected kind ('' = all) and whether the visitor opened it. Returns how many rows are left (before the limit). */
export function applyGroup(g: OtlGroup, now: number, kind: string, open: boolean): number {
  const rows = Array.from(g.querySelectorAll('[data-otl-row]'));
  const left: OtlRow[] = [];
  for (const r of rows) {
    const end = Date.parse(r.dataset.end ?? '');
    const closed = Number.isFinite(end) && end <= now;
    r.classList.toggle('otl-row--closed', closed);
    const soon = r.querySelector('[data-otl-soon]');
    if (soon) soon.hidden = closed || !Number.isFinite(end) || end - now >= CLOSES_SOON_MS;
    const match = !kind || r.dataset.kind === kind;
    r.classList.toggle('otl-row--off', !match);
    // `hidden` belongs to /tonight's area chips: a row they hid does not count here
    if (!closed && match && !r.hidden) left.push(r);
  }
  left.forEach((r, i) => r.classList.toggle('otl-row--more', !open && i >= OPEN_TONIGHT_GROUP_MAX));
  rows.filter((r) => !left.includes(r)).forEach((r) => r.classList.toggle('otl-row--more', false));
  const btn = g.querySelector('[data-otl-all]');
  if (btn) {
    btn.hidden = open || left.length <= OPEN_TONIGHT_GROUP_MAX;
    btn.textContent = `Show all (${left.length})`;
  }
  g.hidden = left.length === 0;
  return left.length;
}

function countOpen(list: HTMLElement, now: number): number {
  return Array.from(list.querySelectorAll<HTMLElement>('[data-otl-row]')).filter((r) => {
    const end = Date.parse(r.dataset.end ?? '');
    return !(Number.isFinite(end) && end <= now);
  }).length;
}

/** Every [data-otl] list on the page. */
export function applyOpenTonightLists(doc: Document, now: number): void {
  doc.querySelectorAll<HTMLElement>('[data-otl]').forEach((list) => {
    const kind = list.dataset.otlKind ?? '';
    let total = 0;
    list.querySelectorAll<HTMLElement>('[data-otl-group]').forEach((g) => {
      total += applyGroup(g as unknown as OtlGroup, now, kind, g.dataset.otlOpen === '1');
    });
    // Owner 2026-11-07: the section exists only with at least OPEN_TONIGHT_MIN_PLACES (data-otl-min, lib/open-tonight.ts) places still
    // open, heading and note included.
    // A chip narrowing the list never removes it: the minimum is counted over every kind.
    const open = kind ? countOpen(list, now) : total;
    const scope = list.closest<HTMLElement>('[data-otl-scope]') ?? list;
    scope.hidden = open < (Number(list.dataset.otlMin) || 1);
  });
}

/** Chip and "Show all" clicks (one listener for the page). */
export function wireOpenTonightLists(doc: Document): void {
  doc.addEventListener('click', (e) => {
    const t = e.target as Element | null;
    const chip = t?.closest<HTMLElement>('[data-otl-chip]');
    const all = t?.closest<HTMLElement>('[data-otl-all]');
    // /tonight's area chips hide rows by area: recount after their handler has run
    if (t?.closest('[data-tc-chip]')) { setTimeout(() => applyOpenTonightLists(doc, Date.now()), 0); return; }
    const list = (chip ?? all)?.closest<HTMLElement>('[data-otl]');
    if (!list) return;
    if (chip) {
      list.dataset.otlKind = chip.dataset.otlChip ?? '';
      list.querySelectorAll<HTMLElement>('[data-otl-chip]').forEach((c) => c.setAttribute('aria-pressed', c === chip ? 'true' : 'false'));
    }
    if (all) all.closest<HTMLElement>('[data-otl-group]')!.dataset.otlOpen = '1';
    applyOpenTonightLists(doc, Date.now());
  });
}
