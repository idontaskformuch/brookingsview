/** Designsystem Fas 2 (owner 2026-11-20), data hygiene before rendering: prices and template punctuation. Pure, no site config.
 *  Title capitals are lib/evening-names.ts displayTitle (the one re-casing rule, used by every event row).
 *
 *  Price: .00/.50 exactly, other pennies rounded; a range as "$25–160" (Ticketmaster's "$25.43 - $159.33", What's On Brookings),
 *  low end down and high end up. "Free" when the source says free. No price, nothing shown (null).
 *  Punctuation: a template that ends a sentence after a value must not add a second period when the value already ends with one
 *  ("Gates open ..., about 12:30 p.m.." on /game-day/, Brookings build 2026-11-12). */

const SYMBOL: Record<string, string> = { USD: '$', GBP: '£', EUR: '€' };

/** Owner 2026-11-20: an amount ending in .00 or .50 is shown exactly ("$20", "£12.50"); any other pennies are rounded, to the nearest
 *  unit for one price ("$25.43" -> "$25", "£30.62" -> "£31"), down for the low end of a range and up for the high end, so the range
 *  always contains the real price ("$25.43 - $159.33" -> "$25–160"). */
type Rounding = 'nearest' | 'down' | 'up';
export function formatAmount(amount: number, rounding: Rounding = 'nearest'): string {
  const cents = Math.round(amount * 100);
  if (cents % 100 === 0) return String(cents / 100);
  if (cents % 100 === 50) return (cents / 100).toFixed(2);
  return String(rounding === 'down' ? Math.floor(amount) : rounding === 'up' ? Math.ceil(amount) : Math.round(amount));
}

/** "$25–160", "$40", "£21.50–53.50", "GBP 10–20" for a currency without a symbol. null without both ends. */
export function formatPriceRange(min: number | null | undefined, max: number | null | undefined, currency: string | null | undefined): string | null {
  if (min == null || max == null || !Number.isFinite(min) || !Number.isFinite(max)) return null;
  const sym = currency ? (SYMBOL[currency] ?? `${currency} `) : '$';
  if (Math.round(min * 100) === Math.round(max * 100)) return `${sym}${formatAmount(min)}`;
  const lo = formatAmount(min, 'down'), hi = formatAmount(max, 'up');
  return lo === hi ? `${sym}${lo}` : `${sym}${lo}–${hi}`;
}

/** One price: 30.62 -> "£31", 12.5 -> "£12.50". */
export function formatPrice(amount: number, currency: string | null | undefined): string | null {
  const sym = currency ? SYMBOL[currency] : undefined;
  return sym && Number.isFinite(amount) ? `${sym}${formatAmount(amount)}` : null;
}

/** A source's own cost text (stories.meta.cost): every amount by formatAmount ("£30.62" -> "£31", "£12.50" stays, "£3.00" -> "£3");
 *  a written range ("£21.30 to £53.70", "$25.43 - $159.33") rounds its low end down and its high end up. "free" said by the source ->
 *  "Free". Everything else exactly as written ("£8/ £6", "Payment required"). null/blank -> null. */
export function tidyCost(cost: string | null | undefined): string | null {
  const t = (cost ?? '').trim();
  if (!t) return null;
  if (/^free$/i.test(t)) return 'Free';
  const num = (whole: string, frac: string | undefined) => Number(frac ? `${whole}.${frac}` : whole);
  return t
    .replace(/([$£€])\s?(\d{1,6})(?:\.(\d{1,2}))?(\s*(?:-|–|—|to)\s*)([$£€])?\s?(\d{1,6})(?:\.(\d{1,2}))?\b/g,
      (_m, s1: string, w1: string, f1: string | undefined, sep: string, s2: string | undefined, w2: string, f2: string | undefined) =>
        `${s1}${formatAmount(num(w1, f1), 'down')}${sep}${s2 ?? ''}${formatAmount(num(w2, f2), 'up')}`)
    .replace(/([$£€])\s?(\d{1,6})\.(\d{1,2})\b/g, (_m, sym: string, whole: string, frac: string) => `${sym}${formatAmount(num(whole, frac))}`);
}

/** End a sentence with exactly one period: "about 12:30 p.m." stays, "about 2 PM" gets one. A sentence already ending in "!" or "?"
 *  is left alone. */
export function endSentence(text: string): string {
  const t = text.replace(/\s+$/, '');
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}
