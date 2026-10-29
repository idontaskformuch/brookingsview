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
import { hasEnded, DEFAULT_EVENT_MS, localDayNumber, localHourOf, localInstantIso } from './local-day';
import { ticketmasterImageProxyPath } from './images';
import type { EveningItem } from './evening-threshold';

export type EveningGroup = 'Live music' | 'Comedy & shows' | 'Quiz & pub nights' | 'Clubs & late' | 'Sport tonight' | 'Family' | 'Festivals & fairs' | 'Film';
export type EveningLabel = 'Free' | '18+' | 'All ages';
export type EveningSource = 'ticketmaster' | 'own' | 'register';

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
  /** Straight-line miles from the town centre when the source says (Ticketmaster); null for own events. */
  distanceMiles: number | null;
  /** Estimated drive time for a row outside the town, null inside it. Always shown with "about" -- see driveMinutes(). */
  driveMinutes: number | null;
  /** Local date (YYYY-MM-DD) the row was last read from its source: the build date for feed-based sources. */
  checked: string;
  /** Later start times the same night for the same title (a film with several screenings); register rows only. */
  laterStarts?: string[];
  /** Licensed Ticketmaster picture (proxied through our own route), shown on highlight cards only. null/absent = no picture. */
  image?: { src: string; alt: string; width: number; height: number } | null;
  /** Neighbourhood ("Merchant City") from OpenStreetMap place data, see lib/areas.ts; null/absent when unknown. */
  area?: string | null;
  lat?: number | null;
  lon?: number | null;
}

/** One row of the curated venue register (db.getEveningRegister): a rule the weekly job read off the venue's own page. */
export interface RegisterRow {
  venueName: string;
  kind: 'recurring' | 'dated';
  title: string;
  /** ISO weekdays 1 (Monday) to 7 (Sunday), recurring only. */
  weekdays: number[];
  /** YYYY-MM-DD in the venue's local time, dated only. */
  onDate: string | null;
  /** 'HH:MM' local start times, ascending. */
  times: string[];
  price: string | null;
  age: string | null;
  defaultGroup: string;
  sourceUrl: string;
  lastConfirmedAt: string;
}

/** Owner 2026-10-29: a dated event is dropped unless the venue's page still showed it within 7 days, a recurring rule within 35. */
export const REGISTER_MAX_AGE_DAYS = { dated: 7, recurring: 35 } as const;
export const REGISTER_HORIZON_DAYS = 14;

/** "Clubs & late" is for late starts and club words only (owner 2026-10-29: Essy Sparrow, a singer at SWG3, was a "club night").
 *  A venue or source that says "club" for an early evening show falls back to Live music. */
