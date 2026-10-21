import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The calendar emojis render as a fixed "JUL 17" on Apple devices whatever the
// event date is, so they must not appear anywhere in src/. Built from code
// points so this file does not contain the characters it forbids.
const FORBIDDEN = [String.fromCodePoint(0x1f4c5), String.fromCodePoint(0x1f5d3)];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(astro|ts|tsx|js|mjs|css|md|json)$/.test(name)) out.push(p);
  }
  return out;
}

describe('no calendar emoji in src/', () => {
  it('finds neither U+1F4C5 nor U+1F5D3 in any source file', () => {
    const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const offenders = walk(root).filter((f) => {
      const text = readFileSync(f, 'utf-8');
      return FORBIDDEN.some((c) => text.includes(c));
    });
    expect(offenders).toEqual([]);
  });
});
