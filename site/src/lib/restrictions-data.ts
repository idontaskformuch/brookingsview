/** Build-time loader for lib/restrictions.ts (kept apart so restrictions.ts stays DB-free and can ship to the browser). */
import { getRestrictionChecks } from './db';
import { restrictionView, type RestrictionCheck, type RestrictionKind, type RestrictionView } from './restrictions';
import type { SiteConfig } from './site-config';

const KINDS: RestrictionKind[] = ['fire', 'water'];
let checks: Promise<{ latest: RestrictionCheck[]; lastGood: RestrictionCheck[] }> | null = null;

/** One view per configured kind, in fixed order (fire, water). A failed DB read (or no table yet) gives "unknown" for every
 *  kind, never "none": the owner's rule is that only a fresh, successful check may say there is no restriction. */
export async function loadRestrictionViews(cfg: SiteConfig, now: Date): Promise<RestrictionView[]> {
  const sources = cfg.restrictions;
  if (!sources) return [];
  checks ??= getRestrictionChecks().catch(() => ({ latest: [], lastGood: [] }));
  const { latest, lastGood } = await checks;
  return KINDS.filter((k) => sources[k]).map((k) => restrictionView(
    k, latest.find((r) => r.kind === k) ?? null, lastGood.find((r) => r.kind === k) ?? null, sources[k]!, now));
}
