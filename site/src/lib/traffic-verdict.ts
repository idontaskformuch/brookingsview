/** Indexing of /traffic/ (owner 2026-11-15, replaces AdSense plan F4's "noindex while nothing is reported" and its status line).
 *  Each town with a traffic source says which of two rules it follows (SiteConfig.trafficSource.indexing):
 *
 *  - 'standing': the source lists planned closures and roadworks in every read, so the page always has content from the source and is
 *    always indexed (Moreno Valley: Caltrans lane closures, at least two on the page in every read 31 Oct - 15 Nov 2026).
 *  - 'inertia': the page is often empty between incidents (Broomfield: CDOT, nothing near town in 18 of 30 reads 31 Oct - 15 Nov 2026).
 *    It is indexed while the latest read lists something; an indexed page goes noindex only when the reads have been empty for at least
 *    TRAFFIC_GRACE_HOURS and at least TRAFFIC_GRACE_READS reads. Reads are counted, not builds: a rebuild of the same read counts once.
 *    The count is published as /traffic-state.json and read back from the live site by the next build (like /evening-state.json).
 *
 *  Both: the page never shows an empty message or an explanation line. A town whose latest read is older than
 *  TRAFFIC_READ_MAX_AGE_HOURS keeps the tag it has (nothing is counted). Unknown state (the live robots tag or the live state file cannot
 *  be read twice) stops the build, so the town is not deployed and the live page keeps its tag. The page writes its verdict for the
 *  sitemap filter in astro.config.mjs, so tag and sitemap cannot disagree. */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { liveEveningIndexable, readTwice, type LiveRead } from './evening-verdict';

export const TRAFFIC_VERDICT_FILE = '.traffic-verdict.json';
/** Published at the site root by an 'inertia' town; the next build reads it from the live site. */
export const TRAFFIC_STATE_PATH = 'traffic-state.json';
export const TRAFFIC_GRACE_HOURS = 72;
export const TRAFFIC_GRACE_READS = 3;

/** A read older than this lists nothing (db.ts getTrafficIncidentsFromLatestRead) and is not counted. */
export const TRAFFIC_READ_MAX_AGE_HOURS = 26;

export type TrafficIndexingRule = 'standing' | 'inertia';

/** Since which empty read, and for how many distinct empty reads, an indexed page has listed nothing (null / 0 = not empty);
 *  `lastRead` = the read counted last (a rebuild of the same read does not count again); `indexed` = this build's answer. */
export interface TrafficState { townId: string; emptySince: string | null; emptyReads: number; lastRead: string | null; indexed?: boolean }

export interface TrafficInertia {
  indexable: boolean;
  state: TrafficState;
  /** While an indexed page is held with empty reads: hours and reads still needed before it goes noindex. */
  hoursLeft: number | null;
  readsLeft: number | null;
}

const LIVE_HEADERS = { 'user-agent': 'ViewMediaBuild/1.0' };
/** Status or error name only, never the message (scripts/build_retry.sh must not take a stopped build for a transient error). */
const why = (e: unknown) => (e instanceof Error ? e.name : 'error');

/** The state the live site published with its last build. 404 = no state published yet (the first deploy of this rule): a fresh count,
 *  which can only delay a switch, never cause one. Any other failure, another town's file or a wrong shape = a failed read. */
export async function liveTrafficState(siteUrl: string, townId: string, fetchImpl: typeof fetch = fetch): Promise<LiveRead<TrafficState | null>> {
  const path = `/${TRAFFIC_STATE_PATH}`;
  try {
    const res = await fetchImpl(new URL(path, siteUrl), { signal: AbortSignal.timeout(8000), headers: LIVE_HEADERS });
    if (res.status === 404) return { ok: true, value: null };
    if (res.status !== 200) return { ok: false, error: `${path} answered HTTP ${res.status}` };
    const s = await res.json();
    const nullableString = (v: unknown) => v === null || typeof v === 'string';
    if (s?.townId !== townId || !nullableString(s.emptySince) || !nullableString(s.lastRead) || !Number.isInteger(s.emptyReads)) {
      return { ok: false, error: `${path} is not a state file for ${townId}` };
    }
    return { ok: true, value: { townId, emptySince: s.emptySince, emptyReads: s.emptyReads, lastRead: s.lastRead, ...(typeof s.indexed === 'boolean' ? { indexed: s.indexed } : {}) } };
  } catch (e) { return { ok: false, error: `${path} could not be read (${why(e)})` }; }
}

/** One build's decision for an 'inertia' town. `readAt` = when the latest read finished, or null when there is no read within
 *  TRAFFIC_READ_MAX_AGE_HOURS (then the page keeps its tag and the count is left as it is). */
