import { dueWorkflows } from './schedule';

export interface Env {
  // Fine-grained PAT, repo idontaskformuch/brookingsview only, Actions: write.
  // Set with `npx wrangler secret put GITHUB_TOKEN` -- never committed.
  GITHUB_TOKEN: string;
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
