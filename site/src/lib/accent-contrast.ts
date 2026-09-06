/** Local Accent Identity -- build-time WCAG contrast enforcement for each
 *  town's optional `brand` accent pair (see site-config.ts's SiteConfig.brand).
 *
 *  Pure, no DB/env dependency -- unlike build-checks.ts's checks, this can be
 *  (and is) unit-tested directly with plain hex strings.
 *
 *  Checked against `PAGE_BACKGROUND`, the real page background accent text
 *  and boundaries actually render against (BaseLayout.astro's --surface,
 *  #ffffff -- the masthead/nav bar), not --paper (#f4f6f7, the body
 *  background), since #ffffff is the stricter (marginally lower-contrast)
 *  of the two and both are close enough that one check covers both in
 *  practice.
 *
 *  All three ratios from the handoff spec's table are enforced unconditionally
 *  for every town with a `brand` block, even though this rollout's actual
 *  usage (see BaseLayout.astro) only exercises the first two (accentInk as
 *  real text/interactive color, accent as a non-text active-state indicator)
 *  -- the third (text on a filled accent surface) is checked too so a future
 *  use of accent as a filled background can't silently ship an unreadable
 *  color with no build-time signal. */

export interface BrandTokens {
  accent: string;
  accentInk: string;
}

const PAGE_BACKGROUND = '#ffffff';
const WHITE_TEXT = '#ffffff';

const MIN_ACCENT_INK_TEXT = 4.5;
const MIN_ACCENT_NON_TEXT = 3;
const MIN_TEXT_ON_FILLED_ACCENT = 4.5;

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio, 1:1 (identical) to 21:1 (black on white). */
export function contrastRatio(hexA: string, hexB: string): number {
  const l1 = relativeLuminance(hexA);
  const l2 = relativeLuminance(hexB);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Throws a named error identifying the town, the token, and the measured
 *  ratio the moment any of the three required ratios comes up short -- per
 *  the handoff spec's "fails loud, not aspirational" requirement. No
 *  known-exception mechanism (unlike build-checks.ts's venue-matching gap):
 *  a failing color has no "not wired up yet" excuse, it's just the wrong
 *  color -- darken accentInk (or accent, if it will ever hold text) and
 *  re-run. Called once per build from BaseLayout.astro. A town with no
 *  `brand` block is a no-op: it falls back to the shared navy palette,
 *  already known-safe. */
export function assertAccentContrast(townId: string, brand: BrandTokens | undefined): void {
  if (!brand) return;

  const inkRatio = contrastRatio(brand.accentInk, PAGE_BACKGROUND);
  if (inkRatio < MIN_ACCENT_INK_TEXT) {
    throw new Error(
      `Build-time accent contrast check failed for "${townId}": accentInk (${brand.accentInk}) ` +
      `measures ${inkRatio.toFixed(2)}:1 against the page background (${PAGE_BACKGROUND}), below ` +
      `the required ${MIN_ACCENT_INK_TEXT}:1 for text/interactive use. Darken accentInk.`,
    );
  }

  const accentRatio = contrastRatio(brand.accent, PAGE_BACKGROUND);
  if (accentRatio < MIN_ACCENT_NON_TEXT) {
    throw new Error(
      `Build-time accent contrast check failed for "${townId}": accent (${brand.accent}) measures ` +
      `${accentRatio.toFixed(2)}:1 against the page background (${PAGE_BACKGROUND}), below the ` +
      `required ${MIN_ACCENT_NON_TEXT}:1 for UI boundaries/non-text indicators.`,
    );
  }

  const filledRatio = contrastRatio(WHITE_TEXT, brand.accent);
  if (filledRatio < MIN_TEXT_ON_FILLED_ACCENT) {
    throw new Error(
      `Build-time accent contrast check failed for "${townId}": white text on a filled accent ` +
      `(${brand.accent}) surface measures ${filledRatio.toFixed(2)}:1, below the required ` +
      `${MIN_TEXT_ON_FILLED_ACCENT}:1. Darken accent if it will ever hold text, or keep it strictly decorative.`,
    );
  }
}
