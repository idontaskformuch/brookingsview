/** Browser side of /api/alerts (server/alerts.ts). The page is static and can be hours old; the Worker cron writes NWS alerts to the database every
 *  15 minutes. This module (a) shows alerts the build did not know about, in one compact bar, and (b) hides alerts the build DID render but that are
 *  no longer in force (cancelled early). The server-rendered alerts stay as the fallback: with no JavaScript, or when the API is down, nothing
 *  changes. Lives here, not inline, so a test can run it (live-alerts.test.ts). */

import { shortDate, localMonthDay } from './calendar-strings';
import { formatClockCompact } from './country-profile';
export interface LiveAlert {
  id: number;
  source: string;
  event: string;
  headline: string;
  description: string;
  endsAt: string;
  url: string | null;
}

/** 'alert-123' -> 123 (the story slug the build rendered is 'alert-' + events.id). */
export function eventIdFromSlug(slug: string | null | undefined): number | null {
  const m = /^alert-(\d+)$/.exec(slug ?? '');
  return m ? Number(m[1]) : null;
}

export interface AlertPlan {
  /** Alerts in force that the page does not show yet (NWS only: county re-posts are not new information). */
  toShow: LiveAlert[];
  /** Event ids the page shows that are no longer in force. */
  toHide: Set<number>;
}

export function planAlertUpdate(knownIds: Set<number>, active: LiveAlert[]): AlertPlan {
  const activeIds = new Set(active.map((a) => a.id));
  const toHide = new Set([...knownIds].filter((id) => !activeIds.has(id)));
  const toShow = active.filter((a) => !knownIds.has(a.id) && a.source === 'nws_alert');
  return { toShow, toHide };
}

/** The line shown in the bar: event, until when, the first sentence of the official text, source link. All set with textContent. */
/** "Sat, Oct 24, 9:00 AM" (us) / "Sat 24 Oct, 9:00am" (gb). */
export function alertUntilLabel(end: Date, tz: string, country: 'us' | 'gb'): string {
  if (country !== 'gb') return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(end);
  const { m, d } = localMonthDay(end, tz);
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(end);
  return `${weekday} ${shortDate(m, d, country)}, ${formatClockCompact(end, tz)}`;
}

export function renderAlertBar(doc: Document, bar: HTMLElement, alerts: LiveAlert[], tz: string, country: 'us' | 'gb' = 'us'): void {
  bar.replaceChildren();
  for (const a of alerts) {
    const p = doc.createElement('p');
    p.className = 'live-alerts__item';
    const strong = doc.createElement('strong');
    strong.textContent = a.event;
    p.appendChild(strong);
    const until = alertUntilLabel(new Date(a.endsAt), tz, country);
    p.append(` · until ${until}`);
    const first = a.description.split(/(?<=[.!?])\s/)[0];
    if (first) p.append(` · ${first.slice(0, 220)}`);
    if (a.url) {
      p.append(' · ');
      const link = doc.createElement('a');
      link.href = 'https://www.weather.gov/';
      link.textContent = 'Source: National Weather Service';
      link.rel = 'noopener';
      p.appendChild(link);
    }
    bar.appendChild(p);
  }
  bar.hidden = alerts.length === 0;
}

export function applyAlertPlan(doc: Document, plan: AlertPlan, tz: string, country: 'us' | 'gb' = 'us'): void {
  doc.querySelectorAll<HTMLElement>('[data-alert-slug]').forEach((el) => {
    const id = eventIdFromSlug(el.dataset.alertSlug);
    if (id !== null && plan.toHide.has(id)) el.hidden = true;
  });
  const bar = doc.getElementById('live-alerts');
  if (bar) renderAlertBar(doc, bar, plan.toShow, tz, country);
}

/** One refresh: fetch, plan, apply. A failed request changes nothing (the build's own markup stays). */
export async function refreshLiveAlerts(doc: Document, fetcher: typeof fetch = fetch): Promise<void> {
  const bar = doc.getElementById('live-alerts');
  if (!bar) return;
  const tz = bar.dataset.tz || 'America/Chicago';
  const country = bar.dataset.country === 'gb' ? 'gb' : 'us';
  const known = new Set<number>();
  doc.querySelectorAll<HTMLElement>('[data-alert-slug]').forEach((el) => { const id = eventIdFromSlug(el.dataset.alertSlug); if (id !== null) known.add(id); });
  for (const id of (bar.dataset.known || '').split(',').map(Number)) if (id) known.add(id);
  let body: { alerts?: LiveAlert[] };
  try {
    const res = await fetcher('/api/alerts', { headers: { Accept: 'application/json' } });
    if (!res.ok) return;
    body = await res.json();
  } catch {
    return;
  }
  if (!Array.isArray(body.alerts)) return;
  applyAlertPlan(doc, planAlertUpdate(known, body.alerts), tz, country);
}
