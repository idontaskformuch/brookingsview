import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Owner 2026-11-11: the meta of an ai:* story reaches a page only after scripts/validate_ai_meta.py marked it _checked.
// Every query in db.ts that reads stories.meta must go through the gate; a bare `meta` column would show unchecked model output.
describe('AI_META_GATE', () => {
  const src = readFileSync(new URL('./db.ts', import.meta.url), 'utf8');
  const GATE = "CASE WHEN generated_by LIKE 'ai:%' AND (meta->>'_checked') IS DISTINCT FROM 'true' THEN NULL ELSE meta - '_checked' END AS meta";
  it('every select of stories.meta is the gate expression', () => {
    const selects = src.match(/SELECT[\s\S]*?FROM stories/g) ?? [];
    const withMeta = selects.filter((q) => /\bmeta\b/.test(q.replace(/import\.meta/g, '')));
    expect(withMeta.length).toBeGreaterThanOrEqual(3);
    for (const q of withMeta) expect(q, q.slice(0, 120)).toContain(GATE);
  });
});
