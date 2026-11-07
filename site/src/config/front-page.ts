/** Front-page lead selector settings per town (lib/front-page.ts). Per-city differences live here and nowhere else.
 *  `guides` are evergreen pages (the fallback lead rotates through them by day of year, and the guides block lists them); each url must be a
 *  page the town builds, which front-page.test.ts checks against src/pages. */
import { GLASGOW_FRONT_PAGE } from './gb/front-page-glasgow';

export interface FrontPageGuide { title: string; url: string; deck: string }

export interface FrontPageAlertRules {
  /** NWS event names (case-insensitive, exact) that count as severe. Watches, advisories, Freeze and Frost are deliberately absent. */
  weatherEvents: string[];
  /** Met Office warning levels that count as severe (UK towns; the NWS list is then empty). */
  metOfficeLevels: string[];
  /** Traffic counts only as a full closure of a motorway/arterial or a fatal crash, and only when this is true. It is false in every town
   *  (owner decision 2026-11-07): that needs a structured source field for a full closure / a fatality, and no traffic source has one today
   *  (traffic_incidents.severity 'closure' is a keyword match, which also catches lane closures). The loader maps no traffic alert either.
   *  Revisit if a source gains structured road-status fields. */
  traffic: boolean;
}

export interface FrontPageConfig {
  /** A holiday is a candidate from `daysBefore` days ahead, on the day itself when `showOnDay`, and `daysAfter` days past it (all in city time).
   *  It leads over the weekend only when it is at most `leadWithinDays` days away or falls inside the coming weekend; otherwise the weekend leads and it is secondary. */
  holiday: { daysBefore: number; showOnDay: boolean; daysAfter: number; leadWithinDays: number };
  /** Which alerts may take the lead slot. Anything not listed here is never a front-page alert. */
  alerts: FrontPageAlertRules;
  /** A meeting is a candidate when it starts within this many city-time days (today included). */
  meetingWithinDays: number;
  guides: FrontPageGuide[];
}

const HOLIDAY_WINDOW = { daysBefore: 7, showOnDay: true, daysAfter: 0, leadWithinDays: 3 } as const;

const US_SEVERE_WEATHER = [
  'Tornado Warning', 'Blizzard Warning', 'Winter Storm Warning', 'Flash Flood Warning', 'Severe Thunderstorm Warning',
  'Extreme Cold Warning', 'Excessive Heat Warning', 'Red Flag Warning',
];
const US_ALERTS: FrontPageAlertRules = { weatherEvents: US_SEVERE_WEATHER, metOfficeLevels: [], traffic: false };

const HOLIDAYS_GUIDE: FrontPageGuide = { title: 'Holiday hours and closures', url: '/holidays/', deck: 'Which places are closed or open on the next holiday, by place.' };
const FACILITIES_GUIDE: FrontPageGuide = { title: 'Facilities and hours', url: '/facilities/', deck: 'Hours, addresses and phone numbers for libraries, recreation centers and city offices.' };
const CITY_HALL_GUIDE: FrontPageGuide = { title: 'City hall meetings and agendas', url: '/city-hall/', deck: 'Upcoming meetings, their agenda items and where to read the agendas.' };
const EVENTS_GUIDE: FrontPageGuide = { title: 'Events calendar', url: '/events/', deck: 'Everything listed in the coming weeks, by day.' };
const TRAFFIC_GUIDE: FrontPageGuide = { title: 'Traffic and road closures', url: '/traffic/', deck: 'Incidents and closures reported on local roads right now.' };

export const FRONT_PAGE_BY_TOWN: Record<string, FrontPageConfig> = {
  broomfield_co: {
    holiday: { ...HOLIDAY_WINDOW }, alerts: US_ALERTS, meetingWithinDays: 2,
    guides: [FACILITIES_GUIDE, CITY_HALL_GUIDE, HOLIDAYS_GUIDE, TRAFFIC_GUIDE, EVENTS_GUIDE],
  },
  brookings_sd: {
    holiday: { ...HOLIDAY_WINDOW }, alerts: US_ALERTS, meetingWithinDays: 2,
    guides: [FACILITIES_GUIDE, CITY_HALL_GUIDE, HOLIDAYS_GUIDE, EVENTS_GUIDE],
  },
  moreno_valley_ca: {
    holiday: { ...HOLIDAY_WINDOW }, alerts: US_ALERTS, meetingWithinDays: 2,
    guides: [FACILITIES_GUIDE, CITY_HALL_GUIDE, HOLIDAYS_GUIDE, TRAFFIC_GUIDE, EVENTS_GUIDE],
  },
  glasgow: GLASGOW_FRONT_PAGE,
};
