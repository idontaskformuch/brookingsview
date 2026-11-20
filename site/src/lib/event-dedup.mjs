/**
 * Cross-source event dedup, with no imports so astro.config.mjs (which loads before Vite's env pipeline, so it cannot import lib/db.ts or
 * lib/site-config.ts) can run the SAME code as the pages. lib/events.ts re-exports these and wraps buildEventFeedCore() as buildEventFeed();
 * lib/week-count.mjs uses it to count a week's items for both the sitemap and the page's noindex. Types: event-dedup.d.mts.
 */

export function itemTitle(item) {
  return item.sourceKind === 'story' ? item.story.title : item.event.title;
}
export function itemUrl(item) {
  return item.sourceKind === 'story' ? item.story.source_url : item.event.event_url;
}
export function itemVenue(item) {
  return item.sourceKind === 'story' ? (item.story.venue_raw ?? null) : item.event.location;
}

/** "Downtown @ Sundown" (Chamber) / "Downtown at Sundown" (SDSU) -- "@" is
 *  common shorthand for "at," so it's expanded BEFORE punctuation is
 *  stripped, or the two titles diverge instead of converging. */
function normalizeTitle(title) {
  return title
    .toLowerCase()
    .replace(/@/g, ' at ')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function localDateParts(instant, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

/** Per-source participation in cross-source dedup matching (see
 *  findCrossSourceMatch() below) -- encoded as data rather than a hardcoded
 *  if/else so a future source is a new map entry, not a new branch.
 *  `ticketmaster` is registered here even though it never reaches
 *  buildEventFeed() yet -- see lib/ticketmaster.ts's own module comment. */
export const EVENT_SOURCES = {
  story: { crossMatch: true },
  arts: { crossMatch: true },
  ticketmaster: { crossMatch: true },
};

/** Same calendar date + exact normalized-title match, cross-SOURCE only
 *  (never within the same source -- the library legitimately lists the same
 *  class title twice for two different session times, and SDSU legitimately
 *  lists the same show twice for a matinee/evening pair; a same-source match
 *  would wrongly collapse those). Generic over the number of participating
 *  sources. `dateKey` is `null` for an undated item (never matches anything). */
export function findCrossSourceMatch(sourceKind, dateKey, normalizedTitle, canonicalByKey, sources) {
  if (!dateKey || !sources[sourceKind]?.crossMatch) return undefined;
  for (const otherKind of Object.keys(sources)) {
    if (otherKind === sourceKind || !sources[otherKind].crossMatch) continue;
    const found = canonicalByKey.get(`${dateKey}|${otherKind}|${normalizedTitle}`);
    if (found) return found;
  }
  return undefined;
}

const TITLE_STOPWORDS = new Set(['the', 'a', 'an', 'at', 'of', 'and', 'for', 'in', 'on', 'to', 'with']);

function titleTokens(title) {
  return new Set(normalizeTitle(title).split(' ').filter((w) => w && !TITLE_STOPWORDS.has(w)));
}

function hostOf(item) {
  const url = itemUrl(item);
  try { return url ? new URL(url).hostname.replace(/^www\./, '') : ''; } catch { return ''; }
}

/** Two venue strings can be the same place: either is unknown, or the names (first comma part, no leading "The") are equal or one
 *  contains the other ("The Oscar Larson Performing Arts Center" / "Oscar Larson Performing Arts Center, 1601 University Blvd").
 *  Designsystem Fas 2 (owner 2026-11-20): a merge needs the same place, so "Gifting for Good" at McCrory Gardens and "Gifting for Good
 *  at Ag Heritage Museum" (same 10 AM start, two calendars) stay two events. Same key as lib/event-entries.ts venueKey. */
export function venueKey(v) {
  const first = (v ?? '').split(',')[0];
  const k = first.toLowerCase().replace(/&/g, ' and ').replace(/@/g, ' at ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/^the /, '');
  return k || null;
}
/** The room inside the venue, when the source names one as the second comma part and it is not an address: "Glasgow Royal Concert
 *  Hall, Strathclyde Suite" (story 4081) / "..., New Auditorium" (story 4151) -> "strathclyde suite" / "new auditorium". An address part
 *  ("1601 University Boulevard", "16170 Perris Blvd Suite C3") starts with a digit and is never a room. null = no room named.
 *  Owner 2026-11-20: two rooms of one building at the same time are two events, never merged. */
const ROOM_WORDS = /\b(suite|room|hall|auditorium|studio|gallery|theatre|theater|lounge|ballroom|stage)\b/i;
export function venueRoom(v) {
  const second = (v ?? '').split(',')[1]?.trim() ?? '';
  if (!second || /^\d/.test(second) || !ROOM_WORDS.test(second)) return null;
  return second.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() || null;
}
/** Both name a room and the rooms differ. */
export function roomsDiffer(a, b) {
  const ra = venueRoom(a), rb = venueRoom(b);
  return !!ra && !!rb && ra !== rb;
}
function venuesCompatible(a, b) {
  const ka = venueKey(a), kb = venueKey(b);
  if (roomsDiffer(a, b)) return false;
  return !ka || !kb || ka === kb || ka.includes(kb) || kb.includes(ka);
}

/** The same real event listed by two calendars under differently worded titles
 *  ("The Yule Market" / "The Yule Market Opening Day" / "Museum Shop Yule Market
 *  Opens", all 10 AM on Oct 24). Second pass of buildEventFeed(), narrower than
 *  the exact-title rule on purpose: SAME start instant, DIFFERENT calendar
 *  (link host), and the shorter title's words (stopwords dropped, at least two)
 *  all appear in the longer one. Two sessions on one calendar never merge. The
 *  survivor is the one that names a venue (a page of its own beats an outbound
 *  link), then the first in list order. */
function mergeSameStartTitleContainment(items, alsoListedBy) {
  const byStart = new Map();
  for (const it of items) {
    if (!it.occurs_at) continue;
    const key = new Date(it.occurs_at).toISOString();
    byStart.set(key, [...(byStart.get(key) ?? []), it]);
  }
  const dropped = new Set();
  for (const group of byStart.values()) {
    if (group.length < 2) continue;
    const tokens = group.map((it) => titleTokens(itemTitle(it)));
    // union-find over "one title contains the other" (C and A may only be linked through B)
    const parent = group.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (hostOf(group[i]) === hostOf(group[j])) continue;
        if (!venuesCompatible(itemVenue(group[i]), itemVenue(group[j]))) continue;
        const [small, large] = tokens[i].size <= tokens[j].size ? [tokens[i], tokens[j]] : [tokens[j], tokens[i]];
        if (small.size >= 2 && [...small].every((w) => large.has(w))) parent[find(i)] = find(j);
      }
    }
    const clusters = new Map();
    group.forEach((it, i) => clusters.set(find(i), [...(clusters.get(find(i)) ?? []), it]));
    for (const members of clusters.values()) {
      if (members.length < 2) continue;
      const keep = members.find((m) => itemVenue(m)) ?? members[0];
      const hosts = new Set(alsoListedBy.get(keep) ?? []);
      for (const m of members) {
        if (m === keep) continue;
        dropped.add(m);
        for (const h of [hostOf(m), ...(alsoListedBy.get(m) ?? [])]) if (h && h !== hostOf(keep)) hosts.add(h);
      }
      if (hosts.size > 0) alsoListedBy.set(keep, [...hosts]);
    }
  }
  return items.filter((it) => !dropped.has(it));
}

/** The dedup itself, over already-built feed items ({ sourceKind: 'story' | 'arts', occurs_at, story | event }). */
export function buildEventFeedCore(rawItems, timezone) {
  const canonicalByKey = new Map();
  const alsoListedBy = new Map();
  const items = [];
  for (const item of rawItems) {
    const dateParts = item.occurs_at ? localDateParts(new Date(item.occurs_at), timezone) : null;
    const dateKey = dateParts ? `${dateParts.y}-${dateParts.m}-${dateParts.d}` : null;
    const normalizedTitle = normalizeTitle(itemTitle(item));
    const ownKey = dateKey ? `${dateKey}|${item.sourceKind}|${normalizedTitle}` : null;
    const canonical = findCrossSourceMatch(item.sourceKind, dateKey, normalizedTitle, canonicalByKey, EVENT_SOURCES);

    if (canonical) {
      const url = itemUrl(item);
      if (url) {
        const host = new URL(url).hostname.replace(/^www\./, '');
        const list = alsoListedBy.get(canonical) ?? [];
        if (!list.includes(host)) list.push(host);
        alsoListedBy.set(canonical, list);
      }
      continue; // already covered by the canonical entry -- no separate card
    }
    if (ownKey) canonicalByKey.set(ownKey, item);
    items.push(item);
  }
  const deduped = mergeSameStartTitleContainment(items, alsoListedBy);

  deduped.sort((a, b) => {
    if (!a.occurs_at) return 1;
    if (!b.occurs_at) return -1;
    return new Date(a.occurs_at).getTime() - new Date(b.occurs_at).getTime();
  });
  return { items: deduped, alsoListedBy };
}
