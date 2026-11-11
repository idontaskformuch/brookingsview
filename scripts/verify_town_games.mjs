#!/usr/bin/env node
/**
 * Broomfield AdSense plan F7 (2026-11-11): a town's build may only hold its own games (site/src/lib/game-owners.mjs).
 * Exits 1 when dist/games/ holds a file the town does not own.
 *
 * Usage: node scripts/verify_town_games.mjs <dist-dir> <town_id>   (town_id defaults to $SITE_CITY)
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { foreignGames } from '../site/src/lib/game-owners.mjs';

const dist = process.argv[2];
const town = process.argv[3] ?? process.env.SITE_CITY;
if (!dist || !town) { console.error('Usage: node scripts/verify_town_games.mjs <dist-dir> <town_id>'); process.exit(2); }

const dir = join(dist, 'games');
const bad = existsSync(dir) ? foreignGames(readdirSync(dir), town) : [];
if (bad.length) {
  console.error(`verify_town_games: ${town} serves games it does not own: ${bad.map((f) => `/games/${f}`).join(', ')}`);
  process.exit(1);
}
console.log(`verify_town_games: ok (${town})`);
