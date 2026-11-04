import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// GEO spec punkt 2: crawlers do not run JS, so the raw HTML of /election-results/ must say what the
// page is and where the official numbers are, never "Results will appear after polls close" (false once polls close).
describe('election-results static fallback', () => {
  const src = readFileSync(new URL('../pages/election-results.astro', import.meta.url), 'utf8');
  it('does not promise future results in the server-rendered status', () => {
    const idx = src.indexOf('id="er-status"');
    expect(idx).toBeGreaterThan(0);
    expect(src.slice(idx, idx + 400)).not.toMatch(/will appear after polls close/);
  });
  it('names the official source in the live fallback and the noscript text', () => {
    expect(src).toMatch(/load in your browser from \{results\.source_name\}/);
    expect(src).toMatch(/<noscript>.*results\.source_name/);
  });
});
