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
  | 'meetings_more'  // reserve: the meetings after the next one
  | 'weather_today'  // page rail only: today's high/low and condition, one line (RailWeatherToday)
  | 'open_now'       // page rail only: cafes open at this moment, picked in the browser from the OSM hours (RailOpenNow)
  | 'shows_weekend'  // page rail only: Ticketmaster shows this weekend, by the venue's own date (RailShowsWeekend)
  | 'closure_status'; // page rail only: the school-closure status in one line (RailClosureStatus), towns with Closure Watch

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
export type RailPage = 'today' | 'whats_on' | 'holiday' | 'closures';
export interface PageRail {
  modules: RailModuleKind[];
  /** Open the rail with Right Now (CityStatus). */
  withStatus: boolean;
  /** open_now: how many cafes at most. 8 where the rail's list is the page's only one (owner 2026-11-20), else 5. */
  openNowMax?: number;
  /** Modules shown only from the rail breakpoint (62rem, RailLayout), hidden in the one-column layout below it: a page lists the modules whose
   *  content the main column already has at the top on a phone. Owner 2026-11-21 (Closure Watch: the status is already the first thing on the page). */
  fromWide?: RailModuleKind[];
}
export const PAGE_RAIL: Record<RailPage, PageRail> = {
  // Owner 2026-11-20 (after the grid): the next game, the next holiday page, today's weather (high/low + condition) and open now. No
  // "<Town> in numbers" (counts without context, and a 0 is an empty state) and no second Right Now.
  // Owner 2026-11-20 (Glasgow cafes): Today's main column no longer lists cafes, so the rail's Open now is the only list: up to 8.
  today: { modules: ['sport', 'holiday', 'weather_today', 'open_now'], withStatus: false, openNowMax: 8 },
  // Owner 2026-11-20: the marquee is a full-width band above the grid; beside "Also on" the next holiday and the weekend's shows.
  whats_on: { modules: ['holiday', 'shows_weekend'], withStatus: false },
  // Owner 2026-11-20 (Tillägg B): a holiday page's rail holds only what belongs to the holiday: the next holiday page ("Coming up · in 6
  // days" with its photo); the page's own regular hours and food-help contact follow as HolidayRail (from the page data). No Right Now,
  // no "<Town> in numbers".
  holiday: { modules: ['holiday'], withStatus: false },
  // Fas 4 Closure Watch (owner spec 2026-11-20): the status also as a rail module, then today's weather (what a closure would follow from).
  // The status is the page's own first line, so the rail copy of it is not repeated below 62rem (owner 2026-11-21); Weather today stays on a phone.
  closures: { modules: ['closure_status', 'weather_today'], withStatus: false, fromWide: ['closure_status'] },
};
/** Modules only a page rail has (never on the front page): not intersected with the town's home rail. Each one still hides itself
 *  without data (no weather snapshot, no fresh OpenStreetMap hours). */
export const PAGE_ONLY_MODULES: ReadonlySet<RailModuleKind> = new Set<RailModuleKind>(['weather_today', 'open_now', 'shows_weekend', 'closure_status']);

export function pageRailFor(townId: string, page: RailPage): RailConfig {
  const home = homeRailFor(townId);
  const has = new Set<RailModuleKind>([...home.modules, ...home.reserve, ...PAGE_ONLY_MODULES]);
  return { modules: PAGE_RAIL[page].modules.filter((m) => has.has(m)), reserve: [], numbersNoTrend: home.numbersNoTrend };
}
