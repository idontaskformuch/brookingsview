#!/usr/bin/env node
/**
 * Leak check for the heat/dust advisory (Worker Pulse's HeatAdvisoryWidget).
 * It is a Moreno Valley-only feature (siteConfig.hasHeatAdvisory). Reads the
 * real `dist/` of a real `astro build`:
 *   node scripts/verify_heat_advisory_leak.mjs <dist-dir> absent    (Brookings, Broomfield)
 *   node scripts/verify_heat_advisory_leak.mjs <dist-dir> allowed   (Moreno Valley: no check)
 * In `absent` mode, exits 1 listing every built html/js/css file containing the
 * widget's copy ("loading-dock") or its rendered markup (class="heat-advisory...").
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const [distDir, mode] = process.argv.slice(2);
if (!distDir || !['absent', 'allowed'].includes(mode ?? '')) {
  console.error('Usage: node scripts/verify_heat_advisory_leak.mjs <dist-dir> <absent|allowed>');
  process.exit(2);
}
if (mode === 'allowed') process.exit(0);

// Copy + rendered markup. Scoped CSS rules (`.heat-advisory__dot{...}`) are
// deliberately NOT needles: Astro bundles an imported component's styles into
// the page even when the component renders nothing, and the rules are inert.
const NEEDLES = ['loading-dock', 'class="heat-advisory', "class='heat-advisory"];
const hits = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!/\.(html|js|css|json|xml|txt)$/.test(name)) continue;
    const text = readFileSync(p, 'utf-8');
    for (const n of NEEDLES) if (text.includes(n)) hits.push(`${p}  (${n})`);
  }
})(distDir);

if (hits.length) {
  console.error(`Heat/dust advisory leaked into a town that must not have it (${hits.length}):`);
  for (const h of hits.slice(0, 30)) console.error('  ' + h);
  process.exit(1);
}
