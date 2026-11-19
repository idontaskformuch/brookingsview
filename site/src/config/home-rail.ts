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
}

const SPEC_ORDER: RailModuleKind[] = ['meeting', 'holiday', 'sport', 'numbers', 'weather'];

export const HOME_RAIL_BY_TOWN: Record<string, RailConfig> = {
  brookings_sd: { modules: [...SPEC_ORDER, 'traffic', 'markets', 'play'], reserve: ['meetings_more'], adSlot: { afterModule: 2 } },
  moreno_valley_ca: { modules: [...SPEC_ORDER, 'traffic', 'burro_bonanza'], reserve: ['meetings_more'], adSlot: { afterModule: 2 } },
  broomfield_co: { modules: [...SPEC_ORDER, 'traffic', 'workplace'], reserve: ['meetings_more'], adSlot: { afterModule: 2 } },
  glasgow: { modules: [...SPEC_ORDER, 'traffic'], reserve: ['meetings_more'], adSlot: { afterModule: 2 } },
};

export function homeRailFor(townId: string): RailConfig {
  const c = HOME_RAIL_BY_TOWN[townId];
  if (!c) throw new Error(`homeRailFor: no config/home-rail.ts entry for town "${townId}"`);
  return c;
}
