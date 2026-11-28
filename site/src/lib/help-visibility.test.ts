import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { countVisible, helpPageHasEnough, helpVisible, HELP_MAX_AGE_DAYS, HELP_MIN_ENTRIES, HELP_ENABLED_CATEGORIES } from './help-visibility';

// The SAME cases tests/test_help_places.py runs through db/help_places.count_visible (owner 2026-11-27: one count for page + alarm).
const FIXTURES = new URL('../../../tests/fixtures/', import.meta.url);
const files = readdirSync(FIXTURES).filter((f) => /^help_visibility_.*\.json$/.test(f));
const PY = readFileSync(new URL('../../../db/help_places.py', import.meta.url), 'utf8');

describe('help-visibility mirrors db/help_places.py', () => {
  it('has a shared case file', () => expect(files.length).toBeGreaterThan(0));
  for (const f of files) {
    const data = JSON.parse(readFileSync(new URL(f, FIXTURES), 'utf8'));
    for (const c of data.cases) {
      it(`${f}: ${c.name}`, () => {
        const rows = c.rows.map((n: string) => ({ ...data.rows[n], ...(c.changed[n] ?? {}) }));
        expect(rows.filter((r: object) => helpVisible(r, data.today, data.max_age_days)).map((r: { key: string }) => r.key)).toEqual(c.visible);
        expect(countVisible(rows, data.today, data.max_age_days)).toBe(c.visible.length);
      });
    }
  }
  it('has the same constants as the Python rule', () => {
    expect(PY).toMatch(new RegExp(`MAX_AGE_DAYS = ${HELP_MAX_AGE_DAYS}\\b`));
    expect(PY).toMatch(new RegExp(`MIN_ENTRIES = ${HELP_MIN_ENTRIES}\\b`));
    const enabled = /ENABLED_CATEGORIES = frozenset\(\{([^}]*)\}\)/.exec(PY)?.[1].match(/"(\w+)"/g)?.map((s) => s.slice(1, -1)).sort();
    expect(enabled).toEqual([...HELP_ENABLED_CATEGORIES].sort());
  });
  it('omits the page under min_entries', () => {
    expect(helpPageHasEnough(5)).toBe(false);
    expect(helpPageHasEnough(6)).toBe(true);
  });
});
