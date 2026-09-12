import { defineConfig, loadEnv } from 'vite';

// Plain `vite-node` (used by scripts/dump-event-ranking.ts and
// scripts/generate-cluster-graph.ts) doesn't know it's running inside an
// Astro project, so it applies Vite's own default envPrefix restriction
// (only VITE_-prefixed vars reach import.meta.env) -- unlike a real
// `astro build`/`astro dev`, which exposes every env var server-side.
// lib/db.ts reads `import.meta.env.DATABASE_URL` unprefixed.
//
// site-config.ts reads `import.meta.env.SITE_CITY` the same unprefixed
// way -- same restriction, same fix needed, or every invocation silently
// falls back to its own default ('brookings_sd') regardless of what
// SITE_CITY was actually set to in the shell (confirmed live: this was
// the very first bug hit running this script, once DATABASE_URL alone was
// fixed).
//
// `envPrefix: ''` (widen the prefix restriction itself) is a HARD Vite
// error ("could lead to unexpected exposure of sensitive information") --
// so this uses `define` instead: read `.env` via `loadEnv()` (same
// `loadEnv(mode, root, '')` call astro.config.mjs already uses for its own
// identical DATABASE_URL problem) for the file-based value, and
// `process.env` directly for SITE_CITY (a real shell-exported var per
// invocation, not a `.env` value) -- then inline both literal references
// at transform time. Narrower than opening envPrefix wide: only these two
// exact `import.meta.env.*` expressions are replaced, nothing else is
// exposed.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    define: {
      'import.meta.env.DATABASE_URL': JSON.stringify(env.DATABASE_URL ?? ''),
      'import.meta.env.SITE_CITY': JSON.stringify(process.env.SITE_CITY ?? ''),
    },
  };
});
