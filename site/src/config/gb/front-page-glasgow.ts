/** Glasgow's front-page settings, in the gb folder because its wording is British English ("centres", "council"). Same shape as config/front-page.ts. */
import type { FrontPageConfig } from '../front-page';

export const GLASGOW_FRONT_PAGE: FrontPageConfig = {
  holiday: { daysBefore: 7, showOnDay: true, daysAfter: 0, leadWithinDays: 3 },
  alerts: { weatherEvents: [], metOfficeLevels: ['amber', 'red'], traffic: true },
  meetingWithinDays: 2,
  guides: [
    { title: 'Facilities and hours', url: '/facilities/', deck: 'Opening hours, addresses and phone numbers for libraries, leisure centres and council offices.' },
    { title: 'Council meetings and agendas', url: '/city-hall/', deck: 'Upcoming council and committee meetings, their agenda items and where to read the agendas.' },
    { title: 'Holiday hours and closures', url: '/holidays/', deck: 'Which places are closed or open on the next holiday, by place.' },
    { title: 'Events calendar', url: '/events/', deck: 'Everything listed in the coming weeks, by day.' },
  ],
};
