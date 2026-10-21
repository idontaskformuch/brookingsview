import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Static site copy is American English. AI-generated content is untouched
 *  (it is not in src/). Comment lines are skipped; proper nouns that really are
 *  spelled "Theatre" (venues) are not in the word list. */
const BRITISH = /\b(organis\w*|summaris\w*|recognis\w*|customis\w*|specialis\w*|apologis\w*|colour\w*|neighbour\w*|favourite\w*|behaviour\w*|honour\w*|labour\w*|harbour\w*|flavour\w*|centre\w*|metre\w*|litre\w*|fibre\w*)\b/i;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(astro|ts)$/.test(name) && !name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

describe('American spelling in static site text', () => {
  it('has no -ise/-our/-tre British spellings in templates or config', () => {
    const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const hits: string[] = [];
    for (const file of walk(root)) {
      readFileSync(file, 'utf-8').split(/\r?\n/).forEach((line, i) => {
        const t = line.trim();
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('{/*')) return;
        const m = BRITISH.exec(t);
        if (m) hits.push(`${file.replace(root, '')}:${i + 1}: ${m[0]}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
