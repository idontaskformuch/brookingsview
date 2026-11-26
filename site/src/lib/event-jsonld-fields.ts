/**
 * Optional Event JSON-LD fields shared by every Event builder (lib/event-jsonld.ts, lib/ticketmaster-jsonld.ts, lib/holiday-page.ts):
 * Search Console's "missing field" notes (owner 2026-11-26) are answered here once, and only with real data -- a field without a
 * source value is left out, never filled with a guess.
 */

/** schema.org Offer, or undefined. An offer needs a price AND the date the sale opens (validFrom) from the source: without that
 *  date the whole offers field is left out (owner 2026-11-26, Broomfield's Search Console note "missing validFrom"). */
export function offerField(o: {
  price: number | null | undefined;
  currency: string | null | undefined;
  validFrom: string | null | undefined;
  url?: string | null;
}): Record<string, unknown> | undefined {
  if (o.price == null || !o.currency || !o.validFrom) return undefined;
  return {
    '@type': 'Offer',
    ...(o.url ? { url: o.url } : {}),
    price: o.price,
    priceCurrency: o.currency,
    availability: 'https://schema.org/InStock',
    validFrom: o.validFrom,
  };
}

/** "Kevin Bridges at OVO Hydro, Glasgow." -- a description made only of facts the page itself shows (the name and the place).
 *  Undefined when there is no place to say. */
export function placeDescription(name: string, place: string | null | undefined, city?: string | null): string | undefined {
  const where = (place ?? '').trim();
  if (!where) return undefined;
  const title = name.trim().replace(/[.]+$/, '');
  const town = (city ?? '').trim();
  const has = (text: string, part: string) => text.toLowerCase().includes(part.toLowerCase());
  // "Glasgow's Winter Wonderland, St Enoch Square": the name already says the place, so only the town is added (when it is not there)
  if (has(title, where)) return town && !has(title, town) ? `${title}, ${town}.` : undefined;
  const at = town && !has(where, town) ? `${where}, ${town}` : where;
  // "Community centres across Glasgow" is a description of places, not one place: "in community centres across Glasgow"
  return /\b(across|various|several|multiple|around)\b/i.test(where) ? `${title}, in ${at[0].toLowerCase()}${at.slice(1)}.` : `${title} at ${at}.`;
}

/** Discovery's promoter values that name nobody (Broomfield build 2026-11-26: "PROMOTED BY VENUE" = the venue itself, which the owner
 *  ruled out as organizer 2026-11-16; "MISCELLANEOUS PROMOTER"). */
const NOT_AN_ORGANIZER = /^(promoted by venue|misc(ellaneous|\.)? promoters?|other|none|unknown|n\/a|tbd|tba)$/i;

/** schema.org Organization for a source-named organizer, or undefined when the source names none (or a placeholder). */
export function organizerField(name: string | null | undefined): Record<string, unknown> | undefined {
  const n = (name ?? '').trim();
  return n && !NOT_AN_ORGANIZER.test(n) ? { '@type': 'Organization', name: n } : undefined;
}
