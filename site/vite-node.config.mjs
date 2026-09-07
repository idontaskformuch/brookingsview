// Config for `vite-node` only (scripts/dump-event-ranking.ts), not used by
// Astro's own dev/build pipeline (that's astro.config.mjs). Vite's default
// envPrefix ('VITE_') only exposes prefixed vars to import.meta.env, which
// is right for client-bundled code but wrong here: this script runs
// server-side only and needs DATABASE_URL (unprefixed, same as lib/db.ts
// reads inside a real Astro build) available on import.meta.env. Widening
// envPrefix to '' is refused by Vite itself ("could lead to unexpected
// exposure of sensitive information") -- so instead this loads .env the
// same way astro.config.mjs already does (loadEnv with an empty prefix
// filter, Vite's own documented way to read every var, not just VITE_-
// prefixed ones) and injects each one directly via `define`, which has no
// such prefix restriction. Fine for a server-only dev tool that never
// ships to a browser.
import { defineConfig, loadEnv } from 'vite';

// loadEnv('', ...) also pulls in the full OS environment (Windows names
// like "ProgramFiles(x86)" included), which isn't a valid `define` key --
// confirmed live (an oxc "INVALID_DEFINE_CONFIG" transform error) -- so
// only forward keys that are valid JS identifiers.
const VALID_DEFINE_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const define = {};
  for (const [key, value] of Object.entries(env)) {
    if (!VALID_DEFINE_KEY.test(key)) continue;
    define[`import.meta.env.${key}`] = JSON.stringify(value);
  }
  return { define };
});
