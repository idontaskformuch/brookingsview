/** Glasgow's front-page settings, in the gb folder because its wording is British English ("centres", "council"). Same shape as config/front-page.ts. */
import type { FrontPageConfig } from '../front-page';

export const GLASGOW_FRONT_PAGE: FrontPageConfig = {
  // Same thresholds as config/front-page.ts (HOLIDAY_WINDOW, BIG_WITHIN_DAYS, MIN_EVENTS); written out here, since that file imports this one.
  holiday: { daysBefore: 14, showOnDay: true, daysAfter: 0, leadWithinDays: 7 },
  alerts: { weatherEvents: [], metOfficeLevels: ['amber', 'red'], traffic: false }, // traffic never leads: no structured full-closure/fatality field in any source (see FrontPageAlertRules.traffic)
  meeting: { withinDays: 2, leadBodies: ['glasgow-city-council'] },
  big: { sports: [], withinDays: 3 },
  minEvents: 3,
  guides: [
    { title: 'Facilities and hours', url: '/facilities/', deck: 'Opening hours, addresses and phone numbers for libraries, leisure centres and council offices.' },
    { title: 'Council meetings and agendas', url: '/city-hall/', deck: 'Upcoming council and committee meetings, their agenda items and where to read the agendas.' },
    { title: 'Holiday hours and closures', url: '/holidays/', deck: 'Which places are closed or open on the next holiday, by place.' },
    { title: 'Events calendar', url: '/events/', deck: 'Everything listed in the coming weeks, by day.' },
  ],
};
