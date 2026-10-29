/** Browser side of /tonight and /this-weekend: the build can be hours old, so after the hide-ended sweep the summary line is
 *  re-counted from what is still visible, and the last-train time follows the real weekday. Pure DOM, no network. */

/** Things still on: visible rows and cards inside visible day sections, Open late rows left out (they are places, not events). */
export function countVisibleThings(doc: Document): number {
  let n = 0;
  doc.querySelectorAll<HTMLElement>('.ev-day:not([hidden]) [data-start]:not([data-late])').forEach((el) => {
    if (el.hidden || el.closest('[hidden]')) return;
    n += 1;
  });
  return n;
}

export function refreshSummary(doc: Document, tz: string, now: Date, periodWord: (doc: Document) => string): void {
  const text = doc.querySelector<HTMLElement>('[data-sum-text]');
  if (text) {
    const n = countVisibleThings(doc);
    const word = periodWord(doc);
    if (n === 0) doc.querySelector<HTMLElement>('[data-sum="count"]')?.setAttribute('hidden', '');
    else text.textContent = `${n.toLocaleString('en-GB')} ${n === 1 ? 'thing' : 'things'} on ${word}`;
  }
  const train = doc.querySelector<HTMLElement>('[data-train]');
  if (train) {
    const weekday = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short' }).format(now);
    const value = weekday === 'Sun' ? train.dataset.sunday : train.dataset.monSat;
    if (value) train.textContent = value;
  }
}
