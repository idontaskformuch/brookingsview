import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_CONFIGS } from '../site-config';

/** standards.md: "Städer får inte ha kodvägar i layouten". Layout code (the ui library, the standard-layout components and
 *  their pure rules) may not branch on which town or country it is; differences live in site.config / country profiles. */
const SRC = join(__dirname, '..', '..');
const LAYOUT_DIRS = ['components/ui', 'components/tonight', 'components/meetings', 'components/evening'];
const LAYOUT_FILES = ['components/SectionNav.astro', 'components/HolidayPage.astro', 'lib/tonight-cards.ts', 'lib/tonight-cards-client.ts', 'lib/ui/ui-helpers.ts', 'lib/ui/icons.ts'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(astro|ts)$/.test(f) && !/\.test\.ts$/.test(f) ? [p] : [];
  });
}
const files = [...LAYOUT_DIRS.flatMap((d) => walk(join(SRC, d))), ...LAYOUT_FILES.map((f) => join(SRC, f))];
/** Strip comments so prose may mention a town. */
const code = (p: string) => readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const BRANCH = /\b(townId|country|siteConfig\.id)\s*(===|!==|==|!=)|\bcase\s+['"](us|gb|[a-z]+_[a-z]{2})['"]\s*:/;
const TOWN_NAMES = new RegExp(`\b(${['Brookings', 'Moreno Valley', 'Broomfield', 'Glasgow'].join('|')})\b`, 'i');

describe('standard layouts have no town/country code paths', () => {
  it('scans a meaningful set of files', () => {
    expect(files.length).toBeGreaterThan(25);
  });
  it('no file branches on townId / country', () => {
    const hits = files.filter((p) => BRANCH.test(code(p))).map((p) => relative(SRC, p));
    expect(hits).toEqual([]);
  });
  it('no layout file names a town in code', () => {
    const hits = files.filter((p) => TOWN_NAMES.test(code(p))).map((p) => relative(SRC, p));
    expect(hits).toEqual([]);
  });
  it('every town config provides what the layouts read (timezone, country, name)', () => {
    for (const c of ALL_CONFIGS) {
      expect(c.timezone, c.townId).toBeTruthy();
      expect(c.country, c.townId).toBeTruthy();
    }
  });
});
