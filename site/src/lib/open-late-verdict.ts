/** Whether /open-late/ is indexable in this build, for the sitemap filter in astro.config.mjs (same hand-off file pattern as lib/evening-verdict.ts). */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const OPEN_LATE_VERDICT_FILE = '.open-late-verdict.json';

export function writeOpenLateVerdict(townId: string, indexable: boolean): void {
  try { writeFileSync(resolve(process.cwd(), OPEN_LATE_VERDICT_FILE), JSON.stringify({ townId, indexable })); } catch { /* read-only dist: the filter then treats the page as noindex */ }
}
