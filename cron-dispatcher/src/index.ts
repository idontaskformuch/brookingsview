import { neon } from '@neondatabase/serverless';
import { refreshAlerts } from './alerts/refresh';
import type { Sql } from './alerts/store';
import { ALERTS_CRON } from './alerts/towns';
import { dueWorkflows } from './schedule';
import { refreshWeather } from './weather/refresh';
import { isWeatherTick } from './weather/towns';

export interface Env {
  // Fine-grained PAT, repo idontaskformuch/brookingsview only, Actions: write.
  // Set with `npx wrangler secret put GITHUB_TOKEN` -- never committed.
  GITHUB_TOKEN: string;
  // Live warnings (every 15 min, src/alerts/): `npx wrangler secret put DATABASE_URL` and `... MET_OFFICE_WARNINGS_API_KEY`.
  DATABASE_URL: string;
  MET_OFFICE_WARNINGS_API_KEY?: string;
  // Glasgow's forecast (Site Specific, hourly on the whole hour): `... wrangler secret put MET_OFFICE_API_KEY`.
  MET_OFFICE_API_KEY?: string;
}

const REPO = 'idontaskformuch/brookingsview';
const REF = 'main';

async function dispatch(token: string, workflow: string): Promise<void> {
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'viewmedia-cron-dispatcher',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: REF }),
    },
  );
  // 204 = accepted. Anything else (401 expired token, 403, 404 wrong
  // filename, 422 workflow has no workflow_dispatch) must be loud.
  if (res.status !== 204) {
    throw new Error(`dispatch ${workflow} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  console.log(`dispatched ${workflow}`);
}

export default {
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    if (controller.cron === ALERTS_CRON) {
      // NWS (US towns) and Met Office (Glasgow) warnings -> the events table; no GitHub Actions minutes involved.
      const results = await refreshAlerts(env, { sql: neon(env.DATABASE_URL) as unknown as Sql });
      console.log(JSON.stringify(results));
      const failed = results.filter((r) => !r.ok);
      // Forecasts (NWS, Met Office) -> weather_snapshots, on the whole-hour ticks only. Independent of the warnings above: one failing
      // must not hide the other, so both run and the errors are raised together.
      if (isWeatherTick(controller.scheduledTime)) {
        const weather = await refreshWeather(env, { sql: neon(env.DATABASE_URL) as unknown as Sql });
        console.log(JSON.stringify(weather));
        failed.push(...weather.filter((r) => !r.ok));
      }
      if (failed.length) throw new Error(`${failed.length} failed: ${failed.map((f) => `${f.townId}: ${f.error}`).join('; ')}`);
      return;
    }
    const due = dueWorkflows(controller.cron, controller.scheduledTime);
    if (due.length === 0) {
      console.log(`cron "${controller.cron}" at ${new Date(controller.scheduledTime).toISOString()}: nothing due`);
      return;
    }
    // allSettled: one bad dispatch must not stop the others; rethrow after so
    // the invocation shows as failed in Cloudflare's logs.
    const results = await Promise.allSettled(due.map((w) => dispatch(env.GITHUB_TOKEN, w)));
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    failed.forEach((f) => console.error(String(f.reason)));
    if (failed.length) throw new Error(`${failed.length}/${due.length} dispatches failed`);
  },
} satisfies ExportedHandler<Env>;
