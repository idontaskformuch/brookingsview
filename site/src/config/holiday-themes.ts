/** Holiday theme tokens (owner 2026-11-26, .claude/specs/design-lift-holiday-2026-11-26.md): a season's two colours, used ONLY on
 *  lines, date tiles and the small ornament by a section heading. No snowflakes, glitter or animation. One mechanism for every holiday:
 *  a page def names its theme by holiday id; a holiday without an entry keeps the site's own accent.
 *  Contrast: `ink` on the page background and `on` on `ink` are AA (>= 4.5:1) in both schemes (lib/holiday-festive.test.ts). */
import type { HolidayId } from './holidays';

export interface ThemeColours {
  /** lines, the date tile's fill, the strip's dots */
  ink: string;
  /** text on `ink` (the date tile) */
  on: string;
  /** the second colour: ornament, featured card's top line, "closed" marks */
  warm: string;
}
export interface HolidayTheme { light: ThemeColours; dark: ThemeColours }

export const HOLIDAY_THEMES: Partial<Record<HolidayId, HolidayTheme>> = {
  // deep spruce + warm gold
  christmas: {
    light: { ink: '#1d4a37', on: '#fbf7ec', warm: '#8a6414' },
    dark: { ink: '#8fc7a9', on: '#0f1f18', warm: '#e2b65c' },
  },
  // autumn: deep russet + harvest gold
  thanksgiving: {
    light: { ink: '#7a3412', on: '#fdf6ee', warm: '#8a5a0c' },
    dark: { ink: '#e8a77e', on: '#2a1208', warm: '#e6b45a' },
  },
};

/** The CSS custom properties for a theme, set on the page wrapper; the dark set is picked by the site's own scheme rules. */
export function themeStyle(t: HolidayTheme | undefined): string {
  if (!t) return '';
  return [
    `--hol-ink-l:${t.light.ink}`, `--hol-on-l:${t.light.on}`, `--hol-warm-l:${t.light.warm}`,
    `--hol-ink-d:${t.dark.ink}`, `--hol-on-d:${t.dark.on}`, `--hol-warm-d:${t.dark.warm}`,
  ].join(';');
}
