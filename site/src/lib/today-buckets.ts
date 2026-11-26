/** Browser-side fill of /today's Tonight / Tomorrow buckets (used by
 *  components/TodayBlock.astro's script). Lives here, not inline in the
 *  component, so a test can run the real code against a real <template> in a
 *  real browser (today-buckets.test.ts). */
import { bucketOf, hasEnded, liveOccurrence, type TimedEvent } from './local-day';
import { eventDigest, splitNearby } from './day-digest';
import type { Category } from './ui/ui-helpers';

/** One event in a /today bucket, as planBucket reads it (from the server's rows, or a template <li>'s data-* in the browser). `rank`: how
 *  the row may be the bucket's featured card (0 a top event, 1 a one-off, 2 a run; null never: repeating, no link, or nearby). */
export interface BucketRow { nearby: { city: string | null; ticket: boolean } | null; rank: number | null; category: Category | null; free: boolean }

export interface BucketPlan<T> {
  digest: string;
  featured: T | null;
  shown: T[];
  /** town rows left out ("+N more today") */
  more: number;
  near: { heading: string; shown: T[]; moreOwn: T[]; moreTickets: number };
}

/** The same day block as /events/ for one /today bucket (design lift rollout b, owner 2026-11-26 (10)): the town's rows decide the digest
 *  and the featured card (lowest rank, then the earliest; none for a single town row), at most `limit` town rows, then the bucket's
 *  Nearby block. Rows come in time order. */
export function planBucket<T extends BucketRow>(rows: T[], limit: number): BucketPlan<T> {
  const town = rows.filter((r) => !r.nearby);
  const near = rows.filter((r) => r.nearby);
  let featured: T | null = null;
  if (town.length >= 2) {
    for (const r of town) if (r.rank !== null && (featured === null || r.rank < featured.rank!)) featured = r;
  }
  const rest = town.filter((r) => r !== featured);
  return {
    digest: eventDigest(town.map((r) => ({ category: r.category, extra: r.free ? ['Free'] : [] })), near.length),
    featured, shown: rest.slice(0, limit), more: Math.max(0, rest.length - limit), near: splitNearby(near),
  };
}

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
  const features = doc.getElementById('today-event-features') as HTMLTemplateElement | null;
  const featureOf = (key: string | undefined) => (features && key ? templateItems(features).find((li) => li.dataset.key === key) : undefined);
  const whatsOn = tpl.dataset.whatsOn || '';
  const asRow = (li: HTMLLIElement): BucketRow & { li: HTMLLIElement } => ({
    li,
    nearby: li.dataset.nearby !== undefined ? { city: li.dataset.nearby || null, ticket: li.dataset.ticket === '1' } : null,
    rank: li.dataset.rank !== undefined && li.dataset.rank !== '' ? Number(li.dataset.rank) : null,
    category: (li.dataset.cat || null) as Category | null,
    free: li.dataset.free === '1',
  });
  const list = (lis: HTMLLIElement[]) => {
    const ul = doc.createElement('ul');
    ul.className = 'day-group__rows';
    lis.forEach((li) => ul.appendChild(li.cloneNode(true)));
    return ul;
  };
  const fill = (id: string, which: 'today' | 'tonight' | 'tomorrow', limit: number): number => {
    const bucket = doc.getElementById(id);
    const body = bucket?.querySelector('[data-bucket-body]');
    if (!bucket || !body) return 0;
    const hits = entries.filter((e) => e.bucket === which);
    body.textContent = '';
    // A bucket the server filled (SiteConfig.todayPage) is hidden again once its events are over.
    bucket.hidden = hits.length === 0;
    bucket.querySelector('.day-group__digest')?.setAttribute('hidden', '');
    if (hits.length === 0) return 0;
    bucket.hidden = false;
    // The day block (owner 2026-11-26 (10)): digest, the town's featured event, its rows, then the bucket's Nearby block.
    const plan = planBucket(hits.map((e) => asRow(e.li)), limit);
    // The digest is the day group's own line, above its body (components/ui/DayGroup.astro); the server may have written one already.
    let dg = bucket.querySelector<HTMLElement>('.day-group__digest');
    if (!dg && plan.digest) {
      dg = doc.createElement('p');
      dg.className = 'day-group__digest';
      body.before(dg);
    }
    if (dg) { dg.textContent = plan.digest; dg.hidden = !plan.digest; }
    const feat = plan.featured ? featureOf(plan.featured.li.dataset.key) : undefined;
    const townLis = [...(feat ? [feat] : plan.featured ? [plan.featured.li] : []), ...plan.shown.map((r) => r.li)];
    if (townLis.length > 0) body.appendChild(list(townLis));
    if (plan.more > 0) {
      const more = doc.createElement('p');
      more.className = 'day-group__more';
      more.textContent = `+${plan.more} more ${which === 'today' ? 'today' : which === 'tonight' ? 'tonight' : 'tomorrow'}`;
      body.appendChild(more);
    }
    if (plan.near.shown.length > 0) {
      const box = doc.createElement('div');
      box.className = 'nearby-block';
      box.setAttribute('data-nearby-block', '');
      const h = doc.createElement('p');
      h.className = 'nearby-block__h';
      h.textContent = plan.near.heading;
      box.append(h, list(plan.near.shown.map((r) => r.li)));
      if (plan.near.moreOwn.length > 0) {
        const p = doc.createElement('p');
        p.className = 'day-group__more';
        p.textContent = `+${plan.near.moreOwn.length} more nearby`;
        box.appendChild(p);
      }
      if (plan.near.moreTickets > 0 && whatsOn) {
        const p = doc.createElement('p');
        p.className = 'nearby-block__more';
        const a = doc.createElement('a');
        a.href = whatsOn;
        a.textContent = 'More nearby shows →';
        p.appendChild(a);
        box.appendChild(p);
      }
      body.appendChild(box);
    }
    return hits.length;
  };
  const shown = fill('today-now', 'today', 5) + fill('today-tonight', 'tonight', 5) + fill('today-tomorrow', 'tomorrow', 3);
  if (shown === 0) {
    const later = doc.getElementById('today-later');
    const body = later?.querySelector('[data-bucket-body]');
    const upcoming = entries
      // The town's own only: "Coming up" never fills with shows in other towns (owner 2026-11-26 (9)).
      .filter((e) => e.bucket === null && e.ev && !hasEnded(e.ev, now, tz) && e.li.dataset.nearby === undefined)
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
