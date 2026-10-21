/** Browser-side fill of /today's Tonight / Tomorrow buckets (used by
 *  components/TodayBlock.astro's script). Lives here, not inline in the
 *  component, so a test can run the real code against a real <template> in a
 *  real browser (today-buckets.test.ts). */
import { bucketOf, type TimedEvent } from './local-day';

/** The <li> children of a template's content. NOT querySelectorAll(':scope > li'):
 *  :scope matches nothing on a template's DocumentFragment in Chromium, which
 *  left Tonight/Tomorrow empty on every town from Fas 1 until 2026-10-21. */
export function templateItems(tpl: { content: { children: ArrayLike<Element> } }): HTMLLIElement[] {
  return (Array.from(tpl.content.children) as HTMLLIElement[]).filter((el) => el.tagName === 'LI');
}

/** Fills #today-tonight / #today-tomorrow from #today-event-items, unhides the
 *  buckets that have events, and shows #today-no-events only when both are
 *  empty. Returns the number of events shown. */
export function fillTodayBuckets(doc: Document, now: Date = new Date()): number {
  const tpl = doc.getElementById('today-event-items') as HTMLTemplateElement | null;
  if (!tpl) return 0;
  const tz = tpl.dataset.tz || 'America/Chicago';
  const entries = templateItems(tpl).map((li) => {
    const ev: TimedEvent = { start: li.dataset.start || '', end: li.dataset.end || null };
    return { li, bucket: ev.start ? bucketOf(ev, now, tz) : null };
  });
  const fill = (id: string, which: 'tonight' | 'tomorrow', limit: number): number => {
    const bucket = doc.getElementById(id);
    const body = bucket?.querySelector('[data-bucket-body]');
    if (!bucket || !body) return 0;
    const hits = entries.filter((e) => e.bucket === which);
    body.textContent = '';
    if (hits.length === 0) return 0;
    bucket.hidden = false;
    if (which === 'tomorrow') {
      const c = doc.createElement('p');
      c.className = 'today-block__count';
      c.textContent = `${hits.length} event${hits.length === 1 ? '' : 's'}`;
      body.appendChild(c);
    }
    const ul = doc.createElement('ul');
    ul.className = 'today-block__cards';
    hits.slice(0, limit).forEach((e) => ul.appendChild(e.li.cloneNode(true)));
    body.appendChild(ul);
    if (hits.length > limit) {
      const more = doc.createElement('p');
      more.className = 'today-block__more';
      more.textContent = `+${hits.length - limit} more ${which === 'tonight' ? 'tonight' : 'tomorrow'}`;
      body.appendChild(more);
    }
    return hits.length;
  };
  const shown = fill('today-tonight', 'tonight', 5) + fill('today-tomorrow', 'tomorrow', 3);
  const none = doc.getElementById('today-no-events');
  if (none) none.hidden = shown > 0;
  return shown;
}
