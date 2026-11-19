import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, basename, relative } from 'node:path';

// QA build.no-self-import (2026-11-19, Fas 3): components/answers/AnswerBlocks.astro imported itself for nested blocks; the cycle made the
// build drop every page's stylesheet links (dist/*.html had no /_astro/*.css, every page unstyled) with exit 0. Recursion uses Astro.self.
const SRC = join(__dirname, '..');
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : f.endsWith('.astro') ? [p] : []; });
}

describe('no .astro component imports itself', () => {
  it('every component recurses through Astro.self, never a self-import', () => {
    const hits = walk(SRC).filter((p) => new RegExp(`import\s+\w+\s+from\s+['"]\./${basename(p).replace('.', '\.')}['"]`).test(readFileSync(p, 'utf8')))
      .map((p) => relative(SRC, p));
    expect(hits).toEqual([]);
  });
});
