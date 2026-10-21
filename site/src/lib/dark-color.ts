/** Dark-mode counterpart of a light-mode accent hex (section accents, chip
 *  colors). Keeps hue and saturation, raises lightness in small steps until
 *  the color clears `min`:1 against the dark page's --surface, the stricter of
 *  the two dark backgrounds. Deterministic and pure, so a section's dark
 *  accent never needs a second hand-picked hex that could drift from the
 *  light one (towns' brand accents are the exception: explicit, see
 *  site-config.ts). */
import { contrastRatio } from './accent-contrast';
import { PAGE } from './status-tokens.mjs';

type Hsl = [number, number, number];

function hexToHsl(hex: string): Hsl {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, s, l];
}

function hslToHex([h, s, l]: Hsl): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return '#' + [r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
}

export function toDarkAccent(hex: string, background: string = PAGE.dark.surface, min = 5): string {
  const [h, s, l] = hexToHsl(hex);
  for (let light = l; light <= 0.97; light += 0.005) {
    const candidate = hslToHex([h, s, light]);
    if (contrastRatio(candidate, background) >= min) return candidate;
  }
  return '#f5f5f0';
}
