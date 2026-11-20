/** The desktop rail (Fas 2, specs/full-pages-no-ai-prose.md): which modules each town's rail shows and in what order, plus a reserve order
 *  that only fills in when the shown modules would leave the rail shorter than the main column's first screen (lib/rail.ts planRail).
 *  A module with no data is hidden (planRail never sees it as available). Right Now (CityStatus) is not listed: on the front page it is
 *  its own grid item at the top of the rail column; on a holiday page the rail opens with it (RailModules `withStatus`).
 *  `adSlot`: where an ad would go once ads are switched on. AdSlot renders nothing until then (no reserved empty space). */
export type RailModuleKind =
  | 'meeting'        // the next meeting: organ, date, "in 5 days", agenda link
  | 'holiday'        // the next holiday page with its band photo as thumbnail and its insight lines
  | 'sport'          // the next game and the latest result, where the town has sports data
  | 'numbers'        // "<Town> in numbers" (Fas 4)
  | 'weather'        // three days of forecast (DayStrip)
  | 'traffic'        // active traffic incidents (TrafficWidget)
  | 'workplace'      // Workplace Watch hiring mover
  | 'markets'        // farm-report prices
  | 'play'           // the arcade-game promo card
  | 'burro_bonanza'  // the Burro Bonanza promo card
  | 'meetings_more'; // reserve: the meetings after the next one

export interface RailConfig {
  modules: RailModuleKind[];
  reserve: RailModuleKind[];
  adSlot?: { afterModule: number };
  /** "<Town> in numbers" (Fas 4): numbers shown without a line or insight line, whatever their coverage. */
  numbersNoTrend?: ('events' | 'closures' | 'jobs')[];
}

const SPEC_ORDER: RailModuleKind[] = ['meeting', 'holiday', 'sport', 'numbers', 'weather'];

export const HOME_RAIL_BY_TOWN: Record<string, RailConfig> = {
  brookings_sd: { modules: [...SPEC_ORDER, 'traffic', 'markets', 'play'], reserve: ['meetings_more'], adSlot: { afterModule: 2 } },
  // Owner D3 2026-11-19: Moreno Valley's closures get no line and no insight until the fall in its traffic rows (260 -> 50 a week,
  // Aug-Nov 2026) is explained; see the open point in specs/full-pages-no-ai-prose.md "Beslut 7".
  moreno_valley_ca: { modules: [...SPEC_ORDER, 'traffic', 'burro_bonanza'], reserve: ['meetings_more'], adSlot: { afterModule: 2 }, numbersNoTrend: ['closures'] },
  broomfield_co: { modules: [...SPEC_ORDER, 'traffic', 'workplace'], reserve: ['meetings_more'], adSlot: { afterModule: 2 } },
  glasgow: { modules: [...SPEC_ORDER, 'traffic'], reserve: ['meetings_more'], adSlot: { afterModule: 2 } },
};

export function homeRailFor(townId: string): RailConfig {
  const c = HOME_RAIL_BY_TOWN[townId];
  if (!c) throw new Error(`homeRailFor: no config/home-rail.ts entry for town "${townId}"`);
  return c;
}

/** Designsystem Fas 1 (owner 2026-11-20): every page has the same rail column, and each page picks its modules here. A page's list is
 *  intersected with the town's home rail (modules + reserve), so a town that has no such module (no sports data, no promo card) never
 *  gets it; towns differ only through HOME_RAIL_BY_TOWN, never here. No reserve fill and no ad slot outside the front page. A page
 *  that is not listed has no rail (its main column stays at --measure-main, same left edge). */
export type RailPage = 'today';
export interface PageRail { modules: RailModuleKind[]; /** Open the rail with Right Now (CityStatus). */ withStatus: boolean }
export const PAGE_RAIL: Record<RailPage, PageRail> = {
  // Today's main column already has its own Right now, weather today, meetings today, hours today, open tonight and traffic: the
  // rail adds what is next beyond today (the next game, the next holiday page) and the town's numbers. No second Right Now.
  today: { modules: ['sport', 'holiday', 'numbers'], withStatus: false },
};

export function pageRailFor(townId: string, page: RailPage): RailConfig {
  const home = homeRailFor(townId);
  const has = new Set<RailModuleKind>([...home.modules, ...home.reserve]);
  return { modules: PAGE_RAIL[page].modules.filter((m) => has.has(m)), reserve: [], numbersNoTrend: home.numbersNoTrend };
}
