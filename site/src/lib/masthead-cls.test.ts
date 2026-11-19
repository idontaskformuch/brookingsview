import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// QA layout.masthead-no-shift (2026-11-19): measured CLS on the built Brookings front page at 1440 -- 0.024 from the theme toggle appearing
// (hidden until its script runs) and 0.07 from late web fonts moving the nav and status rows.
const layout = readFileSync(new URL('../layouts/BaseLayout.astro', import.meta.url), 'utf8');

describe('masthead and fonts do not move the page', () => {
  it('the masthead bar reserves the theme toggle height (2.25rem)', () => {
    const rule = /\.masthead__bar \{[^}]*\}/.exec(layout)?.[0] ?? '';
    expect(rule).toMatch(/min-height:\s*2\.25rem/);
    expect(/\.theme-toggle \{[^}]*height:\s*2\.25rem/.test(layout)).toBe(true);
  });
  it('Google Fonts are loaded with display=optional, never swap', () => {
    const hrefs = layout.match(/fonts\.googleapis\.com\/css2\?[^"]+/g) ?? [];
    expect(hrefs.length).toBeGreaterThan(0);
    for (const h of hrefs) expect(h).toContain('display=optional');
  });
});
