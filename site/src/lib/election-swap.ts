/** CityStatus election row: "How to vote" turns into the results link when the polls close (the build
 *  ships data-swap-* on the row, see lib/election.ts buildElectionStatus). Lives here, not inline, so a
 *  test can run the shipped code in a real browser with a fake clock (election-swap.test.ts). */

/** Swap every row whose instant has passed; returns how many rows are still waiting. */
export function swapElectionRows(doc: Document, nowMs: number): number {
  let waiting = 0;
  doc.querySelectorAll<HTMLElement>('[data-swap-at]').forEach((li) => {
    if (li.dataset.swapped) return;
    const at = Date.parse(li.dataset.swapAt || '');
    if (Number.isNaN(at)) return;
    if (nowMs < at) { waiting++; return; }
    const value = li.querySelector('.city-status__value');
    const link = li.querySelector<HTMLAnchorElement>('a.city-status__link');
    if (value && li.dataset.swapValue) value.textContent = li.dataset.swapValue;
    if (link && li.dataset.swapHref) link.href = li.dataset.swapHref;
    li.dataset.swapped = 'yes';
  });
  return waiting;
}

/** Checks now and then every minute until nothing is waiting, so a tab left open across the closing flips. */
export function watchElectionRows(doc: Document, setTimer: (fn: () => void, ms: number) => unknown = setInterval, clearTimer: (h: never) => void = clearInterval as never, now: () => number = Date.now): void {
  if (swapElectionRows(doc, now()) === 0) return;
  const handle = setTimer(() => { if (swapElectionRows(doc, now()) === 0) clearTimer(handle as never); }, 60_000);
}
