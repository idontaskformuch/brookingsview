/** Spec acceptance: no AI calls in any code path of the election pages (hard rule 1). */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const files: string[] = [];
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|astro|mjs)$/.test(name)) files.push(p);
  }
};
walk(join(root, 'election-results/src'));
for (const f of ['site/src/pages/election-results.astro', 'site/src/lib/election-results.ts', 'site/src/lib/election.ts', 'site/src/config/election.ts', 'site/src/pages/vote.astro']) {
  files.push(join(root, f));
}

describe('no AI in election code paths', () => {
  it('never imports or calls a model client or the content pipeline', () => {
    expect(files.length).toBeGreaterThan(10);
    const bad = files.filter((f) => /@anthropic-ai|from ['"]anthropic|openai|ai_pipeline|messages\.create|api\.anthropic\.com/i.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
});