export function applyTrafficInertia(o: { townId: string; hasIncidents: boolean; readAt: string | null; wasIndexed: boolean; state: TrafficState | null }): TrafficInertia {
  const clear: TrafficState = { townId: o.townId, emptySince: null, emptyReads: 0, lastRead: o.readAt };
  const prev = o.state && o.state.townId === o.townId && o.state.emptySince && !Number.isNaN(Date.parse(o.state.emptySince)) && o.state.emptyReads > 0 ? o.state : null;
  if (o.readAt === null) {
    const kept = prev ?? { ...clear, lastRead: o.state?.townId === o.townId ? o.state.lastRead : null };
    return { indexable: o.wasIndexed, state: kept, hoursLeft: null, readsLeft: null };
  }
  if (o.hasIncidents || !o.wasIndexed) return { indexable: o.hasIncidents, state: clear, hoursLeft: null, readsLeft: null };
  const emptySince = prev?.emptySince ?? o.readAt;
  const emptyReads = prev ? prev.emptyReads + (prev.lastRead === o.readAt ? 0 : 1) : 1;
  const hours = (Date.parse(o.readAt) - Date.parse(emptySince)) / 3_600_000;
  if (hours >= TRAFFIC_GRACE_HOURS && emptyReads >= TRAFFIC_GRACE_READS) return { indexable: false, state: clear, hoursLeft: 0, readsLeft: 0 };
  return {
    indexable: true, state: { townId: o.townId, emptySince, emptyReads, lastRead: o.readAt },
    hoursLeft: Math.max(0, TRAFFIC_GRACE_HOURS - hours), readsLeft: Math.max(0, TRAFFIC_GRACE_READS - emptyReads),
  };
}

/** The sitemap filter (astro.config.mjs) reads this file after the page is built; an 'inertia' town's `state` is copied to
 *  dist/traffic-state.json. */
export function writeTrafficVerdict(townId: string, indexable: boolean, state?: TrafficState, dir = process.cwd()): void {
  try { writeFileSync(resolve(dir, TRAFFIC_VERDICT_FILE), JSON.stringify({ townId, indexable, state })); } catch { /* read-only dist: the filter then treats the page as noindex */ }
}

/** What the page calls. `readAt` = the latest ok read's finish time, null when it is older than TRAFFIC_READ_MAX_AGE_HOURS or missing.
 *  Throws (stops the build, nothing is deployed) when an 'inertia' town's live tag or state cannot be read twice. `fetchImpl`, `retryMs`
 *  and `dir` exist for the test. */
export async function trafficIndexingForTown(o: {
  townId: string; siteUrl: string; rule: TrafficIndexingRule; quiet: boolean; incidentCount: number; readAt: string | null;
  fetchImpl?: typeof fetch; retryMs?: number; dir?: string;
}): Promise<{ indexable: boolean }> {
  if (o.quiet || o.rule === 'standing') {
    const indexable = !o.quiet;
    console.log(`[traffic] ${o.townId}: rule ${o.quiet ? 'quiet section' : 'standing'}, ${o.incidentCount} listed => indexable=${indexable}`);
    writeTrafficVerdict(o.townId, indexable, undefined, o.dir);
    return { indexable };
  }
  const [tag, st] = await Promise.all([
    readTwice(() => liveEveningIndexable(o.siteUrl, '/traffic/', o.fetchImpl), o.retryMs),
    readTwice(() => liveTrafficState(o.siteUrl, o.townId, o.fetchImpl), o.retryMs),
  ]);
  const failed = [tag, st].flatMap((r) => (r.ok ? [] : [r.error]));
  if (failed.length > 0 || !tag.ok || !st.ok) {
    throw new Error(`[traffic] ${o.townId}: could not read the live indexing state from ${o.siteUrl} (tried twice): ${failed.join('; ')}. `
      + `Build stopped: ${o.townId} is not deployed, so the live /traffic/ keeps its robots tag.`);
  }
  const i = applyTrafficInertia({ townId: o.townId, hasIncidents: o.incidentCount > 0, readAt: o.readAt, wasIndexed: tag.value, state: st.value });
  const held = o.readAt === null
    ? `no read within ${TRAFFIC_READ_MAX_AGE_HOURS} h: tag kept, nothing counted`
    : i.hoursLeft !== null
      ? i.indexable
        ? `empty since read ${i.state.emptySince}, read ${i.state.emptyReads} of >= ${TRAFFIC_GRACE_READS}, ${i.hoursLeft.toFixed(1)} h and ${i.readsLeft} read(s) left before noindex`
        : `empty for >= ${TRAFFIC_GRACE_HOURS} h and >= ${TRAFFIC_GRACE_READS} reads: noindex now`
      : 'counter 0';
  console.log(`[traffic] ${o.townId}: rule inertia, read ${o.readAt ?? 'none'}, ${o.incidentCount} listed, was indexed ${tag.value}; ${held} => indexable=${i.indexable}`);
  writeTrafficVerdict(o.townId, i.indexable, { ...i.state, indexed: i.indexable }, o.dir);
  return { indexable: i.indexable };
}
