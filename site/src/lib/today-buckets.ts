/** Browser-side fill of /today's Tonight / Tomorrow buckets (used by
 *  components/TodayBlock.astro's script). Lives here, not inline in the
 *  component, so a test can run the real code against a real <template> in a
 *  real browser (today-buckets.test.ts). */
import { bucketOf, hasEnded, type TimedEvent } from './local-day';

/** The <li> children of a template's content. NOT querySelectorAll(':scope > li'):
 *  :scope matches nothing on a template's DocumentFragment in Chromium, which
 *  left Tonight/Tomorrow empty on every town from Fas 1 until 2026-10-21. */
export function templateItems(tpl: { content: { children: ArrayLike<Element> } }): HTMLLIElement[] {
  return (Array.from(tpl.content.children) as HTMLLIElement[]).filter((el) => el.tagName === 'LI');
}

/** Fills #today-now / #today-tonight / #today-tomorrow from #today-event-items and unhides the
 *  buckets that have events. When all three are empty, #today-later lists the nearest upcoming
 *  events from the rest of the template's week instead (owner 2026-11-07: no "nothing scheduled"
 *  message). Returns the number of events shown in the three day buckets. */
const LATER_LIMIT = 5;
export function fillTodayBuckets(doc: Document, now: Date = new Date()): number {
  const tpl = doc.getElementById('today-event-items') as HTMLTemplateElement | null;
  if (!tpl) return 0;
  const tz = tpl.dataset.tz || 'America/Chicago';
  const entries = templateItems(tpl).map((li) => {
    const ev: TimedEvent = { start: li.dataset.start || '', end: li.dataset.end || null };
    return { li, bucket: ev.start ? bucketOf(ev, now, tz) : null };
  });
  const fill = (id: string, which: 'today' | 'tonight' | 'tomorrow', limit: number): number => {
    const bucket = doc.getElementById(id);
    const body = bucket?.querySelector('[data-bucket-body]');
    if (!bucket || !body) return 0;
    const hits = entries.filter((e) => e.bucket === which);
    body.textContent = '';
    // A bucket the server filled (SiteConfig.todayPage) is hidden again once its events are over.
    bucket.hidden = hits.length === 0;
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
      more.textContent = `+${hits.length - limit} more ${which === 'today' ? 'today' : which === 'tonight' ? 'tonight' : 'tomorrow'}`;
      body.appendChild(more);
    }
    return hits.length;
  };
  const shown = fill('today-now', 'today', 5) + fill('today-tonight', 'tonight', 5) + fill('today-tomorrow', 'tomorrow', 3);
  if (shown === 0) {
    const later = doc.getElementById('today-later');
    const body = later?.querySelector('[data-bucket-body]');
    const upcoming = entries
      .filter((e) => e.bucket === null && e.li.dataset.start && !hasEnded({ start: e.li.dataset.start, end: e.li.dataset.end || null }, now, tz))
      .sort((a, b) => Date.parse(a.li.dataset.start!) - Date.parse(b.li.dataset.start!))
      .slice(0, LATER_LIMIT);
    if (later && body && upcoming.length > 0) {
      body.textContent = '';
      const ul = doc.createElement('ul');
      ul.className = 'today-block__cards';
      upcoming.forEach((e) => ul.appendChild(e.li.cloneNode(true)));
      body.appendChild(ul);
      later.hidden = false;
    }
  }
  return shown;
}
