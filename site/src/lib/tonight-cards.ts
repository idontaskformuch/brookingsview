/** Card layout of /tonight (spec .claude/specs/tonight-cards.md): the pure rules behind the cards. Used at build time for the HTML
 *  fallback and in the browser (lib/tonight-cards-client.ts) for the live parts, so the two can never disagree.
 *  Nothing here guesses: a price, a badge or a walk time exists only when the data states it. */
import type { EveningEntry, EveningGroup } from './evening-items';
import { hasEnded } from './local-day';
import { showTimeGb } from './whats-on-dates';

/** Card colour buckets. The three event categories and Open late each have an accent; everything else is neutral "Also on". */
export type Bucket = 'music' | 'comedy' | 'theatre' | 'late' | 'other';
export const BUCKET_LABEL: Record<Bucket, string> = { music: 'Live music', comedy: 'Comedy & shows', theatre: 'Theatre', late: 'Open late', other: 'Also on' };
/** Category rows in page order (Open late is its own row, placed by the page). */
export const EVENT_BUCKETS: Bucket[] = ['music', 'comedy', 'theatre', 'other'];

export function bucketOf(group: EveningGroup | null): Bucket {
  if (group === 'Live music') return 'music';
  if (group === 'Comedy & shows') return 'comedy';
  if (group === 'Theatre') return 'theatre';
  return 'other';
}

export const SOON_MINUTES = 90;
export const IMMINENT_MINUTES = 60;
export const SOON_MAX_CARDS = 6;
export const SURPRISE_WINDOW_MS = 3 * 3_600_000;
export const WALK_MAX_MINUTES = 10;
/** Closer than this the "walk" is the same building or the same street corner: not a night out to suggest. */
export const WALK_MIN_MINUTES = 2;
export const NIGHT_MAX_PAIRS = 3;

export interface TimeState { kind: 'now' | 'soon' | 'clock'; text: string }

/** "On now" once started and not over, "in 26 min" within the hour, otherwise the clock time ("7:30pm"). */
export function timeState(startIso: string, endIso: string | null, now: Date, tz: string): TimeState {
  const diff = new Date(startIso).getTime() - now.getTime();
  if (diff <= 0 && !hasEnded({ start: startIso, end: endIso }, now, tz)) return { kind: 'now', text: 'On now' };
  if (diff > 0 && diff <= IMMINENT_MINUTES * 60_000) return { kind: 'soon', text: `in ${Math.max(1, Math.ceil(diff / 60_000))} min` };
  return { kind: 'clock', text: showTimeGb(startIso, tz) };
}

/** True for the "Starting soon" row: on now, or starting within SOON_MINUTES. */
export function isStartingSoon(startIso: string, endIso: string | null, now: Date, tz: string): boolean {
  if (hasEnded({ start: startIso, end: endIso }, now, tz)) return false;
  return new Date(startIso).getTime() - now.getTime() <= SOON_MINUTES * 60_000;
}

const CURRENCY_SYMBOL: Record<string, string> = { GBP: '£', USD: '$', EUR: '€' };

export interface Badge { kind: 'free' | 'price'; text: string }

/** Badges only from stated data: Free from the source's own label, a price from the source's lowest price in a currency we can write.
 *  No data, no badge (Glasgow has no price at all today: Ticketmaster returns none for it). */
export function badgesFor(e: Pick<EveningEntry, 'labels' | 'priceMin' | 'priceCurrency'>): Badge[] {
  const out: Badge[] = [];
  if (e.labels.includes('Free')) out.push({ kind: 'free', text: 'Free' });
  const symbol = e.priceCurrency ? CURRENCY_SYMBOL[e.priceCurrency] : undefined;
  if (e.priceMin != null && e.priceMin > 0 && symbol && !out.length) {
    out.push({ kind: 'price', text: `${symbol}${Number.isInteger(e.priceMin) ? e.priceMin : e.priceMin.toFixed(2)}` });
  }
  return out;
}

const EARTH_M = 6_371_000;
export function distanceMetres(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.sqrt(h));
}

/** Approximate walking minutes: straight-line distance x 1.3 at 80 m a minute, so always shown as "approx". */
export function walkMinutes(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  return Math.round((distanceMetres(a, b) * 1.3) / 80);
}

