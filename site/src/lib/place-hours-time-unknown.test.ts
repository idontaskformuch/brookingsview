import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Owner 2026-11-27 (migration 079): a place_hours row without times means CLOSED, except when time_unknown is set ("the source
// gives the day but no time", /help/ rows such as cross-of-christ-community-meals). The site's hours logic (hours-spec.ts,
// place-hours.ts) only knows open-with-times and closed, so every site query that reads place_hours leaves time_unknown rows out;
// otherwise such a day would show as "Closed". tests/test_place_hours_time_unknown.py does the same for the Python readers.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8');

/** Every `place_hours ph` (not place_hours_exceptions) in a source file, with the SQL that follows it up to the closing backtick. */
function readers(src: string): string[] {
  const out: string[] = [];
  const re = /\bplace_hours ph\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(src.slice(m.index, src.indexOf('`', m.index)));
  return out;
}

describe('place_hours.time_unknown: every site reader leaves the rows out', () => {
  // db.ts getHelpEntries (/help/, 2026-11-28) is the one reader that keeps the rows: it selects ph.time_unknown and lib/help-view.ts
  // shows such a day as the weekday alone, never "Closed". It reads only help categories, which no other reader touches.
  for (const [file, expected, help] of [['./db.ts', 4, 1], ['../../astro.config.mjs', 1, 0]] as const) {
    it(`${file}: ${expected} reader(s), all but ${help} /help/ reader with NOT ph.time_unknown`, () => {
      const src = read(file);
      const found = readers(src);
      expect(found.length, 'a new place_hours reader: decide how it treats time_unknown and count it here').toBe(expected);
      expect(found.filter((sql) => !/NOT ph\.time_unknown/.test(sql)).length).toBe(help);
      if (help) expect(src).toMatch(/ph\.time_unknown\s+FROM place_hours ph JOIN places p ON p\.id = ph\.place_id\s+WHERE p\.town_id = \$\{TOWN_ID\} AND p\.category = ANY\(\$\{cats\}/);
    });
  }
});
