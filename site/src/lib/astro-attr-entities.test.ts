// QA build.astro-attr-entities (astro 7.4.12-uppgraderingen 2026-11-18, .claude/specs/astro-7.md session 3).
// Astros gamla kompilator avkodade HTML-entiteter i statiska attributvärden innan de blev props; Rust-kompilatorn
// (astro 7) skickar dem som bokstavlig text, och komponenten escapar dem en gång till. Brookings /university/ visade
// "Arts &amp; culture at SDSU" för läsaren. Regel: skriv tecknet självt i ett attribut ("&", inte "&amp;") --
// Astro escapar attributvärden vid utskrift.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.join(__dirname, '..');
const ENTITY_IN_ATTR = /[\w:@.-]+=("[^"]*&(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);[^"]*"|'[^']*&(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);[^']*')/;

/** Rader i en .astro-källa där ett statiskt attributvärde innehåller en HTML-entitet. Frontmatter (---) och kommentarer räknas inte. */
function entityAttrLines(source: string): string[] {
  const lines = source.split(/\r?\n/);
  let start = 0;
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
    start = end < 0 ? 0 : end + 1;
  }
  const out: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*(\/\/|<!--)/.test(l)) continue;
    if (ENTITY_IN_ATTR.test(l)) out.push(`${i + 1}: ${l.trim()}`);
  }
  return out;
}

function astroFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? astroFiles(p) : e.name.endsWith('.astro') ? [p] : [];
  });
}

describe('HTML-entiteter i .astro-attribut (astro 7)', () => {
  // Riktig rad: site/src/pages/university.astro:189 på f72bacd (före fixen).
  const REAL = [
    '---',
    "import SectionRule from '../components/SectionRule.astro';",
    '---',
    '      <SectionRule label="Arts &amp; culture at SDSU" href="/events/campus/" />',
  ].join('\n');

  it('hittar den riktiga raden från /university/', () => {
    expect(entityAttrLines(REAL)).toEqual(['4: <SectionRule label="Arts &amp; culture at SDSU" href="/events/campus/" />']);
  });

  it('godtar samma rad med tecknet självt', () => {
    expect(entityAttrLines(REAL.replace('&amp;', '&'))).toEqual([]);
  });

  it('ingen .astro-fil i site/src har en entitet i ett attributvärde', () => {
    const hits = astroFiles(SRC).flatMap((f) => entityAttrLines(fs.readFileSync(f, 'utf8')).map((h) => `${path.relative(SRC, f)}:${h}`));
    expect(hits).toEqual([]);
  });
});
