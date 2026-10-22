/** Election results Worker: cron fetch + write ONLY, no routes. Every 10 minutes each town decides by
 *  its own cadence (phase.ts) whether to fetch. The public JSON is served by the sites' own worker
 *  (site/server/election-results.ts, GET /api/election-results), which reads the same tables, so a
 *  new snapshot reaches the page without a site rebuild (owner decision 2026-10-22). */
import { runTown } from './pipeline';
import { readSource } from './sources';
import { neonStore } from './store';
import { TOWNS } from './towns';

export interface Env {
  DATABASE_URL: string;
}

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
} satisfies ExportedHandler<Env>;
