/** Designsystem Fas 2 (owner 2026-11-20), data hygiene before rendering: prices and template punctuation. Pure, no site config.
 *  Title capitals are lib/evening-names.ts displayTitle (the one re-casing rule, used by every event row).
 *
 *  Price: whole currency units, a range as "$25–159" (Ticketmaster's "$25.43 - $159.33", What's On Brookings). "Free" when the
 *  source says free. No price, nothing shown (null).
 *  Punctuation: a template that ends a sentence after a value must not add a second period when the value already ends with one
 *  ("Gates open ..., about 12:30 p.m.." on /game-day/, Brookings build 2026-11-12). */

const SYMBOL: Record<string, string> = { USD: '$', GBP: '£', EUR: '€' };

/** "$25–159", "$40", "GBP 10–20" for a currency without a symbol. null without both ends. Rounded to whole units. */
export function formatPriceRange(min: number | null | undefined, max: number | null | undefined, currency: string | null | undefined): string | null {
  if (min == null || max == null || !Number.isFinite(min) || !Number.isFinite(max)) return null;
  const sym = currency ? (SYMBOL[currency] ?? `${currency} `) : '$';
  const lo = Math.round(min), hi = Math.round(max);
  return lo === hi ? `${sym}${lo}` : `${sym}${lo}–${hi}`;
}

/** One price, whole units: 30.62 -> "£31". */
export function formatPrice(amount: number, currency: string | null | undefined): string | null {
  const sym = currency ? SYMBOL[currency] : undefined;
  return sym && Number.isFinite(amount) ? `${sym}${Math.round(amount)}` : null;
}

/** A source's own cost text (stories.meta.cost): every amount with pennies rounded to whole units ("£30.62" -> "£31", "£7.84" -> "£8"),
 *  "free" said by the source -> "Free". Everything else exactly as written ("£8/ £6", "Payment required"). null/blank -> null. */
export function tidyCost(cost: string | null | undefined): string | null {
  const t = (cost ?? '').trim();
  if (!t) return null;
  if (/^free$/i.test(t)) return 'Free';
  return t.replace(/([$£€])\s?(\d{1,6})\.(\d{1,2})\b/g, (_m, sym: string, whole: string, frac: string) =>
    `${sym}${Math.round(Number(`${whole}.${frac}`))}`);
}

/** End a sentence with exactly one period: "about 12:30 p.m." stays, "about 2 PM" gets one. A sentence already ending in "!" or "?"
 *  is left alone. */
export function endSentence(text: string): string {
  const t = text.replace(/\s+$/, '');
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}
