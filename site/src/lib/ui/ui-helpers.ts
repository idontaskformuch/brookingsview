/** Pure helpers behind the ui/ components, so the rules in .claude/standards.md are tested, not eyeballed. */

export const CATEGORIES = ['civic', 'music', 'family', 'sports', 'food', 'arts', 'nightlife'] as const;
export type Category = (typeof CATEGORIES)[number];

/** At most 6 categories per page type (not in total): a page picks its set here, the library knows all of them. */
export const CATEGORY_SETS = {
  tonight: ['music', 'nightlife', 'family', 'sports', 'food', 'arts'],
  meetings: ['civic'],
  cityHall: ['civic'],
  events: ['music', 'family', 'sports', 'food', 'arts', 'civic'],
} as const satisfies Record<string, readonly Category[]>;

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

export type TempUnit = 'F' | 'C';
/** Upper bounds of stops 1-5 of the --temp-N scale, defined once in degrees F and converted for C (stop 6 = at or above the last bound). */
export const TEMP_BOUNDS_F = [20, 40, 60, 78, 92] as const;
const toDisplay = (f: number, unit: TempUnit) => (unit === 'F' ? f : ((f - 32) * 5) / 9);
/** Temperature in the city's unit to the 1-6 stop of the --temp-N scale. */
export function tempStop(value: number, unit: TempUnit = 'F'): 1 | 2 | 3 | 4 | 5 | 6 {
  const i = TEMP_BOUNDS_F.findIndex((b) => value < toDisplay(b, unit));
  return ((i === -1 ? 5 : i) + 1) as 1 | 2 | 3 | 4 | 5 | 6;
}

/** Minutes since midnight to a percentage of the shown window; null outside it. */
export function windowPercent(fromMin: number, toMin: number, atMin: number): number | null {
  if (toMin <= fromMin || atMin < fromMin || atMin > toMin) return null;
  return ((atMin - fromMin) / (toMin - fromMin)) * 100;
}
