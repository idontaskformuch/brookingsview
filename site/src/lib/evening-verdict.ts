/** Indexing decision for /tonight and /this-weekend (step 7, owner 2026-10-29): ONE verdict per build, used for the robots tag in both
 *  pages and, through a small file, for the sitemap filter in astro.config.mjs, so tag and sitemap cannot disagree.
 *
 *  indexable = the threshold verdict (lib/evening-threshold.ts, median over the next 14 evenings with hysteresis) AND the owner's yes for
 *  the town (siteConfig.eveningLayer.indexApproved). The hysteresis needs to know whether the page is indexable today: that is read from the
 *  live page itself (its robots tag).
 *
 *  Inertia (owner 2026-11-15): an indexed page goes noindex only when every build for at least EVENING_GRACE_HOURS and at least
 *  EVENING_GRACE_BUILDS builds was below the exit bar; one build above it starts over. The count lives in /evening-state.json, published
 *  with the site (astro.config.mjs copies it into dist) and read back by the next build, with `indexed` = this build's answer.
 *
 *  Unknown state (owner 2026-11-15, second rule): when the live robots tag or the live state file cannot be read, the build tries once
 *  more; if it still cannot, it stops with an error, so the town is not deployed and the live pages keep the tag they have. No page
 *  switches between index and noindex because of a failed read. Same rule for every town. */
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

/** Since when, and for how many builds in a row, an indexed page has been below the exit bar (null / 0 = not below); `indexed` = whether
 *  the build that wrote it made the pages indexable (absent in files written before 2026-11-15). */
export interface EveningState { townId: string; belowSince: string | null; belowBuilds: number; indexed?: boolean }

/** One read of the live site: its value, or why it failed. */
export type LiveRead<T> = { ok: true; value: T } | { ok: false; error: string };
/** Pause before the one retry of a failed live read. */
export const LIVE_READ_RETRY_MS = 5000;

export interface EveningInertia {
  indexable: boolean;
  state: EveningState;
  /** While an indexed page is held below the bar: hours and builds still needed before it goes noindex. */
  hoursLeft: number | null;
  buildsLeft: number | null;
}

export interface EveningIndexing { indexable: boolean; approved: boolean; verdict: EveningVerdict; inertia: EveningInertia }

const LIVE_HEADERS = { 'user-agent': 'ViewMediaBuild/1.0' };
/** The failure as a short reason for the build log: the status or the error's name only (never its message, so the build's own retry
 *  wrapper, scripts/build_retry.sh, does not take a stopped build for a transient network error and run it again). */
const why = (e: unknown) => (e instanceof Error ? e.name : 'error');

/** Whether the live page is indexable: its robots meta (BaseLayout always writes one) without noindex. A non-200 answer, a page with no
 *  robots meta or a network error is a failed read, never a guess. */
export async function liveEveningIndexable(siteUrl: string, path = '/tonight/', fetchImpl: typeof fetch = fetch): Promise<LiveRead<boolean>> {
  try {
    const res = await fetchImpl(new URL(path, siteUrl), { signal: AbortSignal.timeout(8000), headers: LIVE_HEADERS });
    if (res.status !== 200) return { ok: false, error: `${path} answered HTTP ${res.status}` };
    const robots = /<meta\s+name="robots"\s+content="([^"]*)"/i.exec(await res.text())?.[1];
    if (robots === undefined) return { ok: false, error: `${path} has no robots meta` };
    return { ok: true, value: !/noindex/i.test(robots) };
  } catch (e) { return { ok: false, error: `${path} could not be read (${why(e)})` }; }
}

/** The state the live site published with its last build. Not 200, not this town's, or not the shape we write = a failed read. */
export async function liveEveningState(siteUrl: string, townId: string, fetchImpl: typeof fetch = fetch): Promise<LiveRead<EveningState>> {
  const path = `/${EVENING_STATE_PATH}`;
  try {
    const res = await fetchImpl(new URL(path, siteUrl), { signal: AbortSignal.timeout(8000), headers: LIVE_HEADERS });
    if (res.status !== 200) return { ok: false, error: `${path} answered HTTP ${res.status}` };
    const s = await res.json();
    if (s?.townId !== townId || !(s.belowSince === null || typeof s.belowSince === 'string') || !Number.isInteger(s.belowBuilds)) {
      return { ok: false, error: `${path} is not a state file for ${townId}` };
    }
    return { ok: true, value: { townId, belowSince: s.belowSince, belowBuilds: s.belowBuilds, ...(typeof s.indexed === 'boolean' ? { indexed: s.indexed } : {}) } };
  } catch (e) { return { ok: false, error: `${path} could not be read (${why(e)})` }; }
}

