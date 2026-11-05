/** Pure helpers behind the ui/ components, so the rules in .claude/standards.md are tested, not eyeballed. */

export const CATEGORIES = ['civic', 'music', 'family', 'sports', 'food', 'arts'] as const;
export type Category = (typeof CATEGORIES)[number];

/** Chips rule (standards: Chips): a chip needs >= 3 items, at least 2 chips must qualify, and the label never carries a number
 *  (a count would disagree with whatever header counts something else). Fewer than 2 qualifying chips -> no chip row at all. */
export const CHIP_MIN_ITEMS = 3;
export const CHIP_MIN_CHIPS = 2;
export function planChips(counts: Record<string, number>): string[] {
  const out = Object.entries(counts)
    .filter(([label, n]) => n >= CHIP_MIN_ITEMS && label.trim() !== '' && !/\d/.test(label))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label]) => label);
  return out.length >= CHIP_MIN_CHIPS ? out : [];
}

/** Position of a span on a scale as percentages, clamped to 0-100. null when the data is missing or inverted (the bar is then not drawn). */
export function spanPercent(scaleMin: number, scaleMax: number, low: number, high: number): { left: number; width: number } | null {
  if (![scaleMin, scaleMax, low, high].every(Number.isFinite) || scaleMax <= scaleMin || high < low) return null;
  const pct = (v: number) => Math.min(100, Math.max(0, ((v - scaleMin) / (scaleMax - scaleMin)) * 100));
  const left = pct(low);
  return { left, width: Math.max(pct(high) - left, 2) };
}
export function pointPercent(scaleMin: number, scaleMax: number, v: number): number | null {
  const s = spanPercent(scaleMin, scaleMax, v, v);
  return s ? s.left : null;
}

/** Temperature (degrees F) to the 1-6 stop of the --temp-N scale. */
export function tempStop(f: number): 1 | 2 | 3 | 4 | 5 | 6 {
  if (f < 20) return 1;
  if (f < 40) return 2;
  if (f < 60) return 3;
  if (f < 78) return 4;
  if (f < 92) return 5;
  return 6;
}

/** Minutes since midnight to a percentage of the shown window; null outside it. */
export function windowPercent(fromMin: number, toMin: number, atMin: number): number | null {
  if (toMin <= fromMin || atMin < fromMin || atMin > toMin) return null;
  return ((atMin - fromMin) / (toMin - fromMin)) * 100;
}
