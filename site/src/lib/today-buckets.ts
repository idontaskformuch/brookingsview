/** Browser-side fill of /today's Tonight / Tomorrow buckets (used by
 *  components/TodayBlock.astro's script). Lives here, not inline in the
 *  component, so a test can run the real code against a real <template> in a
 *  real browser (today-buckets.test.ts). */
import { bucketOf, hasEnded, liveOccurrence, type TimedEvent } from './local-day';

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
  // An entry with several times (data-occ: "3 PM & 7 PM", or a series over days) sits in the bucket of its first unfinished time.
  const occOf = (li: HTMLLIElement): TimedEvent[] => {
    try { if (li.dataset.occ) return JSON.parse(li.dataset.occ) as TimedEvent[]; } catch { /* fall back to the row's own time */ }
    return li.dataset.start ? [{ start: li.dataset.start, end: li.dataset.end || null }] : [];
  };
  const entries = templateItems(tpl).map((li) => {
    const ev = liveOccurrence(occOf(li), now, tz);
    return { li, bucket: ev ? bucketOf(ev, now, tz) : null, ev };
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
    // Rows in the day group's own list (components/ui/DayGroup.astro); every bucket says what it leaves out the same way ("+2 more").
    const ul = doc.createElement('ul');
    ul.className = 'day-group__rows';
    hits.slice(0, limit).forEach((e) => ul.appendChild(e.li.cloneNode(true)));
    body.appendChild(ul);
    if (hits.length > limit) {
      const more = doc.createElement('p');
      more.className = 'day-group__more';
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
      .filter((e) => e.bucket === null && e.ev && !hasEnded(e.ev, now, tz))
      .sort((a, b) => Date.parse(a.ev!.start) - Date.parse(b.ev!.start))
      .slice(0, LATER_LIMIT);
    if (later && body && upcoming.length > 0) {
      body.textContent = '';
      // Several days: one date line per day (the row itself never carries a date), the rows of that day under it.
      let day = '';
      let ul: HTMLUListElement | null = null;
      for (const e of upcoming) {
        const d = e.li.dataset.day || '';
        if (!ul || d !== day) {
          day = d;
          if (e.li.dataset.dayLabel) {
            const h = doc.createElement('p');
            h.className = 'day-group__sub';
            h.textContent = e.li.dataset.dayLabel;
            body.appendChild(h);
          }
          ul = doc.createElement('ul');
          ul.className = 'day-group__rows';
          body.appendChild(ul);
        }
        ul.appendChild(e.li.cloneNode(true));
      }
      later.hidden = false;
    }
  }
  return shown;
}
