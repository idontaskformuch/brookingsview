/** Data layer for the evening layer (/tonight, /this-weekend): turns the town's own event stories, SDSU arts events and
 *  Ticketmaster shows into one list of EveningEntry rows (group, labels, source link, "checked" date) and feeds the
 *  threshold engine (lib/evening-threshold.ts). Owner decisions 2026-10-28, .claude/specs/weekend-layer.md.
 *
 *  Groups (T2): Live music, Comedy & shows, Quiz & pub nights, Clubs & late, Sport tonight. "Free tonight" is a LABEL, not
 *  a group: a page of free library programmes must not satisfy the "3 groups" bar on its own, so Free never counts toward
 *  the threshold. Items without a recognisable group still count as items.
 *
 *  Labels come from source data only (Free, 18+, All ages), never from guesses about the text of the description.
 *  Pure functions: no I/O, no globals; `isFree` is injected so the caller decides how free-ness is known (venue registry).
 *  Later steps add OSM "Open late" (5) and the curated register (6) as further sources of EveningEntry. */
import type { FeedItem } from './events';
import { itemTitle, itemUrl, itemVenue } from './events';
import { storyHref } from './content-slugs';
import { distanceLabel, type TicketmasterFeedItem } from './ticketmaster';
import { ticketmasterSlug } from './whats-on';
import { hasEnded, DEFAULT_EVENT_MS } from './local-day';
import type { EveningItem } from './evening-threshold';

export type EveningGroup = 'Live music' | 'Comedy & shows' | 'Quiz & pub nights' | 'Clubs & late' | 'Sport tonight';
export type EveningLabel = 'Free' | '18+' | 'All ages';
export type EveningSource = 'ticketmaster' | 'own';

export interface EveningEntry {
  id: string;
  title: string;
  /** ISO instant. */
  start: string;
  /** ISO instant or null when the source has no end. */
  end: string | null;
  group: EveningGroup | null;
  labels: EveningLabel[];
  venue: string | null;
  /** Site-relative page (own events, Ticketmaster detail) or the source's external link. */
  href: string | null;
  source: EveningSource;
  /** Local date (YYYY-MM-DD) the row was last read from its source: the build date for feed-based sources. */
  checked: string;
}

const QUIZ_RE = /\b(quiz|trivia|pub quiz|bingo)\b/i;
const COMEDY_RE = /\b(comedy|comedian|stand-?up|improv|panel show)\b/i;
const CLUB_RE = /\b(club night|dj set|\bdj\b|rave|disco|late night)\b/i;
const MUSIC_RE = /\b(live music|live band|concert|gig|open mic|open-mic|jam session|karaoke|choir|orchestra|symphony|folk night|jazz|acoustic)\b/i;
const SPORT_RE = /\b(match|game day|tournament|league|derby|fixture|race night|vs\.?|v\.)\b/i;

/** Own events: a keyword rule on the title only (the description is too long and too chatty to read a group out of).
 *  Order matters: "Comedy quiz" is a quiz night, "DJ set + live band" a club night. */
export function groupForTitle(title: string): EveningGroup | null {
  if (QUIZ_RE.test(title)) return 'Quiz & pub nights';
  if (CLUB_RE.test(title)) return 'Clubs & late';
  if (COMEDY_RE.test(title)) return 'Comedy & shows';
  if (MUSIC_RE.test(title)) return 'Live music';
  if (SPORT_RE.test(title)) return 'Sport tonight';
  return null;
}

/** Ticketmaster: its own classification. Sports are not fetched at all (ticketmaster.ts), so no Sport group here. */
export function groupForTicketmaster(segment: string | null | undefined, genre: string | null | undefined): EveningGroup | null {
  const seg = (segment ?? '').toLowerCase();
  const gen = (genre ?? '').toLowerCase();
  if (seg === 'music') return /dance|electronic|club|house|techno/.test(gen) ? 'Clubs & late' : 'Live music';
  if (seg === 'arts & theatre') return 'Comedy & shows';
  if (seg === 'sports') return 'Sport tonight';
  return null;
}

