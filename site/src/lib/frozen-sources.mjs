/**
 * Frozen event sources (owner 2026-11-13): a source we may no longer fetch (tockify's robots.txt disallows /api/ for us) keeps its
 * already published rows visible for a fixed window, then they disappear. Visible while the row's date (occurs_at, local) is on or
 * before since + showDays: since 2026-11-13 + 14 = through 2026-11-27. A fixed limit, not a rolling one -- nothing moves it but the config.
 * The map mirrors configs/<town>.json data_sources.events.sources[].frozen (tests/test_frozen_sources_config.py fails if they disagree).
 * No imports: astro.config.mjs (the sitemap mirror) and lib/db.ts (the pages) both decide with hiddenFrozenSlugs(). Types: frozen-sources.d.mts.
 */
export const FROZEN_EVENT_SOURCES = {
  moreno_valley_ca: {
    city_events: { since: '2026-11-13', showDays: 14 },
    library: { since: '2026-11-13', showDays: 14 },
  },
};

/** Written by astro.config.mjs into dist: a JSON array of the hidden dated event slugs (event-N), read by the Worker. */
export const FROZEN_HIDDEN_EVENTS_ASSET = 'frozen-hidden-events.json';

function localParts(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour'), min: get('minute') };
}

/** First instant that is hidden: local midnight starting the day after since + showDays. */
export function frozenCutoff({ since, showDays }, timeZone) {
  const [y, m, d] = since.split('-').map(Number);
  const want = Date.UTC(y, m - 1, d + showDays + 1);
  let t = want;
  for (let i = 0; i < 3; i++) {
    const p = localParts(new Date(t), timeZone);
    t += want - Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
  }
  return new Date(t);
}

/** Slugs to leave out everywhere (not built, not listed). rows: { slug, source, occurs_at } -- one per story and the events source it
 *  came from (stories.slug = 'event-' || events.id, or a series whose source_url is one of the source's event urls). A row without a
 *  date is never hidden. An empty `frozen` hides nothing. */
export function hiddenFrozenSlugs(rows, frozen, timeZone) {
  const cutoffs = new Map(Object.entries(frozen ?? {}).map(([source, f]) => [source, frozenCutoff(f, timeZone)]));
  const hidden = new Set();
  for (const r of rows) {
    const cutoff = cutoffs.get(r.source);
    if (cutoff && r.occurs_at && new Date(r.occurs_at) >= cutoff) hidden.add(r.slug);
  }
  return [...hidden].sort();
}
