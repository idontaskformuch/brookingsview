/** Browser side of the Met Office warnings (Glasgow): ONE fetch of /api/weather-warnings shared by the compact box under the
 *  header, the full list on /weather/ and the "Right now" line on /today/. The API answers per hostname, read from the database at
 *  request time, so a new or cancelled warning needs no rebuild. A failed fetch yields "no data" (null), never "no warnings". */
import type { PublicWarning } from './met-warnings';

let inflight: Promise<PublicWarning[] | null> | null = null;
let fetchedAt = 0;

export function fetchWarnings(maxAgeMs = 60_000): Promise<PublicWarning[] | null> {
  if (inflight && Date.now() - fetchedAt < maxAgeMs) return inflight;
  fetchedAt = Date.now();
  inflight = fetch('/api/weather-warnings', { headers: { Accept: 'application/json' } })
    .then(async (r) => {
      if (!r.ok) return null;
      const data = (await r.json()) as { warnings?: PublicWarning[] };
      return Array.isArray(data.warnings) ? data.warnings : null;
    })
    .catch(() => null);
  return inflight;
}