const ADULTS_RE = /(^|[^\d])(18\+|18 ?plus|over[- ]18s?|18 and over|adults only|21\+|over[- ]21s?)/i;
const ALL_AGES_RE = /\ball ages\b|\bfamily[- ]friendly\b/i;

/** Age label from the structured audience field only. */
export function ageLabel(audience: string | null | undefined): EveningLabel | null {
  if (!audience) return null;
  if (ADULTS_RE.test(audience)) return '18+';
  if (ALL_AGES_RE.test(audience)) return 'All ages';
  return null;
}

export interface EveningEntryOptions {
  feed: FeedItem[];
  ticketmaster?: TicketmasterFeedItem[];
  now: Date;
  timezone: string;
  /** Local date the data was read, YYYY-MM-DD (the build date). */
  checked: string;
  cityName: string;
  /** Whether an own event is knowably free (venue registry, see events.ts isFreeEvent). */
  isFree?: (item: FeedItem) => boolean;
  /** Ticketmaster shows further away than this are left out (a regional arena is not tonight in the town). Default: in-town only. */
  ticketmasterMaxMiles?: number | 'in-town';
}

function endIso(end: string | null | undefined): string | null {
  return end && !Number.isNaN(new Date(end).getTime()) ? new Date(end).toISOString() : null;
}

function ownEntry(item: FeedItem, o: EveningEntryOptions): EveningEntry | null {
  if (!item.occurs_at || Number.isNaN(new Date(item.occurs_at).getTime())) return null;
  const story = item.sourceKind === 'story' ? item.story : null;
  const title = itemTitle(item);
  const labels: EveningLabel[] = [];
  if (o.isFree?.(item)) labels.push('Free');
  const age = ageLabel(story?.meta?.audience);
  if (age) labels.push(age);
  return {
    id: story ? `own:${story.slug}` : `own:arts:${title}|${item.occurs_at}`,
    title,
    start: new Date(item.occurs_at).toISOString(),
    end: endIso(story?.ends_at),
    group: groupForTitle(title),
    labels,
    venue: itemVenue(item),
    href: story ? storyHref(story.slug) : itemUrl(item),
    source: 'own',
    checked: o.checked,
  };
}

function ticketmasterEntry(item: TicketmasterFeedItem, o: EveningEntryOptions): EveningEntry | null {
  const e = item.ticketmasterEvent;
  if (!item.occurs_at || Number.isNaN(new Date(item.occurs_at).getTime())) return null;
  const max = o.ticketmasterMaxMiles ?? 'in-town';
  if (max === 'in-town') {
    if (distanceLabel(e.venueDistanceMiles, o.cityName) !== `In ${o.cityName}`) return null;
  } else if (e.venueDistanceMiles == null || e.venueDistanceMiles > max) return null;
  return {
    id: `tm:${e.id}`,
    title: e.title,
    start: new Date(item.occurs_at).toISOString(),
    end: null,
    group: groupForTicketmaster(e.segment, e.genre),
    labels: [],
    venue: e.venueName,
    href: `/whats-on/${ticketmasterSlug(e)}/`,
    source: 'ticketmaster',
    checked: o.checked,
  };
}

/** All evening candidates, passed events dropped, the same title + venue + start counted once (a Ticketmaster show a
 *  venue also lists itself, or a series row repeated), sorted by start. */
export function buildEveningEntries(o: EveningEntryOptions): EveningEntry[] {
  const seen = new Set<string>();
  const out: EveningEntry[] = [];
  const candidates = [
    ...o.feed.map((i) => ownEntry(i, o)),
    ...(o.ticketmaster ?? []).map((i) => ticketmasterEntry(i, o)),
  ];
  for (const c of candidates) {
    if (!c) continue;
    if (hasEnded({ start: c.start, end: c.end ?? new Date(new Date(c.start).getTime() + DEFAULT_EVENT_MS).toISOString() }, o.now, o.timezone)) continue;
    const key = `${c.title.trim().toLowerCase()}|${(c.venue ?? '').trim().toLowerCase()}|${c.start}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

/** The shape the threshold engine reads. */
export function toThresholdItems(entries: EveningEntry[]): EveningItem[] {
  return entries.map((e) => ({ start: e.start, group: e.group }));
}
