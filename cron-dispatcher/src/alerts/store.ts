/** Writes warning rows to the `events` table the same way the Python parsers do (see scrapers/parsers/nws_alerts.py and
 *  met_office_warnings_v1.py), so the existing readers (publish.py, /api/weather-warnings, lib/db.ts getActiveAlerts) need no change. */
import type { AlertRecord } from './nws';

export type Sql = (strings: TemplateStringsArray, ...values: any[]) => Promise<any[]>;

/** NWS: upsert on (town_id, content_hash); an alert NWS no longer lists (cancelled early) is ended now.
 *  Only call this after a SUCCESSFUL fetch: a failed fetch must never end anything. */
export async function storeNws(sql: Sql, townId: string, records: AlertRecord[]): Promise<{ written: number; ended: number }> {
  let written = 0;
  for (const r of records) {
    const rows = await sql`
      INSERT INTO events (town_id, title, starts_at, ends_at, venue, source, url, raw_data, content_hash)
      VALUES (${townId}, ${r.title}, ${r.starts_at}, ${r.ends_at}, ${r.venue}, ${r.source}, ${r.url}, ${JSON.stringify(r.raw_data)}::jsonb, ${r.content_hash})
      ON CONFLICT (town_id, content_hash) DO UPDATE
        SET title = EXCLUDED.title, starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at, venue = EXCLUDED.venue,
            url = EXCLUDED.url, raw_data = EXCLUDED.raw_data
        WHERE events.raw_data IS DISTINCT FROM EXCLUDED.raw_data OR events.ends_at IS DISTINCT FROM EXCLUDED.ends_at
      RETURNING id`;
    written += rows.length;
  }
  const hashes = records.map((r) => r.content_hash);
  const ended = await sql`
    UPDATE events SET ends_at = now()
     WHERE town_id = ${townId} AND source = 'nws_alert' AND ends_at > now() AND NOT (content_hash = ANY(${hashes}))
    RETURNING id`;
  return { written, ended: ended.length };
}

/** Met Office: one row per warningId, overwritten in place by newer versions and EXPIRED/CANCELLED states. */
export async function storeMetOffice(sql: Sql, townId: string, records: AlertRecord[]): Promise<{ written: number }> {
  let written = 0;
  for (const r of records) {
    const warningId = String(r.raw_data.warning_id);
    const existing = await sql`
      SELECT id FROM events WHERE town_id = ${townId} AND source = ${r.source} AND raw_data->>'warning_id' = ${warningId}
       ORDER BY id LIMIT 1`;
    if (existing.length) {
      const rows = await sql`
        UPDATE events SET title = ${r.title}, starts_at = ${r.starts_at}, ends_at = ${r.ends_at}, url = ${r.url},
                          raw_data = ${JSON.stringify(r.raw_data)}::jsonb
         WHERE id = ${existing[0].id} AND (raw_data IS DISTINCT FROM ${JSON.stringify(r.raw_data)}::jsonb OR ends_at IS DISTINCT FROM ${r.ends_at}::timestamptz)
        RETURNING id`;
      written += rows.length;
    } else {
      const rows = await sql`
        INSERT INTO events (town_id, title, starts_at, ends_at, venue, source, url, raw_data, content_hash)
        VALUES (${townId}, ${r.title}, ${r.starts_at}, ${r.ends_at}, ${r.venue}, ${r.source}, ${r.url}, ${JSON.stringify(r.raw_data)}::jsonb, ${r.content_hash})
        ON CONFLICT (town_id, content_hash) DO NOTHING RETURNING id`;
      written += rows.length;
    }
  }
  return { written };
}
