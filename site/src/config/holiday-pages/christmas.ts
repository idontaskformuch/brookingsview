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

/** Glasgow's event calendars (Glasgow Life rows), its venue register (owner 2026-11-14, G7) and Ticketmaster (keys "tm:<id>", owner
 *  2026-11-15) take part in the Events group.
 *  Excluded by key, with the reason. The owner also excluded "Magic on Main Street Trail" and "Kids' Arts and Crafts Sessions"
 *  (Glasgow Life's winter page, not Christmas themed): neither is in the events table and neither title matches the pattern, so
 *  there is no key to list; add one here if the scraper ever stores them under a matching title. */
export const CHRISTMAS_CALENDAR_EXCLUDES: Record<string, Record<string, string>> = {
  glasgow: {
    // Ticketmaster rows (owner 2026-11-15).
    'tm:LvZ18Qng1UQXTa27BbRcF': 'RED, the universe.com duplicate of tm:1AUZkfgGkdqKIxW (owner 2026-11-15)',
    'tm:1kuOv0x_GAuOV5u': 'Muppet: the Glasgow Life row by hand is already on the page (owner 2026-11-15)',
    'tm:LvZ18QmN5TaNuM3aFzl_h': "King Tut's Golden Ticket: a festival pass, not an event (owner 2026-11-15)",
  },
};

/** Rows taken by key although their title does not match the pattern (owner 2026-11-14: "Elf Academy" by id, the pattern is not
 *  changed). */
export const CHRISTMAS_CALENDAR_INCLUDES: Record<string, Record<string, string>> = {
  glasgow: { 'event-325682': 'by id, owner 2026-11-14' },
};

/** The Christmas page, or null for a town without one (Broomfield's tree lighting stays saved, not rendered). */
export function buildChristmasPage(townId: string): HolidayPageData | null {
  return townId === 'glasgow' ? buildGlasgowChristmasPage() : null;
}
