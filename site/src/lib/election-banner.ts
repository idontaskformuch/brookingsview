/** Browser side of the "Election results" card (ResultsBanner.astro): shows it inside its window, hides it
 *  outside, and switches the text when the polls close. The build ships the same instants as data-*, so a
 *  page that is days old still disappears on time without a deploy. */
export function updateResultsBanner(doc: Document, nowMs: number): void {
  doc.querySelectorAll<HTMLElement>('[data-results-banner]').forEach((el) => {
    const from = Date.parse(el.dataset.showFrom || '');
    const until = Date.parse(el.dataset.showUntil || '');
    const swap = Date.parse(el.dataset.swapAt || '');
    if (Number.isNaN(from) || Number.isNaN(until)) return;
    el.hidden = !(nowMs >= from && nowMs < until);
    const text = el.querySelector('.results-banner__text');
    const next = !Number.isNaN(swap) && nowMs >= swap ? el.dataset.after : el.dataset.before;
    if (text && next) text.textContent = next;
  });
}

export function watchResultsBanner(doc: Document, setTimer: (fn: () => void, ms: number) => unknown = setInterval, now: () => number = Date.now): void {
  updateResultsBanner(doc, now());
  setTimer(() => updateResultsBanner(doc, now()), 60_000);
}
