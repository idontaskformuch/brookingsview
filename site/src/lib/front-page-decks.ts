/** Deck sentences of the front-page lead and secondaries: deterministic templates over data fields, never model text. A sentence is built only
 *  from fields that exist; a missing field drops the whole sentence. Phase 1 holds the minimal one-sentence form of each type; the full
 *  variants (plurals in every sentence, locale words, procedural-keyword config) are Phase 2. */

export const plural = (n: number, one: string, many: string = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** Cut at a word boundary at or below `max` characters, never mid-word; the text is returned whole when it fits. */
export function truncateAtWord(text: string, max = 80): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const at = cut.lastIndexOf(' ');
  return (at > 0 ? cut.slice(0, at) : t.slice(0, max)).replace(/[\s,;:.\-–—]+$/, '');
}

/** "a", "a and b", "a, b and c". */
export function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** "Fri, Nov 6" style day: weekday name for a UTC-midnight day number. */
export function weekdayName(day: number, locale: 'en-US' | 'en-GB'): string {
  return new Date(day * 86_400_000).toLocaleDateString(locale, { weekday: 'long', timeZone: 'UTC' });
}

export function dateLong(day: number, locale: 'en-US' | 'en-GB'): string {
  return new Date(day * 86_400_000).toLocaleDateString(locale, locale === 'en-GB'
    ? { day: 'numeric', month: 'long', timeZone: 'UTC' }
    : { month: 'long', day: 'numeric', timeZone: 'UTC' });
}

export interface ShowRef { title: string; venue: string | null; /** Straight-line miles from the town center; only a regional show is described with it. */ miles?: number | null }

const KM_PER_MILE = 1.609344;
const awayText = (miles: number, unit: 'miles' | 'km'): string => (unit === 'km' ? `~${Math.round(miles * KM_PER_MILE)} km away` : `~${Math.round(miles)} miles away`);

/** In town:  "{n} events in {City} {when}, including {top1} at {venue1} and {top2} at {venue2}."
 *  Regional: "{n} events near {City} {when}, including {top1} at {venue1} (~13 miles away) and ..." (km for Britain). Owner 2026-11-07: "in {City}" is
 *  said only of events in the town; shows further out are "near", each with its distance. */
export function eventsDeck(o: { n: number; city: string; when: string; tops: ShowRef[]; scope?: 'in' | 'near'; unit?: 'miles' | 'km' }): string {
  const near = o.scope === 'near';
  const lead = `${plural(o.n, 'event')} ${near ? 'near' : 'in'} ${o.city} ${o.when}`;
  const named = o.tops.slice(0, 2).map((t) => {
    const base = t.venue ? `${t.title} at ${t.venue}` : t.title;
    return near && t.miles != null ? `${base} (${awayText(t.miles, o.unit ?? 'miles')})` : base;
  });
  return named.length > 0 ? `${lead}, including ${joinList(named)}.` : `${lead}.`;
}

/** "{Body} meets {weekday} at {time} with {n} items on the agenda, including {item1} and {item2}." */
export function meetingDeck(o: { body: string; weekday: string; time: string | null; items: string[] }): string {
  const at = o.time ? ` at ${o.time}` : '';
  const picked = o.items.slice(0, 2).map((t) => truncateAtWord(t));
  if (o.items.length === 0) return `${o.body} meets ${o.weekday}${at}.`;
  return `${o.body} meets ${o.weekday}${at} with ${plural(o.items.length, 'item')} on the agenda, including ${joinList(picked)}.`;
}
