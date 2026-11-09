/**
 * How many items a /this-week/<slug>/ page lists, counted ONE way for both consumers: the page's own noindex (this-week/[week].astro) and the
 * sitemap filter in astro.config.mjs (which cannot import lib/db.ts or lib/site-config.ts, so this file has no such imports). Mirrors what
 * lib/this-week.ts's buildWeekDays() puts on a week: event stories and SDSU arts events through the cross-source dedup (event-dedup.mjs),
 * meetings and project updates by their bare calendar date, games by local start, regional games by bare date. Rows a newer recurring
 * program replaced (superseded_by_slug) and undated rows are never counted, same as getStoriesForWeekly(). Types: week-count.d.mts.
 */
import { buildEventFeedCore, localDateParts } from './event-dedup.mjs';

/** Mirrors lib/this-week.ts THIS_WEEK_MIN_ITEMS: a week with fewer items than this is noindex and left out of the sitemap. */
export const THIS_WEEK_MIN_ITEMS = 3;

const EVENT_TYPES = ['event'];
const MEETING_TYPES = ['meeting', 'meeting_followup'];

/** UTC-read calendar date, no timezone conversion -- for bare-date fields (meeting dates), like lib/db.ts calendarDateParts(). */
function bareDateParts(value) {
  const d = new Date(value);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

export function isoWeekSlug({ y, m, d }) {
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayNum = (date.getUTCDay() + 6) % 7; // 0=Mon
  date.setUTCDate(date.getUTCDate() - dayNum); // back up to that week's Monday
  const thursday = new Date(date.getTime());
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  const isoYear = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4DayNum = (jan4.getUTCDay() + 6) % 7;
  const week1Monday = new Date(jan4.getTime() - jan4DayNum * 86_400_000);
  const isoWeek = Math.round((date.getTime() - week1Monday.getTime()) / (7 * 86_400_000)) + 1;
  return `${isoYear}-w${String(isoWeek).padStart(2, '0')}`;
}

/**
 * Item count per ISO week slug.
 * @param {object} data
 * @param {Array} data.stories story rows (any source_type; needs source_type, occurs_at, superseded_by_slug, title, source_url, venue_raw)
 * @param {Array} [data.artsEvents] SDSU arts_culture rows (title, starts_at, event_url, location)
 * @param {Array} [data.projectUpdates] rows with meeting_date
 * @param {Array<string|Date>} [data.gameStarts] start instants of games (local date is used)
 * @param {Array<string|Date>} [data.regionalGameDates] bare game dates
 * @param {string} timezone
 * @returns {Map<string, number>}
 */
export function countWeekItems(data, timezone) {
  const counts = new Map();
  const bump = (slug) => counts.set(slug, (counts.get(slug) ?? 0) + 1);
  const live = (data.stories ?? []).filter((s) => s.occurs_at && !s.superseded_by_slug);

  const eventStories = live.filter((s) => EVENT_TYPES.includes(s.source_type));
  const feed = buildEventFeedCore([
    ...eventStories.map((story) => ({ sourceKind: 'story', occurs_at: story.occurs_at, story })),
    ...(data.artsEvents ?? []).map((event) => ({ sourceKind: 'arts', occurs_at: event.starts_at, event })),
  ], timezone);
  for (const item of feed.items) {
    if (item.occurs_at) bump(isoWeekSlug(localDateParts(new Date(item.occurs_at), timezone)));
  }

  for (const s of live) if (MEETING_TYPES.includes(s.source_type)) bump(isoWeekSlug(bareDateParts(s.occurs_at)));
  for (const u of data.projectUpdates ?? []) if (u.meeting_date) bump(isoWeekSlug(bareDateParts(u.meeting_date)));
  for (const g of data.gameStarts ?? []) if (g) bump(isoWeekSlug(localDateParts(new Date(g), timezone)));
  for (const g of data.regionalGameDates ?? []) if (g) bump(isoWeekSlug(bareDateParts(g)));
  return counts;
}

export function isThinWeek(count) {
  return count < THIS_WEEK_MIN_ITEMS;
}
