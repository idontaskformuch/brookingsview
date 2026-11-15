/** Indexing decision for /tonight and /this-weekend (step 7, owner 2026-10-29): ONE verdict per build, used for the robots tag in both
 *  pages and, through a small file, for the sitemap filter in astro.config.mjs, so tag and sitemap cannot disagree.
 *
 *  indexable = the threshold verdict (lib/evening-threshold.ts, median over the next 14 evenings with hysteresis) AND the owner's yes for
 *  the town (siteConfig.eveningLayer.indexApproved). The hysteresis needs to know whether the page is indexable today: that is read from the
 *  live page itself (its robots tag); a failed read counts as "not indexed yet" (the stricter bar).
 *
 *  Inertia (owner 2026-11-15): an indexed page goes noindex only when every build for at least EVENING_GRACE_HOURS and at least
 *  EVENING_GRACE_BUILDS builds was below the exit bar; one build above it starts over. The count lives in /evening-state.json, published
 *  with the site (astro.config.mjs copies it into dist) and read back by the next build. A failed read starts the count over, so the
 *  page never goes noindex on the build that could not read it. Same rule for every town. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluateEveningThreshold, EVENING_LAST_START_HOUR, type EveningItem, type EveningVerdict } from './evening-threshold';
import { toThresholdItems, type EveningEntry } from './evening-items';
import { openLateCounts, type OsmPlace } from './osm-open-late';
import { localDayNumber, localHourOf } from './local-day';

export const EVENING_VERDICT_FILE = '.evening-verdict.json';
/** Published at the site root; the next build reads it from the live site. */
export const EVENING_STATE_PATH = 'evening-state.json';
export const EVENING_GRACE_HOURS = 72;
export const EVENING_GRACE_BUILDS = 3;

/** Since when, and for how many builds in a row, an indexed page has been below the exit bar (null / 0 = not below). */
export interface EveningState { townId: string; belowSince: string | null; belowBuilds: number }

export interface EveningInertia {
  indexable: boolean;
  state: EveningState;
  /** While an indexed page is held below the bar: hours and builds still needed before it goes noindex. */
  hoursLeft: number | null;
  buildsLeft: number | null;
}

export interface EveningIndexing { indexable: boolean; approved: boolean; verdict: EveningVerdict; inertia: EveningInertia }

/** True when the live page answers 200 and its robots meta has no noindex. Any failure is false. */
export async function liveEveningIndexable(siteUrl: string, path = '/tonight/'): Promise<boolean> {
  try {
    const res = await fetch(new URL(path, siteUrl), { signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'ViewMediaBuild/1.0' } });
    if (res.status !== 200) return false;
    const html = await res.text();
    const robots = /<meta\s+name="robots"\s+content="([^"]*)"/i.exec(html)?.[1] ?? '';
    return !/noindex/i.test(robots);
  } catch { return false; }
}

/** The state the live site published with its last build; null when it cannot be read or is not this town's. */
export async function liveEveningState(siteUrl: string, townId: string): Promise<EveningState | null> {
  try {
    const res = await fetch(new URL(`/${EVENING_STATE_PATH}`, siteUrl), { signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'ViewMediaBuild/1.0' } });
    if (res.status !== 200) return null;
    const s = await res.json();
    if (s?.townId !== townId || !(s.belowSince === null || typeof s.belowSince === 'string') || !Number.isInteger(s.belowBuilds)) return null;
    return { townId, belowSince: s.belowSince, belowBuilds: s.belowBuilds };
  } catch { return null; }
}

/** Inertia on top of the threshold verdict. Only an indexed page is held; a page that is not indexed follows the verdict at once. */
export function applyEveningInertia(o: { townId: string; thresholdIndexable: boolean; wasIndexed: boolean; state: EveningState | null; now: Date }): EveningInertia {
  const clear: EveningState = { townId: o.townId, belowSince: null, belowBuilds: 0 };
  if (!o.wasIndexed || o.thresholdIndexable) return { indexable: o.thresholdIndexable, state: clear, hoursLeft: null, buildsLeft: null };
  const prev = o.state && o.state.townId === o.townId && o.state.belowSince && !Number.isNaN(Date.parse(o.state.belowSince)) ? o.state : null;
  const belowSince = prev?.belowSince ?? o.now.toISOString();
  const belowBuilds = (prev?.belowBuilds ?? 0) + 1;
  const hours = (o.now.getTime() - Date.parse(belowSince)) / 3_600_000;
  if (hours >= EVENING_GRACE_HOURS && belowBuilds >= EVENING_GRACE_BUILDS) return { indexable: false, state: clear, hoursLeft: 0, buildsLeft: 0 };
  return {
    indexable: true, state: { townId: o.townId, belowSince, belowBuilds },
    hoursLeft: Math.max(0, EVENING_GRACE_HOURS - hours), buildsLeft: Math.max(0, EVENING_GRACE_BUILDS - belowBuilds),
  };
}

