// QA build.no-dead-image-urls (Fas 1a 2026-11-18): integrations/image-variants.mjs makes the WebP variants a page references and reports
// every /assets/images/ URL in the built HTML that has no file.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildVariantsAndCheck } from '../../integrations/image-variants.mjs';
import { responsiveSrc } from './city-face';

const PUBLIC = join(__dirname, '..', '..', 'public');

describe('image variants + dead image URL check', () => {
  it('writes the referenced variants and reports a URL with no file', async () => {
    const out = mkdtempSync(join(tmpdir(), 'iv-'));
    // A real pool photo (config/this-week-images.ts broomfield_co-autumn-04) and a URL whose source does not exist.
    const r = responsiveSrc('/assets/images/this-week/broomfield_co-autumn-04.jpg');
    mkdirSync(join(out, 'a'), { recursive: true });
    writeFileSync(join(out, 'a', 'index.html'), `<img src="${r.src}" srcset="${r.srcset}"><img src="/assets/images/this-week/no-such-photo-640.webp"><img src="/assets/images/categories/missing.png">`);
    const dead = await buildVariantsAndCheck(out, PUBLIC);
    for (const w of [640, 960, 1200]) {
      const f = join(out, 'assets', 'images', 'this-week', `broomfield_co-autumn-04-${w}.webp`);
      expect(existsSync(f), String(w)).toBe(true);
      expect(readFileSync(f).subarray(8, 12).toString()).toBe('WEBP');
    }
    expect(dead.map((d: string) => d.split(' ')[0]).sort()).toEqual([
      '/assets/images/categories/missing.png', '/assets/images/this-week/no-such-photo-640.webp',
    ]);
  });
});
