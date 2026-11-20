/** Browser helper (owner 2026-11-07, shared since 2026-11-20): keep the list items whose opening range (data-start/data-end, ISO instants)
 *  includes this moment, and show the block only when at least `min` are open. Progressive: without JS the block stays hidden, so nothing
 *  is claimed. Used by OpenTonight's cafe list on /today and the rail's Open now module. */
export function isOpenAt(li: HTMLElement, now: number): boolean {
  const s = Date.parse(li.dataset.start ?? ''), e = Date.parse(li.dataset.end ?? '');
  return Number.isFinite(s) && Number.isFinite(e) && s <= now && now < e;
}

export function revealOpenNow(block: HTMLElement, min: number, max = Infinity, now = Date.now()): number {
  const open = [...block.querySelectorAll<HTMLElement>('li')].filter((li) => isOpenAt(li, now)).slice(0, max);
  if (open.length < min) return 0;
  open.forEach((li) => { li.hidden = false; });
  block.hidden = false;
  return open.length;
}