export function decideEveningIndexing(o: {
  items: EveningItem[]; now: Date; timezone: string; mode: 'threshold' | 'never'; approved: boolean;
  previouslyIndexable: boolean; openLateByDay?: Record<number, number>; townId?: string; state?: EveningState | null;
}): EveningIndexing {
  const verdict = evaluateEveningThreshold({ items: o.items, now: o.now, timezone: o.timezone, mode: o.mode, previouslyIndexable: o.previouslyIndexable, openLateByDay: o.openLateByDay });
  const inertia = applyEveningInertia({
    townId: o.townId ?? '', thresholdIndexable: verdict.indexable, wasIndexed: o.previouslyIndexable && o.mode === 'threshold', state: o.state ?? null, now: o.now,
  });
  return { indexable: inertia.indexable && o.approved, approved: o.approved, verdict, inertia };
}

/** The sitemap filter (astro.config.mjs) reads this file after the pages are built, and copies `state` to dist/evening-state.json. */
export function writeEveningVerdict(townId: string, indexable: boolean, state?: EveningState, log?: string): void {
  try { writeFileSync(resolve(process.cwd(), EVENING_VERDICT_FILE), JSON.stringify({ townId, indexable, state, log })); } catch { /* read-only dist: the filter then treats the pages as noindex */ }
}

/** The decision an earlier page of this build already took (the second of /tonight and /this-weekend must not count the build twice). */
function decidedThisBuild(townId: string): { indexable: boolean; log?: string } | null {
  try {
    const v = JSON.parse(readFileSync(resolve(process.cwd(), EVENING_VERDICT_FILE), 'utf8'));
    return v.townId === townId && typeof v.indexable === 'boolean' && v.state ? { indexable: v.indexable, log: v.log } : null;
  } catch { return null; }
}

/** What both pages call: threshold over the built entries, hysteresis from the live page, inertia from the live state file, the owner's
 *  approval, the build log line and the sitemap file. The second page of the build reuses the first page's decision. */
export async function indexingForTown(o: {
  townId: string; siteUrl: string; layer: { mode: 'threshold' | 'never'; indexApproved?: boolean }; entries: EveningEntry[]; osm: OsmPlace[]; now: Date; tz: string;
}): Promise<{ indexable: boolean }> {
  const earlier = decidedThisBuild(o.townId);
  if (earlier) return { indexable: earlier.indexable };
  const approved = o.layer.indexApproved === true;
  const firstNight = localDayNumber(o.now, o.tz) + (localHourOf(o.now, o.tz) >= EVENING_LAST_START_HOUR ? 1 : 0);
  const live = approved && o.layer.mode === 'threshold';
  const [previouslyIndexable, state] = live ? await Promise.all([liveEveningIndexable(o.siteUrl), liveEveningState(o.siteUrl, o.townId)]) : [false, null];
  const indexing = decideEveningIndexing({
    items: toThresholdItems(o.entries), now: o.now, timezone: o.tz, mode: o.layer.mode, approved, previouslyIndexable,
    openLateByDay: openLateCounts(o.osm, firstNight, 14, o.tz), townId: o.townId, state,
  });
  const v = indexing.verdict;
  const i = indexing.inertia;
  const held = i.hoursLeft !== null
    ? i.indexable
      ? `below the exit bar since ${i.state.belowSince}, build ${i.state.belowBuilds} of >= ${EVENING_GRACE_BUILDS}, ${i.hoursLeft.toFixed(1)} h and ${i.buildsLeft} build(s) left before noindex`
      : `below the exit bar for >= ${EVENING_GRACE_HOURS} h and >= ${EVENING_GRACE_BUILDS} builds: noindex now`
    : `counter 0 (${live ? `state ${state ? 'read' : 'not read'}` : 'not used'})`;
  const log = `[evening] ${o.townId}: verdict ${v.indexable} (${v.reason}), owner approval ${approved}, was indexed ${previouslyIndexable}; inertia: ${held} => indexable=${indexing.indexable}; median items ${v.medianItems}, groups ${v.medianGroups}`;
  console.log(log);
  writeEveningVerdict(o.townId, indexing.indexable, i.state, log);
  return { indexable: indexing.indexable };
}