export const CLUB_FROM_HOUR = 22;
export function settleGroup(group: EveningGroup | null, title: string, startIso: string, timezone: string): EveningGroup | null {
  if (group !== 'Clubs & late') return group;
  const hour = localHourOf(new Date(startIso), timezone);
  return CLUB_RE.test(title) || hour >= CLUB_FROM_HOUR || hour < 5 ? group : 'Live music';
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

/** Ticketmaster: its own classification first (segment and genre), the title only for events Ticketmaster leaves unclassified
 *  (segment "Undefined": mostly gigs promoted as "<promoter> presents ..."). Sport reaches here only for towns with
 *  eveningLayer.includeTicketmasterSports. */
export function groupForTicketmaster(segment: string | null | undefined, genre: string | null | undefined, title = ''): EveningGroup | null {
  const seg = (segment ?? '').toLowerCase();
  const gen = (genre ?? '').toLowerCase();
  if (/\b(family|children|kids)\b/.test(gen)) return 'Family';
  if (seg === 'music') return /dance|electronic|club|house|techno/.test(gen) ? 'Clubs & late' : 'Live music';
  if (seg === 'arts & theatre') return 'Comedy & shows';
  if (seg === 'sports') return 'Sport tonight';
  if (seg === 'film') return 'Film';
  if (seg === 'miscellaneous') return /fair|festival|expo|community|civic|hobby/.test(gen) ? 'Festivals & fairs' : null;
  if (seg === '' || seg === 'undefined') {
    const byTitle = groupForTitle(title);
    if (byTitle) return byTitle;
    if (/\b(cabaret|panto|pantomime|musical|variety show)\b/i.test(title)) return 'Comedy & shows';
    if (/\b(presents?|live|band|concert|tour|gig|orchestra|choir|tribute)\b/i.test(title)) return 'Live music';
  }
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

/** Rough drive time from straight-line miles (no routing service is used): road factor 1.3, average speed 25 mph under 10 miles,
 *  35 mph to 30, 50 mph beyond, rounded to 5 minutes. Rows say "about" and the page says it is an estimate. */
export function driveMinutes(miles: number): number {
  const mph = miles < 10 ? 25 : miles < 30 ? 35 : 50;
  return Math.max(5, Math.round(((miles * 1.3) / mph) * 12) * 5);
}

export function driveLabel(minutes: number | null): string | null {
  return minutes == null ? null : `about ${minutes} min drive`;
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
  /** Ticketmaster shows further away than this are left out (siteConfig.eveningLayer.maxMiles). Default: in-town only. */
  ticketmasterMaxMiles?: number | 'in-town';
  /** Rows of the curated venue register (siteConfig has no switch: an empty or unreadable table gives no rows). */
  register?: RegisterRow[];
  /** Ticketmaster sport counts (siteConfig.eveningLayer.includeTicketmasterSports). Default false: Brookings' SDSU feed already carries it. */
  includeTicketmasterSports?: boolean;
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
    group: settleGroup(groupForTitle(title), title, new Date(item.occurs_at).toISOString(), o.timezone),
    labels,
    venue: itemVenue(item),
    href: story ? storyHref(story.slug) : itemUrl(item),
    source: 'own',
    distanceMiles: null,
    driveMinutes: null,
    checked: o.checked,
  };
}

function ticketmasterEntry(item: TicketmasterFeedItem, o: EveningEntryOptions): EveningEntry | null {
  const e = item.ticketmasterEvent;
  if (!item.occurs_at || Number.isNaN(new Date(item.occurs_at).getTime())) return null;
  if (!o.includeTicketmasterSports && e.segment === 'Sports') return null;
  const max = o.ticketmasterMaxMiles ?? 'in-town';
  if (max === 'in-town') {
    if (distanceLabel(e.venueDistanceMiles, o.cityName) !== `In ${o.cityName}`) return null;
  } else if (e.venueDistanceMiles == null || e.venueDistanceMiles > max) return null;
  return {
    id: `tm:${e.id}`,
    title: e.title,
    start: new Date(item.occurs_at).toISOString(),
    end: null,
    group: settleGroup(groupForTicketmaster(e.segment, e.genre, e.title), e.title, new Date(item.occurs_at).toISOString(), o.timezone),
    labels: [],
    venue: e.venueName,
    href: `/whats-on/${ticketmasterSlug(e)}/`,
    source: 'ticketmaster',
    distanceMiles: e.venueDistanceMiles,
    driveMinutes: distanceLabel(e.venueDistanceMiles, o.cityName) === `In ${o.cityName}` || e.venueDistanceMiles == null ? null : driveMinutes(e.venueDistanceMiles),
    checked: o.checked,
    image: e.imageUrl ? { src: ticketmasterImageProxyPath(e.imageUrl), alt: `Photo for "${e.title}"`, width: e.imageWidth ?? 1600, height: e.imageHeight ?? 900 } : null,
    lat: e.venueLatitude, lon: e.venueLongitude,
  };
}

const REGISTER_GROUPS: EveningGroup[] = ['Live music', 'Comedy & shows', 'Quiz & pub nights', 'Clubs & late'];

function isoWeekday(day: number): number {
  const dow = new Date(day * 86_400_000).getUTCDay();
  return dow === 0 ? 7 : dow;
}

/** Register rules expanded to concrete evenings: today and the next REGISTER_HORIZON_DAYS days, stale rules left out. A rule with several
 *  times on one night becomes ONE row (first start, the rest in laterStarts). Price and age labels were taken from the venue's text by the job. */
export function registerEntries(rows: RegisterRow[], o: EveningEntryOptions): EveningEntry[] {
  const today = localDayNumber(o.now, o.timezone);
  const out: EveningEntry[] = [];
  for (const r of rows) {
    const ageDays = (o.now.getTime() - new Date(r.lastConfirmedAt).getTime()) / 86_400_000;
    if (!(ageDays <= REGISTER_MAX_AGE_DAYS[r.kind])) continue;
    const fallback = REGISTER_GROUPS.find((g) => g === r.defaultGroup) ?? null;
    const labels: EveningLabel[] = [];
    if (r.price === 'Free') labels.push('Free');
    if (r.age === '18+' || r.age === 'All ages') labels.push(r.age);
    const confirmed = new Intl.DateTimeFormat('en-CA', { timeZone: o.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(r.lastConfirmedAt));
    for (let day = today; day <= today + REGISTER_HORIZON_DAYS; day++) {
      const d = new Date(day * 86_400_000);
      const ymd = { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
      const iso = `${ymd.y}-${String(ymd.m).padStart(2, '0')}-${String(ymd.d).padStart(2, '0')}`;
      if (r.kind === 'dated' ? r.onDate !== iso : !r.weekdays.includes(isoWeekday(day))) continue;
      const starts = r.times.map((t) => localInstantIso(ymd, Number(t.slice(0, 2)), Number(t.slice(3, 5)), o.timezone));
      out.push({
        id: `reg:${r.venueName}|${r.title}|${iso}`, title: r.title, start: starts[0],
        end: starts.length > 1 ? new Date(new Date(starts[starts.length - 1]).getTime() + DEFAULT_EVENT_MS).toISOString() : null,
        group: settleGroup(groupForTitle(r.title) ?? fallback, r.title, starts[0], o.timezone), labels, venue: r.venueName,
        href: r.sourceUrl, source: 'register', distanceMiles: null, driveMinutes: null, checked: confirmed,
        ...(starts.length > 1 ? { laterStarts: starts.slice(1) } : {}),
      });
    }
  }
  return out;
}

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** The same show listed by two sources ("DF Concerts Presents: NOAHFINNCE" from the venue's calendar and "NOAHFINNCE" from
 *  Ticketmaster): same start instant and one title contains the other. */
function sameShow(a: EveningEntry, b: EveningEntry): boolean {
  if (a.start !== b.start) return false;
  const x = norm(a.title), y = norm(b.title);
  return x.length > 0 && y.length > 0 && (x === y || x.includes(y) || y.includes(x));
}

/** All evening candidates, passed events dropped, one row per show (same start and overlapping title; the shorter title is kept),
 *  sorted by start. The same title at the same venue and start, listed twice by one source (a series row), counts once too. */
export function buildEveningEntries(o: EveningEntryOptions): EveningEntry[] {
  const out: EveningEntry[] = [];
  const candidates = [
    ...o.feed.map((i) => ownEntry(i, o)),
    ...(o.ticketmaster ?? []).map((i) => ticketmasterEntry(i, o)),
    ...registerEntries(o.register ?? [], o),
  ];
  for (const c of candidates) {
    if (!c) continue;
    if (hasEnded({ start: c.start, end: c.end ?? new Date(new Date(c.start).getTime() + DEFAULT_EVENT_MS).toISOString() }, o.now, o.timezone)) continue;
    const at = out.findIndex((x) => sameShow(x, c));
    if (at === -1) out.push(c);
    else if (c.title.length < out[at].title.length) out[at] = { ...c, labels: [...new Set([...c.labels, ...out[at].labels])] };
    else out[at] = { ...out[at], labels: [...new Set([...out[at].labels, ...c.labels])] };
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

/** The shape the threshold engine reads. */
export function toThresholdItems(entries: EveningEntry[]): EveningItem[] {
  return entries.map((e) => ({ start: e.start, group: e.group }));
}
