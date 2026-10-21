/** Election results Worker.
 *  scheduled(): every 10 minutes; each town decides by its own cadence (phase.ts) whether to fetch.
 *  fetch(): GET /api/election-results?town=<id> -> latest VALID snapshot as JSON, read straight from
 *  Neon, so a new snapshot reaches the page without any site rebuild/deploy (owner decision 2026-10-21). */
import { toPublic } from './api';
import { runTown } from './pipeline';
import { readSource } from './sources';
import { neonStore } from './store';
import { TOWNS } from './towns';

export interface Env {
  DATABASE_URL: string;
}

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=30' };

export default {
  async scheduled(_c: ScheduledController, env: Env): Promise<void> {
    const store = neonStore(env.DATABASE_URL);
    for (const town of Object.values(TOWNS)) {
      const out = await runTown(town, { now: () => new Date(), read: (t, n) => readSource(t, n), store });
      if (out.action === 'error') console.error(`election ${town.townId}: ${out.message}`);
      else if (out.action === 'saved' && !out.valid) console.error(`election ${town.townId}: snapshot BLOCKED: ${out.problems.join('; ')}`);
      else console.log(`election ${town.townId}: ${out.action}`);
    }
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname !== '/api/election-results' || req.method !== 'GET') return new Response('not found', { status: 404 });
    const town = TOWNS[url.searchParams.get('town') ?? ''];
    if (!town) return new Response(JSON.stringify({ error: 'unknown town' }), { status: 400, headers: JSON_HEADERS });
    const now = new Date();
    const snapshot = town.source.kind === 'link_only' ? null : await neonStore(env.DATABASE_URL).lastValid(town.townId, town.cadence.electionDate);
    return new Response(JSON.stringify(toPublic(town, snapshot, now)), { headers: JSON_HEADERS });
  },
} satisfies ExportedHandler<Env>;
