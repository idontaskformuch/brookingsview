/** The sitewide RSS feed (/rss.xml), owner 2026-11-06: built from structured fields only, no model-written text. Four kinds of item:
 *  an agenda the source dates as published, a meeting the source says is cancelled or postponed, a school closure, and at most
 *  MAX_EVENTS_PER_WEEK of the town's own events per week (never Ticketmaster / big shows). Each item has a title built from fields and a link to our
 *  page or to the source. Pure: the page loads the data and passes it in. */
import type { FeedItem as MeetingFeedItem } from './meetings-view';

export const MAX_EVENTS_PER_WEEK = 5;

export interface SiteFeedItem { guid: string; title: string; link: string; pubDate: Date; description: string }

export interface FeedClosure { district: string; title: string | null; url: string | null; posted_at: string | Date }

/** A local event as the feed needs it: the day view's row, reduced to fields. */
export interface FeedEvent {
  id: string; title: string; startIso: string; dateLabel: string; timeLabel: string | null; venue: string | null;
  /** our page, or the source when the story has no page of its own; null = no link, the event is left out */
  link: string | null; publishedAt: string | null;
}

export function buildSiteFeed(o: {
  meetingItems: MeetingFeedItem[]; closures: FeedClosure[]; events: FeedEvent[];
  closuresPageUrl: string | null; eventsPageUrl: string; weekOf: (iso: string) => string; now: Date; max?: number;
}): SiteFeedItem[] {
  const items: SiteFeedItem[] = [];

  // meetings: agenda published, cancelled, postponed (a plain "new meeting" is not an agenda and is left to /city-hall/rss.xml)
  for (const m of o.meetingItems) {
    if (m.kind === 'new') continue;
    items.push({ guid: m.guid, title: m.title, link: m.link, pubDate: m.pubDate, description: m.description });
  }

  // school closures: the district's own title, linked to the district's notice (or our closures page)
  for (const c of o.closures) {
    const link = c.url || o.closuresPageUrl;
    const pubDate = new Date(c.posted_at);
    if (!link || Number.isNaN(pubDate.getTime())) continue;
    items.push({ guid: `closure-${c.district}-${pubDate.toISOString()}`, title: c.title ? `Closure: ${c.district}, ${c.title}` : `Closure: ${c.district}`, link, pubDate, description: `Posted by ${c.district}.` });
  }

  // own events: the first MAX_EVENTS_PER_WEEK of each week by start time
  const perWeek = new Map<string, number>();
  for (const e of [...o.events].sort((a, b) => a.startIso.localeCompare(b.startIso))) {
    if (!e.link) continue;
    const week = o.weekOf(e.startIso);
    const n = perWeek.get(week) ?? 0;
    if (n >= MAX_EVENTS_PER_WEEK) continue;
    perWeek.set(week, n + 1);
    const published = e.publishedAt ? new Date(e.publishedAt) : o.now;
    const pubDate = Number.isNaN(published.getTime()) || published > o.now ? o.now : published;
    items.push({
      guid: `event-${e.id}`, title: e.title, link: e.link, pubDate,
      description: [[e.dateLabel, e.timeLabel].filter(Boolean).join(', '), e.venue].filter(Boolean).join(' · '),
    });
  }

  return items.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime() || a.guid.localeCompare(b.guid)).slice(0, o.max ?? 60);
}
