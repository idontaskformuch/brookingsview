// POST /api/shift-poll-vote -- no-login shift poll for Worker Pulse
// (Moreno Valley only). Fixed question, four fixed options, no free text --
// that IS the entire anti-spam design (see db/migrations/017_shift_poll.sql).
// UNIQUE(town_id, poll_date, ip_hash) does the one-vote-per-day dedup at the
// DB level; a repeat vote from the same hashed IP is a silent no-op.
//
// Runs inside the site's single Worker entry (server/worker.ts) -- see the
// comment at the top of worker.ts for why this moved out of site/functions/
// (that was a Cloudflare Pages Functions convention that this project's
// actual deploy method never invokes).
import { neon } from '@neondatabase/serverless';
import { type Env, townFromHostname, sha256Hex, todayInTimezone, jsonResponse } from './_shared';

const ALLOWED_OPTIONS = ['Calm', 'Okay', 'Tough', 'Really tough'] as const;
const TOWN_TZ: Record<string, string> = { moreno_valley_ca: 'America/Los_Angeles' };

export async function handleShiftPollVote(request: Request, env: Env): Promise<Response> {
  const townId = townFromHostname(request.url, env.DEV_TOWN_ID);
  if (townId !== 'moreno_valley_ca') {
    return new Response('Not found', { status: 404 });
  }

  let option: unknown;
  try {
    const parsed = (await request.json()) as { option?: unknown };
    option = parsed.option;
  } catch {
    return new Response('Bad request', { status: 400 });
  }
  if (typeof option !== 'string' || !ALLOWED_OPTIONS.includes(option as any)) {
    return new Response('Bad request', { status: 400 });
  }

  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const ipHash = await sha256Hex(`${ip}:${env.IP_HASH_SALT}`);
  const pollDate = todayInTimezone(TOWN_TZ[townId]);

  const sql = neon(env.DATABASE_URL);

  await sql`
    INSERT INTO shift_poll_votes (town_id, poll_date, option, ip_hash)
    VALUES (${townId}, ${pollDate}, ${option}, ${ipHash})
    ON CONFLICT (town_id, poll_date, ip_hash) DO NOTHING
  `;

  const rows = (await sql`
    SELECT option, count(*)::int AS count
      FROM shift_poll_votes
     WHERE town_id = ${townId} AND poll_date = ${pollDate}
     GROUP BY option
  `) as { option: string; count: number }[];

  const results = ALLOWED_OPTIONS.map((opt) => ({
    option: opt,
    count: rows.find((r) => r.option === opt)?.count ?? 0,
  }));

  return jsonResponse({ results });
}
