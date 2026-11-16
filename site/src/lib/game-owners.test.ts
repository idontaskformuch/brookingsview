// Broomfield AdSense plan F7 (2026-11-11): broomfieldview.com served /games/jackrabbit.html (Brookings) with a 200 and
// /games/burro-bonanza.html (Moreno Valley). The same rule runs on every build's dist/ in scripts/verify_town_games.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { foreignGames, GAME_OWNERS, stripForeignGames } from './game-owners.mjs';

const PUBLIC_GAMES = fs.readdirSync(path.join(__dirname, '../../public/games'));

function builtWithAllGames(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'games-'));
  fs.mkdirSync(path.join(root, 'games'));
  for (const f of PUBLIC_GAMES) fs.writeFileSync(path.join(root, 'games', f), '<html></html>');
  return root;
}

describe('game owners', () => {
  it('every file in public/games/ has an owner', () => {
    expect(PUBLIC_GAMES.filter((f) => !GAME_OWNERS[f as keyof typeof GAME_OWNERS])).toEqual([]);
  });

  // Audit pass 1 (2026-11-16, QA build.game-noindex): /games/jackrabbit.html was indexable (22 words, no canonical).
  it('every game file is an iframe embed with noindex, never its own indexable page', () => {
    const indexable = PUBLIC_GAMES.filter((f) =>
      !/<meta name="robots" content="noindex">/.test(fs.readFileSync(path.join(__dirname, '../../public/games', f), 'utf8')));
    expect(indexable).toEqual([]);
  });

  it('a build that keeps every game (the live Broomfield site of 2026-11-11) fails the check', () => {
    expect(foreignGames(PUBLIC_GAMES, 'broomfield_co').sort()).toEqual(['burro-bonanza.html', 'jackrabbit.html']);
  });

  it('after the cleanup each town keeps only its own game, and Broomfield and Glasgow have no games folder', () => {
    const kept = (town: string) => {
      const root = builtWithAllGames();
      stripForeignGames(root, town);
      const dir = path.join(root, 'games');
      return fs.existsSync(dir) ? fs.readdirSync(dir) : null;
    };
    expect(kept('brookings_sd')).toEqual(['jackrabbit.html']);
    expect(kept('moreno_valley_ca')).toEqual(['burro-bonanza.html']);
    expect(kept('broomfield_co')).toBeNull();
    expect(kept('glasgow')).toBeNull();
  });
});
