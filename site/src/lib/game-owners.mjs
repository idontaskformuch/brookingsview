/** Which town owns each file in public/games/ (Broomfield AdSense plan F7, 2026-11-11: public/ is copied into every build, so
 *  broomfieldview.com served Brookings' /games/jackrabbit.html with a 200 and Moreno Valley's burro-bonanza.html too).
 *  astro.config.mjs strips every game a town does not own after the build; scripts/verify_town_games.mjs checks dist/. */
import fs from 'node:fs';
import path from 'node:path';

export const GAME_OWNERS = {
  'jackrabbit.html': 'brookings_sd', // /play
  'burro-bonanza.html': 'moreno_valley_ca', // /burro-bonanza
};

/** Files in a games folder listing that `townId` must not serve: another town's game, or a file nobody owns. */
export function foreignGames(files, townId) {
  return files.filter((f) => GAME_OWNERS[f] !== townId);
}

/** Removes the games `townId` does not own from a built `root`, and the folder itself when nothing is left. */
export function stripForeignGames(root, townId) {
  const dir = path.join(root, 'games');
  if (!fs.existsSync(dir)) return;
  for (const f of foreignGames(fs.readdirSync(dir), townId)) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
  if (fs.readdirSync(dir).length === 0) fs.rmSync(dir, { recursive: true, force: true });
}
