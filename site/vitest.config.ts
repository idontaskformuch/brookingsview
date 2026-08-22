// Side-effect import: applies vitest's ambient `test` field augmentation to
// Vite's UserConfig type (astro/config's getViteConfig() re-exports Vite's
// own UserConfig type, which doesn't know about `test` on its own -- `astro
// check`'s isolated per-file checking didn't pick up a `/// <reference>`
// comment for this, importing the module directly does).
import 'vitest/config';
import { getViteConfig } from 'astro/config';

// getViteConfig() loads the same Astro/Vite pipeline (aliases, plugins)
// tests run against.
//
// DATABASE_URL is set explicitly here rather than relying on site/.env:
// lib/db.ts calls neon(import.meta.env.DATABASE_URL) at module load time,
// so importing anything from that module -- even a pure function that
// never touches the DB, like buildEventJsonLd() -- throws immediately
// without SOME value present. A fake placeholder is correct here, not a
// shortcut: these are pure-function tests (see event-jsonld.test.ts) that
// never execute a query, and CI shouldn't need a real DATABASE_URL secret
// just to run them -- same "no DB access needed" principle as the Python
// test suite (see .github/workflows/tests.yml).
export default getViteConfig({
  test: {
    environment: 'node',
    env: {
      DATABASE_URL: 'postgresql://test:test@localhost/test',
    },
  },
});
