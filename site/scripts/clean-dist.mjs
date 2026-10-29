#!/usr/bin/env node
/** Empties site/dist (its CONTENTS, not the folder) so every build starts from nothing, and fails loudly if anything is left.
 *  Why contents only: on Windows the folder itself can be held open by another process (an editor's file watcher, the search
 *  indexer, antivirus), so `rm -rf dist` fails with "Device or resource busy" while deleting what is inside works.
 *  Run by `npm run build` (prebuild). CI builds from a fresh checkout and calls `astro build` directly. */
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const dist = fileURLToPath(new URL('../dist', import.meta.url));
if (existsSync(dist)) {
  for (const name of readdirSync(dist)) rmSync(join(dist, name), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  const left = readdirSync(dist);
  if (left.length) {
    console.error(`clean-dist: ${left.length} entr${left.length === 1 ? 'y' : 'ies'} could not be removed from ${dist}: ${left.slice(0, 5).join(', ')}`);
    process.exit(1);
  }
}
