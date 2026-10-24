/** Browser-side sweep for static event pages (used by layouts/BaseLayout.astro's
 *  script). Lives here, not inline, so a test can run the real code in a real
 *  browser (hide-ended.test.ts).
 *
 *  - [data-hide-ended] lists drop cards ([data-start]/[data-end]) that have finished.
 *    [data-hide-heading] takes the heading right above the list with it when nothing
 *    is left (an empty "Today" rule reads as a bug); [data-hide-section] hides the enclosing <section>
 *    (a theme group whose rows have all passed); [data-hide-when-empty] hides the list.
 *  - [data-event-status] (event page, built before the event) turns into
 *    "This event is on now." / "This event has passed." once that is true. */
import { hasEnded } from './local-day';

export function sweepEnded(doc: Document, now: Date, pageTz: string): void {
  doc.querySelectorAll<HTMLElement>('[data-hide-ended]').forEach((box) => {
    const cards = Array.from(box.querySelectorAll<HTMLElement>('[data-start]'));
    cards.forEach((el) => {
      if (hasEnded({ start: el.dataset.start || '', end: el.dataset.end || null }, now, pageTz)) el.hidden = true;
    });
    const anyLeft = cards.some((el) => !el.hidden);
    if (cards.length > 0 && !anyLeft) {
      if (box.hasAttribute('data-hide-heading')) {
        const head = box.previousElementSibling as HTMLElement | null;
        if (head && (head.classList.contains('sec') || head.classList.contains('weekend-day__label'))) head.style.display = 'none';
      }
      if (box.hasAttribute('data-hide-section')) box.closest<HTMLElement>('section')?.style.setProperty('display', 'none');
      if (box.hasAttribute('data-hide-when-empty')) box.hidden = true;
      const fb = doc.getElementById('facet-empty-fallback');
      if (fb) { fb.hidden = false; box.hidden = true; }
    }
  });
  doc.querySelectorAll<HTMLElement>('[data-event-status]').forEach((el) => {
    const start = el.dataset.start || '';
    const tz = el.dataset.tz || pageTz;
    if (hasEnded({ start, end: el.dataset.end || null }, now, tz)) el.textContent = 'This event has passed.';
    else if (new Date(start).getTime() <= now.getTime()) el.textContent = 'This event is on now.';
    else return;
    el.hidden = false;
  });
}
