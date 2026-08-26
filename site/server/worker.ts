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
import { type Env, townFromHostname, timezoneForTown, currentIsoWeekSlug } from './_shared';

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

    // /this-week/ -- rolling redirect to the current ISO week's permanent
    // archive URL (see site/src/pages/this-week/index.astro's own
    // Astro.redirect()). Handled HERE, at the real HTTP layer, not just in
    // Astro: `output: 'static'` can't emit a real 301/302 status code from
    // a prerendered page -- Astro.redirect() there only produces a static
    // HTML fallback with a 2-second <meta http-equiv="refresh">, which is
    // exactly the bug this fixes (reported live on mobile Safari: the
    // fallback page's own plain, unstyled "Redirecting from ... to ..."
    // text was visible instead of an instant navigation). A real
    // Response.redirect() here returns before ever reaching ASSETS, so
    // that static fallback page is never actually served in production
    // (still built and deployed as a defensive no-op if this ever fails
    // to match). Town-agnostic: this Worker script is deployed twice (see
    // wrangler.jsonc's env.brookings/env.moreno_valley), so the town
    // (and therefore the correct week-boundary timezone) is resolved from
    // the request's own hostname at request time, exactly like
    // handleComment/handleShiftPollVote already do -- never assumed from
    // a build-time SITE_CITY, which this Worker's own separate wrangler
    // bundle doesn't have.
    if (url.pathname === '/this-week' || url.pathname === '/this-week/') {
      const townId = townFromHostname(request.url, env.DEV_TOWN_ID);
      const slug = currentIsoWeekSlug(timezoneForTown(townId));
      return Response.redirect(`${url.origin}/this-week/${slug}/`, 302);
    }

    return env.ASSETS.fetch(request);
  },
};
