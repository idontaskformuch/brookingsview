/** Indexing decision for /tonight and /this-weekend (step 7, owner 2026-10-29): ONE verdict per build, used for the robots tag in both
 *  pages and, through a small file, for the sitemap filter in astro.config.mjs, so tag and sitemap cannot disagree.
 *
 *  indexable = the threshold verdict (lib/evening-threshold.ts, median over the next 14 evenings with hysteresis) AND the owner's yes for
 *  the town (siteConfig.eveningLayer.indexApproved). The hysteresis needs to know whether the page is indexable today: that is read from the
 *  live page itself (its robots tag), so nothing is stored anywhere and a failed read counts as "not indexed yet" (the stricter bar). */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluateEveningThreshold, EVENING_LAST_START_HOUR, type EveningItem, type EveningVerdict } from './evening-threshold';
import { toThresholdItems, type EveningEntry } from './evening-items';
import { openLateCounts, type OsmPlace } from './osm-open-late';
import { localDayNumber, localHourOf } from './local-day';

export const EVENING_VERDICT_FILE = '.evening-verdict.json';

export interface EveningIndexing { indexable: boolean; approved: boolean; verdict: EveningVerdict }

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

export function decideEveningIndexing(o: {
  items: EveningItem[]; now: Date; timezone: string; mode: 'threshold' | 'never'; approved: boolean;
  previouslyIndexable: boolean; openLateByDay?: Record<number, number>;
}): EveningIndexing {
  const verdict = evaluateEveningThreshold({ items: o.items, now: o.now, timezone: o.timezone, mode: o.mode, previouslyIndexable: o.previouslyIndexable, openLateByDay: o.openLateByDay });
  return { indexable: verdict.indexable && o.approved, approved: o.approved, verdict };
}

/** The sitemap filter (astro.config.mjs) reads this file after the pages are built. */
export function writeEveningVerdict(townId: string, indexable: boolean): void {
  try { writeFileSync(resolve(process.cwd(), EVENING_VERDICT_FILE), JSON.stringify({ townId, indexable })); } catch { /* read-only dist: the filter then treats the pages as noindex */ }
}

/** What both pages call: threshold over the built entries, hysteresis from the live page, the owner's approval, the build log line and the
 *  sitemap file. Same inputs on /tonight and /this-weekend, so the same answer. */
export async function indexingForTown(o: {
  townId: string; siteUrl: string; layer: { mode: 'threshold' | 'never'; indexApproved?: boolean }; entries: EveningEntry[]; osm: OsmPlace[]; now: Date; tz: string;
}): Promise<EveningIndexing> {
  const approved = o.layer.indexApproved === true;
  const firstNight = localDayNumber(o.now, o.tz) + (localHourOf(o.now, o.tz) >= EVENING_LAST_START_HOUR ? 1 : 0);
  const previouslyIndexable = approved && o.layer.mode === 'threshold' ? await liveEveningIndexable(o.siteUrl) : false;
  const indexing = decideEveningIndexing({
    items: toThresholdItems(o.entries), now: o.now, timezone: o.tz, mode: o.layer.mode, approved, previouslyIndexable,
    openLateByDay: openLateCounts(o.osm, firstNight, 14, o.tz),
  });
  const v = indexing.verdict;
  console.log(`[evening] ${o.townId}: verdict ${v.indexable} (${v.reason}), owner approval ${approved}, was indexed ${previouslyIndexable} => indexable=${indexing.indexable}; median items ${v.medianItems}, groups ${v.medianGroups}`);
  writeEveningVerdict(o.townId, indexing.indexable);
  return indexing;
}
