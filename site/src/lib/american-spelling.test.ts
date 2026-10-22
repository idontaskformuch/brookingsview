import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { forbiddenSpellingFor, findSpellingViolations } from './spelling-gate';

/** Static site copy follows the country of the town it serves: American for
 *  us towns, British for gb towns (symmetric gate, Glasgow Phase 1). Shared
 *  templates serve the US towns, so they must be American. Files that are
 *  British-only live under a `gb/` directory or are named `*.gb.ts|astro` and
 *  are checked against the British rule instead. AI-generated content is
 *  untouched (it is not in src/). Comment lines are skipped; proper nouns that
 *  really are spelled "Theatre" (venues) are not in the word lists. */
const GB_PATH = /(^|[\/])gb[\/]|\.gb\.(ts|astro)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(astro|ts)$/.test(name) && !name.endsWith('.test.ts') && name !== 'spelling-gate.ts') out.push(p);
  }
  return out;
}

function scan(files: string[], root: string, rule: RegExp): string[] {
  const hits: string[] = [];
  for (const file of files) {
    readFileSync(file, 'utf-8').split(/\r?\n/).forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('{/*')) return;
      const m = rule.exec(t);
      if (m) hits.push(`${file.replace(root, '')}:${i + 1}: ${m[0]}`);
    });
  }
  return hits;
}

describe('Spelling gate in static site text', () => {
  const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const files = walk(root);

  it('has no -ise/-our/-tre British spellings in templates or config meant for us towns', () => {
    const us = files.filter((f) => !GB_PATH.test(f.replace(root, '')));
    expect(scan(us, root, forbiddenSpellingFor('american'))).toEqual([]);
  });

  it('has no -ize/-or/-ter American spellings in gb-only templates or config', () => {
    const gb = files.filter((f) => GB_PATH.test(f.replace(root, '')));
    expect(scan(gb, root, forbiddenSpellingFor('british'))).toEqual([]);
  });

  it('flags the other country\'s spelling, both directions', () => {
    expect(findSpellingViolations('The neighbourhood centre in the colourful harbour', 'american'))
      .toEqual(['neighbourhood', 'centre', 'colourful', 'harbour']);
    expect(findSpellingViolations('The neighborhood center organizes a color program', 'british'))
      .toEqual(['neighborhood', 'center', 'organizes', 'color']);
    expect(findSpellingViolations('The neighbourhood centre organises a colour programme', 'british')).toEqual([]);
    expect(findSpellingViolations('The neighborhood center organizes a color program', 'american')).toEqual([]);
  });
});
