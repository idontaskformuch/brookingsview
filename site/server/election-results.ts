/** GET /api/election-results -- the latest VALID election snapshot for the town the request's hostname
 *  belongs to, as JSON (election 2026, phase 2; spec .claude/specs/election-2026.md).
 *  Read-only: the separate viewmedia-election-results Worker fetches and writes; this only reads, so a
 *  new snapshot reaches /election-results without a site rebuild. The town comes from the HOSTNAME,
 *  never from a query parameter, so one site can never be asked for another town's numbers. */
import { toPublic } from '../../election-results/src/api';
import { neon } from '@neondatabase/serverless';
import { readLastValid } from '../../election-results/src/read';
import { TOWNS } from '../../election-results/src/towns';
import type { Snapshot } from '../../election-results/src/types';
import { townFromHostname, type Env } from './_shared';

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=30' };

export interface ElectionResultsDeps {
  now?: () => Date;
  loadLatestValid?: (databaseUrl: string, townId: string, electionDate: string) => Promise<Snapshot | null>;
}

export async function handleElectionResults(request: Request, env: Env, deps: ElectionResultsDeps = {}): Promise<Response> {
  const townId = townFromHostname(request.url, env.DEV_TOWN_ID);
  const town = townId ? TOWNS[townId] : undefined;
  if (!town) return new Response(JSON.stringify({ error: 'unknown town' }), { status: 404, headers: HEADERS });
  const load = deps.loadLatestValid ?? ((url, t, d) => readLastValid((text, params) => neon(url)(text, params) as unknown as Promise<Array<Record<string, unknown>>>, t, d));
  // link-only towns (Moreno Valley) never have snapshots: answer "not available", no DB read.
  const snapshot = town.source.kind === 'link_only' ? null : await load(env.DATABASE_URL, town.townId, town.cadence.electionDate);
  return new Response(JSON.stringify(toPublic(town, snapshot, (deps.now ?? (() => new Date()))())), { headers: HEADERS });
}
