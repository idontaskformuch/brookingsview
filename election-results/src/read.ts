/** Dependency-free read of the latest VALID snapshot (tables from db/migrations/061_election_results.sql).
 *  The caller supplies `q`, so this file imports no database client: the sites' worker bundle
 *  (site/server/election-results.ts) imports it without needing election-results/node_modules. */
import type { Snapshot } from './types';

export type Query = (text: string, params: unknown[]) => Promise<Array<Record<string, unknown>>>;

export async function readLastValid(q: Query, townId: string, electionDate: string): Promise<Snapshot | null> {
  const snaps = await q(
    `SELECT s.id, s.source_url, s.source_updated_at, s.fetched_at, s.precincts_reported, s.precincts_total,
            t.ballots_counted, t.registered, t.precincts_reporting, t.precincts_total AS t_precincts_total
       FROM election_snapshots s LEFT JOIN election_turnout t ON t.snapshot_id = s.id
      WHERE s.town_id = $1 AND s.election_date = $2 AND s.valid
      ORDER BY s.fetched_at DESC, s.id DESC LIMIT 1`,
    [townId, electionDate],
  );
  const s = snaps[0];
  if (!s) return null;
  const rows = await q(
    `SELECT c.source_contest_id, c.name, c.party, c.ballot_order, r.choice_name, r.choice_order, r.votes
       FROM election_results r JOIN election_contests c ON c.id = r.contest_id
      WHERE r.snapshot_id = $1 ORDER BY c.ballot_order, r.choice_order`,
    [s.id],
  );
  const byContest = new Map<string, Snapshot['contests'][number]>();
  for (const r of rows) {
    const id = String(r.source_contest_id);
    if (!byContest.has(id)) byContest.set(id, { sourceContestId: id, name: String(r.name), party: (r.party as string | null) ?? null, choices: [] });
    byContest.get(id)!.choices.push({ name: String(r.choice_name), votes: Number(r.votes) });
  }
  return {
    townId, electionDate,
    sourceUrl: String(s.source_url),
    sourceUpdatedAt: (s.source_updated_at as string | null) ?? null,
    fetchedAt: new Date(s.fetched_at as string).toISOString(),
    precinctsReported: s.precincts_reported == null ? null : Number(s.precincts_reported),
    precinctsTotal: s.precincts_total == null ? null : Number(s.precincts_total),
    contests: [...byContest.values()],
    turnout: s.ballots_counted == null && s.registered == null && s.precincts_reporting == null ? undefined : {
      ballotsCounted: s.ballots_counted == null ? null : Number(s.ballots_counted),
      registered: s.registered == null ? null : Number(s.registered),
      precinctsReporting: s.precincts_reporting == null ? null : Number(s.precincts_reporting),
      precinctsTotal: s.t_precincts_total == null ? null : Number(s.t_precincts_total),
    },
  };
}
