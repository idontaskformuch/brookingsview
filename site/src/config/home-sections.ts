/** The front page as a hub (Fas 2, owner 2026-11-19): which section blocks each town shows and in which order. Per-town differences live here
 *  and nowhere else (standards.md). `upper` blocks run full width under the lead; `beside` blocks share the row with the rail (from 62rem);
 *  `lower` blocks run full width after it. A block without data is not shown (SectionBlock `min`). Guides list only pages the town builds
 *  (home-sections.test.ts checks them against src/pages and lib/sections.ts). */
import type { ImageCategory } from '../lib/images';

export type HomeBlockId = 'tonight_weekend' | 'sports' | 'cityhall' | 'guides' | 'places' | 'getting_around';

export interface HomeGuideCard {
  title: string;
  href: string;
  /** The line under the title. */
  meta: string;
  /** The category pool its image comes from (config/category-images.ts). */
  image: ImageCategory;
}

export interface HomeSections {
  upper: HomeBlockId[];
  beside: HomeBlockId[];
  lower: HomeBlockId[];
  guides: HomeGuideCard[];
}

const HOLIDAYS: HomeGuideCard = { title: 'Holiday hours and closures', href: '/holidays/', meta: 'What is open and closed on the next holiday', image: 'city_hall' };
const FREE: HomeGuideCard = { title: 'Free things to do', href: '/events/free/', meta: 'Free events in the coming days', image: 'events' };
const FACILITIES: HomeGuideCard = { title: 'Facilities and hours', href: '/facilities/', meta: 'Libraries, recreation centers and city offices', image: 'city_hall' };
const TRAFFIC: HomeGuideCard = { title: 'Traffic and road closures', href: '/traffic/', meta: 'Incidents and closures on local roads', image: 'traffic' };

export const HOME_SECTIONS_BY_TOWN: Record<string, HomeSections> = {
  // SDSU sports high (owner).
  brookings_sd: {
    upper: ['tonight_weekend'], beside: ['sports', 'cityhall'], lower: ['guides', 'places', 'getting_around'],
    guides: [
      HOLIDAYS, FREE,
      { title: 'Trash and recycling', href: '/trash-recycling/', meta: 'Your pickup day and what goes where', image: 'city_hall' },
      { title: 'Winter guide', href: '/winter-guide/', meta: 'Snow routes, parking and plowing', image: 'weather_alert' },
    ],
  },
  // Getting around high (owner).
  moreno_valley_ca: {
    upper: ['tonight_weekend'], beside: ['getting_around', 'cityhall', 'sports'], lower: ['guides', 'places'],
    guides: [HOLIDAYS, FREE, FACILITIES, TRAFFIC],
  },
  // /events/ is quiet in Broomfield (no city calendar feed), so no "free things" card.
  broomfield_co: {
    upper: ['tonight_weekend'], beside: ['cityhall', 'getting_around', 'sports'], lower: ['guides', 'places'],
    guides: [HOLIDAYS, FACILITIES, TRAFFIC],
  },
  glasgow: {
    upper: ['tonight_weekend'], beside: ['cityhall', 'sports'], lower: ['guides', 'places', 'getting_around'],
    guides: [HOLIDAYS, FREE, FACILITIES],
  },
};

export function homeSectionsFor(townId: string): HomeSections {
  const s = HOME_SECTIONS_BY_TOWN[townId];
  if (!s) throw new Error(`homeSectionsFor: no config/home-sections.ts entry for town "${townId}"`);
  return s;
}
