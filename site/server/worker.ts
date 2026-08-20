// Single Worker entry point for the whole site (both towns -- routing by
// hostname happens inside each handler via townFromHostname).
//
// WHY THIS FILE EXISTS: site/wrangler.jsonc has no "main" key and deploys
// as an asset-only Worker (via the Cloudflare dashboard's "npx wrangler
// deploy" build command). An asset-only Worker never reads a `functions/`
// directory -- that file-based routing convention only applies to
// Cloudflare *Pages* projects (via `wrangler pages dev` / `wrangler pages
// deploy` or the Pages dashboard). This project stopped being a Pages
// project a while back (see CLOUDFLARE_MIGRATION notes / commit history),
// so site/functions/api/comment.ts and shift-poll-vote.ts were dead code in
// production: every request to /api/comment or /api/shift-poll-vote hit
// this Worker's static-asset fallback and got the site's own 404 page back
// (which the client then fails to JSON.parse and reports as "Something
// went wrong"). `wrangler pages dev` locally emulates the Pages Functions
// routing regardless of the production deploy method, which is why local/
// staging testing never caught this.
//
// The fix: give the Worker a real "main" entry (this file) that explicitly
// routes the two POST API paths to their handlers and otherwise defers to
// the static assets binding. This is Cloudflare's "Advanced Mode" for a
// Worker with static assets. See site/wrangler.jsonc for the matching
// "main" + "assets.binding" config.
import { handleComment } from './comment';
import { handleShiftPollVote } from './shift-poll-vote';
import type { Env } from './_shared';

interface WorkerEnv extends Env {
  // Bound via wrangler.jsonc `assets.binding` -- serves the static Astro
  // build output (site/dist) for every request this Worker doesn't
  // explicitly handle itself.
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/api/comment') {
      return handleComment(request, env);
    }
    if (request.method === 'POST' && url.pathname === '/api/shift-poll-vote') {
      return handleShiftPollVote(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
