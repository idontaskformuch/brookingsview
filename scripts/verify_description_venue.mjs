#!/usr/bin/env node
/**
 * QA build.description-venue (2026-11-12): a /s/ page's meta description must not add a place its headline already names.
 * factsDescription() writes "<title> at <venue>, <day>." and left the venue out only when the whole venue string was in the
 * title, so Moreno /s/event-163864/ "MAIN LIBRARY: Pijama y Cuentos ~ Pajamas & Stories" got "at Main Library,25480 Alessandro
 * Blvd, Moreno Valley, CA 92553, USA" (venue_raw is name + street address). The place's name is the part before the first comma.
 *
 * Usage: node scripts/verify_description_venue.mjs <dist-dir>
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = process.argv[2];
if (!dist) { console.error('Usage: node scripts/verify_description_venue.mjs <dist-dir>'); process.exit(2); }

const decode = (s) => s.replace(/&#34;|&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#38;/g, '&').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** The problem with one built page, or null. */
export function pageProblem(html) {
  const desc = html.match(/<meta name="description" content="([^"]*)"/)?.[1];
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1];
  if (!desc || !h1) return null;
  const title = decode(h1.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim().replace(/[.?!]+$/, '');
  const text = decode(desc);
  if (!title || !text.startsWith(title)) return null;
  // "<title> at <place>, ..." or "<title>? At <place>, ...".
  const place = text.slice(title.length).match(/^[?!.]?\s*[Aa]t ([^,.…]+)/)?.[1].trim();
  if (!place || !title.toLowerCase().includes(place.toLowerCase())) return null;
  return `the description adds "${place}", which the headline already names`;
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/').replace(/^(?=[A-Za-z]:)/, '/')}`) {
  const problems = [];
  let checked = 0;
  const root = join(dist, 's');
  if (existsSync(root)) {
    for (const page of readdirSync(root, { withFileTypes: true })) {
      if (!page.isDirectory()) continue;
      const file = join(root, page.name, 'index.html');
      if (!existsSync(file)) continue;
      checked += 1;
      const p = pageProblem(readFileSync(file, 'utf8'));
      if (p) problems.push(`/s/${page.name}/: ${p}`);
    }
  }
  if (problems.length) {
    console.error(`verify_description_venue: ${problems.length} of ${checked} page(s) whose description repeats the headline's place:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`verify_description_venue: ${checked} /s/ pages, no description repeats the headline's place`);
}