/** A live read, and once more after `pauseMs` when the first one failed. */
export async function readTwice<T>(read: () => Promise<LiveRead<T>>, pauseMs = LIVE_READ_RETRY_MS): Promise<LiveRead<T>> {
  const first = await read();
  if (first.ok) return first;
  await new Promise((r) => setTimeout(r, pauseMs));
  return read();
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
export function writeEveningVerdict(townId: string, indexable: boolean, state?: EveningState, log?: string, dir = process.cwd()): void {
  try { writeFileSync(resolve(dir, EVENING_VERDICT_FILE), JSON.stringify({ townId, indexable, state, log })); } catch { /* read-only dist: the filter then treats the pages as noindex */ }
}

/** The decision an earlier page of this build already took (the second of /tonight and /this-weekend must not count the build twice). */
function decidedThisBuild(townId: string, dir: string): { indexable: boolean; log?: string } | null {
  try {
    const v = JSON.parse(readFileSync(resolve(dir, EVENING_VERDICT_FILE), 'utf8'));
    return v.townId === townId && typeof v.indexable === 'boolean' && v.state ? { indexable: v.indexable, log: v.log } : null;
  } catch { return null; }
}

/** What both pages call: threshold over the built entries, hysteresis from the live page, inertia from the live state file, the owner's
 *  approval, the build log line and the sitemap file. The second page of the build reuses the first page's decision. Throws (stops the
 *  build, so nothing is deployed) when the live tag or state cannot be read twice. `fetchImpl`, `retryMs` and `dir` exist for the test. */
export async function indexingForTown(o: {
  townId: string; siteUrl: string; layer: { mode: 'threshold' | 'never'; indexApproved?: boolean }; entries: EveningEntry[]; osm: OsmPlace[]; now: Date; tz: string;
  fetchImpl?: typeof fetch; retryMs?: number; dir?: string;
}): Promise<{ indexable: boolean }> {
  const dir = o.dir ?? process.cwd();
  const earlier = decidedThisBuild(o.townId, dir);
  if (earlier) return { indexable: earlier.indexable };
  const approved = o.layer.indexApproved === true;
  const firstNight = localDayNumber(o.now, o.tz) + (localHourOf(o.now, o.tz) >= EVENING_LAST_START_HOUR ? 1 : 0);
  const live = approved && o.layer.mode === 'threshold';
  let previouslyIndexable = false;
  let state: EveningState | null = null;
  if (live) {
    const [tag, st] = await Promise.all([
      readTwice(() => liveEveningIndexable(o.siteUrl, '/tonight/', o.fetchImpl), o.retryMs),
      readTwice(() => liveEveningState(o.siteUrl, o.townId, o.fetchImpl), o.retryMs),
    ]);
    const failed = [tag, st].flatMap((r) => (r.ok ? [] : [r.error]));
    if (failed.length > 0) {
      throw new Error(`[evening] ${o.townId}: could not read the live indexing state from ${o.siteUrl} (tried twice): ${failed.join('; ')}. `
        + `Build stopped: ${o.townId} is not deployed, so the live /tonight/ and /this-weekend/ keep their robots tag.`);
    }
    previouslyIndexable = tag.ok && tag.value;
    state = st.ok ? st.value : null;
  }
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
    : `counter 0 (${live ? 'state read' : 'not used'})`;
  const log = `[evening] ${o.townId}: verdict ${v.indexable} (${v.reason}), owner approval ${approved}, was indexed ${previouslyIndexable}; inertia: ${held} => indexable=${indexing.indexable}; median items ${v.medianItems}, groups ${v.medianGroups}; per evening items/groups ${v.nights.map((n) => `${n.items}/${n.groups}`).join(' ')}`;
  console.log(log);
  writeEveningVerdict(o.townId, indexing.indexable, { ...i.state, indexed: indexing.indexable }, log, dir);
  return { indexable: indexing.indexable };
}
