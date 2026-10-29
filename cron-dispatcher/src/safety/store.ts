/** Writes fire / air rows to public_safety_notices (db/migrations/065). Only call after a SUCCESSFUL fetch: a failed fetch must never end anything. */
import type { Sql } from '../alerts/store';

export interface StoredNotice { externalId: string; title: string; url: string | null; observedAt: string | null; raw: object }

export async function storeNotices(sql: Sql, townId: string, kind: 'fire' | 'air', notices: StoredNotice[]): Promise<{ written: number; ended: number }> {
  for (const n of notices) {
    await sql`
      INSERT INTO public_safety_notices (town_id, kind, external_id, title, url, raw_data, observed_at)
      VALUES (${townId}, ${kind}, ${n.externalId}, ${n.title}, ${n.url}, ${JSON.stringify(n.raw)}::jsonb, ${n.observedAt})
      ON CONFLICT (town_id, kind, external_id) DO UPDATE
        SET title = EXCLUDED.title, url = EXCLUDED.url, raw_data = EXCLUDED.raw_data, observed_at = EXCLUDED.observed_at,
            last_seen = now(), ended_at = NULL`;
  }
  const ids = notices.map((n) => n.externalId);
  const ended = await sql`
    UPDATE public_safety_notices SET ended_at = now()
     WHERE town_id = ${townId} AND kind = ${kind} AND ended_at IS NULL AND NOT (external_id = ANY(${ids}))
    RETURNING id`;
  return { written: notices.length, ended: ended.length };
}
