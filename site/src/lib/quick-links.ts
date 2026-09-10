/**
 * "Looking for something?" front-page chip row (Handoff: "Front-page
 * orientation pass", Phase 2). Each town has an ORDERED candidate list;
 * an entry renders only if its own content check passes at build time,
 * a failing one is omitted with a build log line (never a dead link --
 * hard rule 4), and at most 7 render.
 *
 * Pure resolver (`resolveQuickLinks`) separate from the data-fetching
 * that builds its `QuickLinkContext` (done in index.astro, which already
 * fetches most of this) -- same split as orientation-header.ts, and for
 * the same reason: testable without a DB or an Astro render.
 */
import type { Town } from '../config/category-images';

export interface QuickLinkCandidate {
  label: string;
  route: string;
  /** Which context field this entry's availability depends on -- see
   *  QuickLinkContext. Not a closure (unlike EVENT_FACETS' `matches`)
   *  because the check here is a single pre-computed boolean per town
   *  build, not a per-item predicate run against a feed. */
  check: keyof QuickLinkContext;
}

export interface QuickLinkContext {
  hasToday: boolean;
  hasWeekend: boolean;
  hasFree: boolean;
  hasKids: boolean;
  hasLibrary: boolean;
  hasJackrabbits: boolean;
  hasMeetings: boolean;
  hasClosures: boolean;
  hasJobs: boolean;
  hasTraffic: boolean;
  hasWhatsOn: boolean;
  hasFacilities: boolean;
}

/** "Things to do" resolves to whichever of today/this-weekend actually
 *  has content -- see resolveQuickLinks(), this isn't a plain lookup.
 *  Marked with a synthetic check key so the candidate list stays
 *  declarative; resolveQuickLinks() special-cases it. */
const THINGS_TO_DO: QuickLinkCandidate = { label: 'Things to do', route: '/events/today/', check: 'hasToday' };

const CANDIDATES: Record<Town, QuickLinkCandidate[]> = {
  brookings_sd: [
    THINGS_TO_DO,
    { label: 'Free', route: '/events/free/', check: 'hasFree' },
    { label: 'Library', route: '/events/library/', check: 'hasLibrary' },
    { label: 'Jackrabbits', route: '/jackrabbits/', check: 'hasJackrabbits' },
    { label: 'City meetings', route: '/city-hall/', check: 'hasMeetings' },
    { label: 'Closures', route: '/closures/', check: 'hasClosures' },
    { label: 'Jobs', route: '/jobs/', check: 'hasJobs' },
  ],
  moreno_valley_ca: [
    THINGS_TO_DO,
    { label: 'Free', route: '/events/free/', check: 'hasFree' },
    { label: 'Kids & family', route: '/events/kids/', check: 'hasKids' },
    { label: 'Library', route: '/events/library/', check: 'hasLibrary' },
    { label: 'Traffic', route: '/traffic/', check: 'hasTraffic' },
    { label: 'Jobs', route: '/jobs/', check: 'hasJobs' },
    { label: 'City meetings', route: '/city-hall/', check: 'hasMeetings' },
  ],
  broomfield_co: [
    { label: "What's On", route: '/whats-on/', check: 'hasWhatsOn' },
    { label: 'Traffic', route: '/traffic/', check: 'hasTraffic' },
    { label: 'City meetings', route: '/city-hall/', check: 'hasMeetings' },
    { label: 'Facility hours', route: '/facilities/', check: 'hasFacilities' },
    { label: 'Closures', route: '/closures/', check: 'hasClosures' },
    { label: 'Jobs', route: '/jobs/', check: 'hasJobs' },
  ],
};

const MAX_QUICK_LINKS = 7;

export interface ResolvedQuickLinks {
  shown: { label: string; route: string }[];
  omitted: string[];
}

/** THINGS_TO_DO is the one candidate whose ROUTE depends on the check
 *  result, not just its visibility -- "the today/weekend event view"
 *  (Phase 2's own wording) means /events/today/ when today has content,
 *  /events/this-weekend/ when only the weekend does, omitted when
 *  neither does. Every other candidate's route is fixed. */
function resolveThingsToDo(ctx: QuickLinkContext): { label: string; route: string } | null {
  if (ctx.hasToday) return { label: 'Things to do', route: '/events/today/' };
  if (ctx.hasWeekend) return { label: 'Things to do', route: '/events/this-weekend/' };
  return null;
}

/** `town` is a plain string (matches siteConfig.townId's own type, same
 *  reason categoryImagesFor() does this -- see that function's own
 *  comment) -- an unrecognized town safely resolves to no candidates
 *  rather than a crash. */
export function resolveQuickLinks(town: string, ctx: QuickLinkContext): ResolvedQuickLinks {
  const shown: { label: string; route: string }[] = [];
  const omitted: string[] = [];

  for (const candidate of CANDIDATES[town as Town] ?? []) {
    if (shown.length >= MAX_QUICK_LINKS) break;
    if (candidate === THINGS_TO_DO) {
      const resolved = resolveThingsToDo(ctx);
      if (resolved) shown.push(resolved);
      else omitted.push(candidate.label);
      continue;
    }
    if (ctx[candidate.check]) shown.push({ label: candidate.label, route: candidate.route });
    else omitted.push(candidate.label);
  }

  return { shown, omitted };
}
