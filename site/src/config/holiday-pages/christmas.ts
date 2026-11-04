/** Christmas 2026. `CHRISTMAS_EVENTS` are events saved ahead per town (Broomfield's tree lighting, not rendered: no
 *  US /christmas/ yet, owner 2026-11-04). `buildChristmasPage` is the page itself, Glasgow only (session 2, table
 *  approved 2026-11-04). Same model as thanksgiving.ts; nothing is predicted or paraphrased from memory.
 *
 *  Glasgow City Council (glasgow.gov.uk) answers automated clients with a Cloudflare challenge, so robots.txt is
 *  unreadable and none of its pages is fetched (CLAUDE.md #13). Its rows stay `unconfirmed` with a `checkAt`
 *  until the owner pastes the value, URL and date read by hand. First Bus also answers 403 (checkAt only);
 *  McGill's, Stagecoach and Citylink do too (link-only). Food-bank and free-meal findings are not rendered
 *  until the owner approves them. */
import type { HolidayEvent, HolidayPageData } from '../../lib/holiday-page';
import { buildGlasgowChristmasPage } from './gb/christmas-glasgow';

export const CHRISTMAS_EVENTS: Record<string, HolidayEvent[]> = {
  broomfield_co: [
    {
      status: 'confirmed',
      name: 'Holiday Tree Lighting Ceremony',
      date: '2026-12-04',
      startTime: '17:30',
      endTime: '20:00',
      venue: {
        name: 'George Di Ciero City and County Building',
        street: 'One Des Combes Drive',
        locality: 'Broomfield',
        region: 'CO',
      },
      url: 'https://broomfield.org/index.aspx?NID=2468',
      source: { name: 'City and County of Broomfield: Holiday Tree Lighting Ceremony', url: 'https://broomfield.org/index.aspx?NID=2468' },
      checkedOn: '2026-11-04',
      clarify: 'The page lists no cost.',
    },
  ],
};

export const CHRISTMAS_TOWN_IDS = ['glasgow'] as const;

/** The Christmas page, or null for a town without one (Broomfield's tree lighting stays saved, not rendered). */
export function buildChristmasPage(townId: string): HolidayPageData | null {
  return townId === 'glasgow' ? buildGlasgowChristmasPage() : null;
}
