/**
 * Post-build spelling gate for a built town (Glasgow Phase 1):
 *   SITE_CITY=glasgow npx astro build && npx vite-node --config vite-node.config.ts scripts/check-built-spelling.ts dist gb
 * Strips tags/scripts/styles from every dist/**.html and fails (exit 1) when the
 * visible text contains the OTHER country's spellings. Intended for gb towns;
 * US builds are not gated here (their AI-written text is covered at publish time).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { countryProfile, type CountryId } from '../src/lib/country-profile';
import { findSpellingViolations } from '../src/lib/spelling-gate';

const [dist = 'dist', country = 'gb'] = process.argv.slice(2);
const spelling = countryProfile(country as CountryId).spelling;

function htmlFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) htmlFiles(p, out);
    else if (name.endsWith('.html')) out.push(p);
  }
  return out;
}

let failures = 0;
for (const file of htmlFiles(dist)) {
  const text = readFileSync(file, 'utf-8')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  const hits = [...new Set(findSpellingViolations(text, spelling))];
  if (hits.length > 0) {
    failures += 1;
    console.error(`${file}: ${hits.join(', ')}`);
  }
}
if (failures > 0) {
  console.error(`${failures} page(s) contain non-${spelling} spelling`);
  process.exit(1);
}
console.log(`spelling gate (${spelling}): clean`);
