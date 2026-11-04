/** Christmas-season events saved ahead of the /christmas/ page (not rendered yet, owner 2026-11-04). Same model as
 *  thanksgiving.ts; nothing here is predicted. */
import type { HolidayEvent } from '../../lib/holiday-page';

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
