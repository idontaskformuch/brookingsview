/** Card layout of /tonight (spec .claude/specs/tonight-cards.md): the pure rules behind the cards. Used at build time for the HTML
 *  fallback and in the browser (lib/tonight-cards-client.ts) for the live parts, so the two can never disagree.
 *  Nothing here guesses: a price, a badge or a walk time exists only when the data states it. */
import type { EveningEntry, EveningGroup } from './evening-items';
import { countryProfile, type CountryId } from './country-profile';
import { hasEnded } from './local-day';
import { showTimeGb } from './whats-on-dates';
import { CHIP_MIN_ITEMS, CHIP_MIN_CHIPS as UI_CHIP_MIN_CHIPS, type Category } from './ui/ui-helpers';

/** Card colour buckets. The three event categories and Open late each have an accent; everything else is neutral "Also on". */
export type Bucket = 'music' | 'comedy' | 'theatre' | 'late' | 'other';
/** Library category colour per bucket (Tonight's set is CATEGORY_SETS.tonight); null = uncategorised, drawn neutral. */
export const BUCKET_CATEGORY: Record<Bucket, Category | null> = { music: 'music', comedy: 'nightlife', theatre: 'arts', late: 'food', other: null };
export const BUCKET_LABEL: Record<Bucket, string> = { music: 'Live music', comedy: 'Comedy & shows', theatre: 'Theatre', late: 'Open tonight', other: 'Also on' };
/** The bucket's heading as the reader sees it: "Theater" in a US town. */
export const bucketLabel = (bucket: Bucket, country: string): string => (bucket === 'theatre' && countryProfile(country as CountryId).spelling === 'american' ? 'Theater' : BUCKET_LABEL[bucket]);
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
export function badgesFor(e: Pick<EveningEntry, 'labels' | 'priceMin' | 'priceCurrency'>, hidePrice = false): Badge[] {
  const out: Badge[] = [];
  if (e.labels.includes('Free')) out.push({ kind: 'free', text: 'Free' });
  const symbol = e.priceCurrency ? CURRENCY_SYMBOL[e.priceCurrency] : undefined;
  // hidePrice: the US towns, until we know what Ticketmaster's priceRanges contain (fees in or out; owner 2026-11-04)
  if (!hidePrice && e.priceMin != null && e.priceMin > 0 && symbol && !out.length) {
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

/** Town facts the card needs: country (spelling), and for the US towns the home city and center behind "Denver · 15 mi". */
export interface CardTown { country: string; homeCity: string; center: { lat: number; lon: number }; hidePrice?: boolean; cityLabels?: boolean; /** siteConfig.bigShows.enabled: Ticketmaster rows are "big shows" (see isBigShow). */ bigShows?: boolean }

const METERS_PER_MILE = 1609.344;
export type CityScope = 'home' | 'near' | 'unknown';
const sameCity = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Where the event is, by the source's own venue city: the home town, somewhere else ("nearby"), or unknown (no city stated: never guessed). */
export function cityScope(venueCity: string | null | undefined, homeCity: string): CityScope {
  if (!venueCity) return 'unknown';
  return sameCity(venueCity, homeCity) ? 'home' : 'near';
}

export interface CityLabel { text: string; title: string | null }

/** "Denver · 15 mi" for an event outside the home town, null when the source states no city or the city is the home town. The distance is
 *  straight-line from the town center, computed from the venue's coordinates and rounded to whole miles ("<1 mi" under half a mile);
 *  without coordinates only the city name shows. */
export function cityLabel(e: Pick<EveningEntry, 'venueCity' | 'lat' | 'lon'>, homeCity: string, center: { lat: number; lon: number }): CityLabel | null {
  if (cityScope(e.venueCity, homeCity) !== 'near') return null;
  if (e.lat == null || e.lon == null) return { text: e.venueCity!, title: null };
  const miles = Math.round(distanceMetres(center, { lat: e.lat, lon: e.lon }) / METERS_PER_MILE);
  return { text: `${e.venueCity} · ${miles < 1 ? '<1' : miles} mi`, title: `About ${miles < 1 ? 'less than 1' : miles} ${miles === 1 ? 'mile' : 'miles'} in a straight line from the center of ${homeCity}, not a driving distance` };
}

/** Owner 2026-11-06 (Broomfield): where bigShows is on, a Ticketmaster row is a big show. It is shown on the page but never counted in the
 *  header's "N things on tonight", the scope line or "Next up"; a separate line says "+ N big shows nearby". */
export const isBigShow = (e: Pick<EveningEntry, 'source'>, bigShowsOn: boolean | undefined): boolean => !!bigShowsOn && e.source === 'ticketmaster';

/** Splits rows into the ones the header counts and the big shows it only mentions. The ONE place that decision is made (page and browser both call it). */
export function partitionBig<T>(items: T[], isBig: (item: T) => boolean): { local: T[]; big: T[] } {
  return { local: items.filter((i) => !isBig(i)), big: items.filter(isBig) };
}

/** "+ 3 big shows nearby"; null for none. */
export function bigShowsLine(n: number): string | null {
  return n > 0 ? `+ ${n} big ${n === 1 ? 'show' : 'shows'} nearby` : null;
}

/** "Denver · 15 mi" for every big show, the home city included ("Broomfield · 2 mi"). Miles are straight-line from the town center, from the
 *  venue's coordinates (else the distance Ticketmaster states). No city: the miles alone. Neither: null. */
export function bigShowLabel(e: Pick<EveningEntry, 'venueCity' | 'lat' | 'lon' | 'distanceMiles'>, homeCity: string, center: { lat: number; lon: number }): CityLabel | null {
  const raw = e.lat != null && e.lon != null ? distanceMetres(center, { lat: e.lat, lon: e.lon }) / METERS_PER_MILE : e.distanceMiles;
  const miles = raw == null ? null : Math.round(raw);
  const milesText = miles == null ? null : `${miles < 1 ? '<1' : miles} mi`;
  const text = [e.venueCity, milesText].filter(Boolean).join(' · ');
  if (!text) return null;
  const title = miles == null ? null : `About ${miles < 1 ? 'less than 1' : miles} ${miles === 1 ? 'mile' : 'miles'} in a straight line from the center of ${homeCity}, not a driving distance.`;
  return { text, title };
}

/** The city label of one /tonight event row: big shows get bigShowLabel (home city included), other events cityLabel (null in the home town); null on towns without cityLabels. */
export function eventCityLabel(e: Pick<EveningEntry, 'source' | 'venueCity' | 'lat' | 'lon' | 'distanceMiles'>, town: CardTown): CityLabel | null {
  if (!town.cityLabels) return null;
  return isBigShow(e, town.bigShows) ? bigShowLabel(e, town.homeCity, town.center) : cityLabel(e, town.homeCity, town.center);
}

/** The second header line: "12 in Broomfield · 31 nearby". Only shown when something is outside town. "In <town>" is only said when every event
 *  tonight has a known city (a count that leaves unknowns out would claim less than is true); "nearby" counts what we know is outside. */
export function scopeLine(counts: { home: number; near: number; unknown: number }, homeCity: string): string | null {
  if (counts.near === 0) return null;
  return `${counts.unknown === 0 && counts.home > 0 ? `${counts.home} in ${homeCity} · ` : ''}${counts.near} nearby`;
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

/** The town's coarse areas for the chips (siteConfig.eveningLayer.cards.regions): region -> the OSM neighbourhoods inside it. Key order = chip order. */
export type Regions = Record<string, string[]>;

/** The region a neighbourhood belongs to, or null (the card then only shows under "All"). */
export function regionOf(area: string | null | undefined, regions: Regions): string | null {
  if (!area) return null;
  for (const [region, hoods] of Object.entries(regions)) if (hoods.includes(area)) return region;
  return null;
}

/** Neighbourhoods that appear in the data but in no region, sorted: logged at build so the owner can map them. */
export function unmappedAreas(areas: Array<string | null | undefined>, regions: Regions): string[] {
  return [...new Set(areas.filter((a): a is string => !!a && regionOf(a, regions) === null))].sort();
}

/** A chip needs this many things tonight (events + Open late places: what a tap actually shows); the row needs this many chips. */
/** One rule for chips sitewide: the library's (lib/ui/ui-helpers.ts planChips). */
export const CHIP_MIN_THINGS = CHIP_MIN_ITEMS;
export const CHIP_MIN_CHIPS = UI_CHIP_MIN_CHIPS;

export interface ChipPlan { visible: string[]; showRow: boolean }

/** Which region chips show. Chips carry no number, so this is the only place counts matter. The selected region stays visible while it is
 *  selected; the row hides altogether with fewer than CHIP_MIN_CHIPS qualifying chips. `order` is the config order. */
export function chipPlan(counts: Record<string, number>, order: string[], selected: string | null): ChipPlan {
  const qualifying = order.filter((r) => (counts[r] ?? 0) >= CHIP_MIN_THINGS);
  return { visible: order.filter((r) => qualifying.includes(r) || r === selected), showRow: qualifying.length >= CHIP_MIN_CHIPS };
}

/** Things per region from cards' regions (null = unmapped, counted nowhere). */
export function countByRegion(regions: Array<string | null | undefined>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of regions) if (r) out[r] = (out[r] ?? 0) + 1;
  return out;
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

/** What an evening's section shows, from what is still to come in it: everything; only the Open late row (the heading and event rows would be
 *  empty); or nothing. Counted on what has not ended, whatever the area filter says. */
export type DayView = 'full' | 'late-only' | 'hidden';
export function dayView(counts: { events: number; late: number }): DayView {
  if (counts.events > 0) return 'full';
  return counts.late > 0 ? 'late-only' : 'hidden';
}

export interface Hero {
  kind: 'count' | 'empty';
  /** kind 'count': the big number and the words after it. */
  count?: number;
  label?: string;
  /** kind 'empty': the line, and the link to tomorrow night when there is something to point at. */
  text?: string;
  tomorrow?: string | null;
}

/** The header of /tonight. Never "0 things": with no event left it says so, and counts the Open late places still to come, or points at tomorrow. */
export function heroFor(o: { events: number; late: number; tomorrow: number; word: string }): Hero {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (o.events > 0) return { kind: 'count', count: o.events, label: `${o.events === 1 ? 'thing' : 'things'} on ${o.word}` };
  if (o.late > 0) return { kind: 'empty', text: `Nothing else scheduled ${o.word} · ${plural(o.late, 'place', 'places')} open late`, tomorrow: null };
  return { kind: 'empty', text: `Nothing else on ${o.word}`, tomorrow: o.tomorrow > 0 ? `Tomorrow: ${plural(o.tomorrow, 'thing', 'things')}` : null };
}

/** "in 12 min" / "in 1 h 5 min" for the header. */
export function untilLabel(startIso: string, now: Date): string {
  const min = Math.max(1, Math.ceil((new Date(startIso).getTime() - now.getTime()) / 60_000));
  return min < 60 ? `in ${min} min` : `in ${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;
}
