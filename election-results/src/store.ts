/** Neon-backed Store (tables from db/migrations/061_election_results.sql).
 *  A valid save is ONE statement (data-modifying CTE) so a snapshot never lands half-written. */
import { neon } from '@neondatabase/serverless';
import type { SaveRecord, Store } from './pipeline';
import { readLastValid } from './read';
import type { Snapshot } from './types';
import { pctOf } from './validate';

type Row = Record<string, unknown>;

export function neonStore(databaseUrl: string): Store & { latestValidPublic(townId: string, electionDate: string): Promise<Snapshot | null> } {
  const sql = neon(databaseUrl);
  const q = (text: string, params: unknown[]) => sql.query(text, params) as Promise<Row[]>;

  const lastValid = (townId: string, electionDate: string) => readLastValid(q, townId, electionDate);

  async function hasHash(townId: string, electionDate: string, hash: string): Promise<boolean> {
    const r = await q(
      `SELECT 1 FROM election_snapshots WHERE town_id = $1 AND election_date = $2 AND raw_hash = $3 LIMIT 1`,
      [townId, electionDate, hash],
    );
    return r.length > 0;
  }

  async function save(rec: SaveRecord): Promise<void> {
    const { snapshot: s, kind, raw } = rec.reading;
    const hex = '\\x' + [...raw].map((b) => b.toString(16).padStart(2, '0')).join('');
    if (!rec.valid) {
      await q(
        `INSERT INTO election_snapshots (town_id, election_date, source_kind, source_url, source_updated_at, raw_hash, raw_payload, valid, problems, precincts_reported, precincts_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7::bytea,FALSE,$8,$9,$10)`,
        [s.townId, s.electionDate, kind, s.sourceUrl, s.sourceUpdatedAt, rec.hash, hex, rec.problems, s.precinctsReported, s.precinctsTotal],
      );
      return;
    }
    const contests = s.contests.map((c, i) => ({ sid: c.sourceContestId, name: c.name, party: c.party, ord: i }));
    const results = s.contests.flatMap((c) => {
      const total = c.choices.reduce((a, ch) => a + ch.votes, 0);
      return c.choices.map((ch, j) => ({ sid: c.sourceContestId, name: ch.name, ord: j, votes: ch.votes, pct: pctOf(ch.votes, total) }));
    });
    const t = s.turnout;
    await q(
      `WITH snap AS (
         INSERT INTO election_snapshots (town_id, election_date, source_kind, source_url, source_updated_at, raw_hash, raw_payload, valid, problems, precincts_reported, precincts_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7::bytea,TRUE,'{}',$8,$9) RETURNING id
       ), c AS (
         INSERT INTO election_contests (town_id, election_date, source_contest_id, name, party, ballot_order)
         SELECT $1, $2::date, x.sid, x.name, x.party, x.ord
           FROM jsonb_to_recordset($10::jsonb) AS x(sid text, name text, party text, ord int)
         ON CONFLICT (town_id, election_date, source_contest_id)
           DO UPDATE SET name = EXCLUDED.name, party = EXCLUDED.party, ballot_order = EXCLUDED.ballot_order
         RETURNING id, source_contest_id
       ), r AS (
         INSERT INTO election_results (snapshot_id, contest_id, choice_name, choice_order, votes, pct)
         SELECT (SELECT id FROM snap), c.id, x.name, x.ord, x.votes, x.pct
           FROM jsonb_to_recordset($11::jsonb) AS x(sid text, name text, ord int, votes int, pct numeric)
           JOIN c ON c.source_contest_id = x.sid
         RETURNING 1
       )
       INSERT INTO election_turnout (snapshot_id, ballots_counted, registered, precincts_reporting, precincts_total)
       SELECT (SELECT id FROM snap), $12::int, $13::int, $14::int, $15::int`,
      [
        s.townId, s.electionDate, kind, s.sourceUrl, s.sourceUpdatedAt, rec.hash, hex, s.precinctsReported, s.precinctsTotal,
        JSON.stringify(contests), JSON.stringify(results),
        t?.ballotsCounted ?? null, t?.registered ?? null, t?.precinctsReporting ?? s.precinctsReported, t?.precinctsTotal ?? s.precinctsTotal,
      ],
    );
  }

  return { lastValid, hasHash, save, latestValidPublic: lastValid };
}