export interface LatePlace { osmId: string; name: string; closing: string; end: string; lat?: number | null; lon?: number | null }
const squash = (v: string | null | undefined) => (v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
/** The event is at that very place ("Bed" at The Rum Shack, which is itself open late). */
function sameVenue(venue: string | null, place: string): boolean {
  const a = squash(venue), b = squash(place);
  return a !== '' && b !== '' && (a.includes(b) || b.includes(a));
}

export interface NightPair { event: EveningEntry; place: LatePlace; walk: number }

/** "Make a night of it": an upcoming event paired with an Open late place within WALK_MAX_MINUTES that is still open when the event is
 *  likely over (two hours after it starts). Both need coordinates; with none, no pair. The event's own venue is never its pair, nor is a place under WALK_MIN_MINUTES away. One pair per event and per place, closest first. */
export function pairNights(events: EveningEntry[], late: LatePlace[], now: Date, tz: string, max = NIGHT_MAX_PAIRS): NightPair[] {
  const candidates: NightPair[] = [];
  for (const e of events) {
    if (e.lat == null || e.lon == null || hasEnded({ start: e.start, end: e.end }, now, tz)) continue;
    const overAt = new Date(e.start).getTime() + 2 * 3_600_000;
    for (const p of late) {
      if (p.lat == null || p.lon == null || new Date(p.end).getTime() <= overAt) continue;
      const walk = walkMinutes({ lat: e.lat, lon: e.lon }, { lat: p.lat, lon: p.lon });
      if (walk >= WALK_MIN_MINUTES && walk <= WALK_MAX_MINUTES && !sameVenue(e.venue, p.name)) candidates.push({ event: e, place: p, walk });
    }
  }
  candidates.sort((a, b) => a.walk - b.walk || a.event.start.localeCompare(b.event.start) || a.place.name.localeCompare(b.place.name));
  const usedEvents = new Set<string>(), usedPlaces = new Set<string>(), out: NightPair[] = [];
  for (const c of candidates) {
    if (usedEvents.has(c.event.id) || usedPlaces.has(c.place.osmId)) continue;
    usedEvents.add(c.event.id); usedPlaces.add(c.place.osmId); out.push(c);
    if (out.length === max) break;
  }
  return out.sort((a, b) => a.event.start.localeCompare(b.event.start));
}

export interface Chip { area: string; count: number }

/** Area chips from the data itself: the areas with the most things on, biggest first, at most `max`. Rows with no area are only in "All". */
export function chipsFor(areas: Array<string | null | undefined>, max = 8): Chip[] {
  const counts = new Map<string, number>();
  for (const a of areas) if (a) counts.set(a, (counts.get(a) ?? 0) + 1);
  return [...counts].map(([area, count]) => ({ area, count })).sort((a, b) => b.count - a.count || a.area.localeCompare(b.area)).slice(0, max);
}

/** The filter: no area selected shows everything, otherwise only the cards in that area. */
export const matchesArea = (cardArea: string | null | undefined, selected: string | null) => selected === null || cardArea === selected;

export interface SurpriseCard { id: string; start: string; end: string | null; area: string | null; bucket: Bucket }

/** Cards "Surprise me" may pick: events (not Open late places) on now or starting within three hours, in the selected area. */
export function surpriseCandidates(cards: SurpriseCard[], now: Date, tz: string, area: string | null): SurpriseCard[] {
  return cards.filter((c) => c.bucket !== 'late' && matchesArea(c.area, area) && !hasEnded({ start: c.start, end: c.end }, now, tz)
    && new Date(c.start).getTime() - now.getTime() <= SURPRISE_WINDOW_MS);
}

export function surprisePick(cards: SurpriseCard[], now: Date, tz: string, area: string | null, random: () => number = Math.random): SurpriseCard | null {
  const pool = surpriseCandidates(cards, now, tz, area);
  return pool.length ? pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))] : null;
}

/** Next event to start after `now` (what the header's "Next up in 12 min" names), from cards that have not ended. */
export function nextUp<T extends { start: string }>(cards: T[], now: Date): T | null {
  const future = cards.filter((c) => new Date(c.start).getTime() > now.getTime()).sort((a, b) => a.start.localeCompare(b.start));
  return future[0] ?? null;
}

/** "in 12 min" / "in 1 h 5 min" for the header. */
export function untilLabel(startIso: string, now: Date): string {
  const min = Math.max(1, Math.ceil((new Date(startIso).getTime() - now.getTime()) / 60_000));
  return min < 60 ? `in ${min} min` : `in ${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;
}
