/** What differs between the towns' front pages besides the lead selector (config/front-page.ts): extra rail widgets and the "More from"
 *  panels. Moved out of pages/index.astro's town branches (Fas 1a 2026-11-18, standards.md: no town code paths in layout code). */
export type HomeRailWidget = 'jackrabbits' | 'burro_bonanza';
export interface HomePanel { href: string; title: string; text: string }
export interface HomeLayout { railWidgets: HomeRailWidget[]; panels: HomePanel[] }

const CITY_HALL_US: HomePanel = { href: '/city-hall/', title: 'City hall', text: 'What the council, county commission and committees are deciding.' };
const CITY_HALL_GB: HomePanel = { href: '/city-hall/', title: 'City hall', text: 'What the council and committees are deciding.' };

export const HOME_LAYOUT_BY_TOWN: Record<string, HomeLayout> = {
  brookings_sd: {
    railWidgets: ['jackrabbits'],
    panels: [
      { href: '/university/', title: 'University', text: 'Games, concerts, shows and campus events at South Dakota State.' },
      { href: '/jackrabbits/', title: 'Jackrabbits', text: 'Full schedules and results for SDSU football, basketball and volleyball.' },
      CITY_HALL_US,
      { href: '/farm-report/', title: 'Farm report', text: 'Corn, soybean and cattle prices from USDA.' },
    ],
  },
  moreno_valley_ca: { railWidgets: ['burro_bonanza'], panels: [CITY_HALL_US] },
  broomfield_co: { railWidgets: [], panels: [CITY_HALL_US] },
  glasgow: { railWidgets: [], panels: [CITY_HALL_GB] },
};

export function homeLayoutFor(townId: string): HomeLayout {
  const l = HOME_LAYOUT_BY_TOWN[townId];
  if (!l) throw new Error(`homeLayoutFor: no config/home-layout.ts entry for town "${townId}"`);
  return l;
}
