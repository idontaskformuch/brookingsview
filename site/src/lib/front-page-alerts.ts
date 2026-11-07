/** Maps the alert stories the page loads (db.ts getActiveAlerts) to the front page's alert input. Everything comes from the source's own fields
 *  (events.title, events.source, raw_data.level); never from stories.body. A row from any other source (county re-posts, traffic) is not mapped:
 *  its severity cannot be read from a field, and the selector never guesses it. */
import type { Story } from './db';
import type { FrontPageAlert } from './front-page';

export const ALERTS_URL = '/today/';

export function frontPageAlerts(rows: Pick<Story, 'ends_at' | 'alert'>[]): FrontPageAlert[] {
  const out: FrontPageAlert[] = [];
  for (const r of rows) {
    const a = r.alert;
    const title = (a?.title ?? '').trim();
    if (!a || title === '') continue;
    const until = r.ends_at ?? null;
    if (a.source === 'nws_alert') out.push({ kind: 'weather', headline: title, url: ALERTS_URL, until, event: title });
    else if (a.source === 'met_office_warning' && (a.level ?? '') !== '') out.push({ kind: 'weather', headline: title, url: ALERTS_URL, until, level: a.level! });
  }
  return out;
}
