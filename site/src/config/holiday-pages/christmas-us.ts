/** Christmas and New Year's 2026 per US town (owner 2026-11-18, .claude/specs/us-christmas-2026.md). Same model as
 *  thanksgiving.ts: each row is a value plus the page it came from and the date it was read; nothing is predicted or
 *  paraphrased from memory. Window Nov 28 – Jan 3 (calendar.ts usWindow, owner B1).
 *
 *  Sources: the owner's hand reads 2026-11-18 (cityofbrookings-sd.gov /89 and /265; both refuse us in strict robots mode),
 *  rows already in the database (sdsu_events, the Brookings library and Moreno Valley library calendars), and pages read
 *  2026-11-14 (riversidetransit.com, moreno-valley.ca.us, broomfieldfish.org). compass.broomfield.org disallows us in
 *  robots.txt (checked again 2026-11-18), so its "Closing" entries stay unconfirmed. Rereads ~Dec 1 (owner B5):
 *  brookingslibrary.org/calendar.php, moval.gov/mv-library, rtd-denver.com. */
import type { HolidayEvent, HolidayFact, HolidayPageData, Source } from '../../lib/holiday-page';
import { upcomingHolidayShifts } from '../../lib/trash-schedule';
import { TOWN_REGISTRY } from '../../lib/town-registry.mjs';
import { haversineMiles } from '../../lib/town-boundary';
import { dataUpdatedOn } from './data-updated';

const CHRISTMAS_US_YEAR = 2026;
const LABEL = "Christmas and New Year's";
const OWNER_READ = '2026-11-18';

/** Title topics (owner 2026-11-18): the big event first, only confirmed ones; length rule in lib/holiday-page.ts titleLengthVerdict. */
const TITLE_TOPICS: Record<string, HolidayPageData['titleTopics']> = {
  brookings_sd: [{ text: 'Festival of Lights', event: 'Festival of Lights Parade' }, { text: 'closures', closed: true }],
  moreno_valley_ca: [
    { text: 'Snow Day', event: 'Holiday Snow Day' }, { text: 'tree lighting', event: 'Holiday Tree Lighting Ceremony' },
    { text: 'closures', closed: true },
  ],
  broomfield_co: [
    { text: 'tree lighting', event: 'Holiday Tree Lighting Ceremony' }, { text: 'events', events: true }, { text: 'closures', closed: true },
  ],
};

const base = (townId: string) => ({
  holiday: 'christmas', year: CHRISTMAS_US_YEAR, locale: 'en-US' as const, townId, nearbySection: true as const,
  label: LABEL, h1: `${LABEL} in ${TOWN_REGISTRY[townId].cityName}`, titleLabel: 'Christmas', titleTopics: TITLE_TOPICS[townId],
  dataUpdatedOn: dataUpdatedOn('christmas', townId),
});

const related = (townId: string) => [
  ...(townId === 'brookings_sd' ? [{ label: 'Trash, recycling and yard waste guide', href: '/trash-recycling/' }] : []),
  { label: 'Forecast and weather alerts', href: '/weather/' },
  ...(townId === 'brookings_sd' ? [] : [{ label: 'Road incidents', href: '/traffic/' }]), // Brookings has no /traffic/ page
  { label: 'All upcoming events', href: '/events/' },
  { label: 'Today in town', href: '/today/' },
];

/* --------------------------------------------------------------- Nearby */
/** Coordinates cached here (owner NB2 2026-11-18): the town centres are site-config.ts townCenter (a test keeps them equal); the venues
 *  are one OpenStreetMap geocoder search each, made by hand 2026-11-18 and never at build time (.claude/evidence/us-christmas-2026-11/nom-*.json, OSM data (c) OpenStreetMap contributors). */
export const TOWN_CENTRE: Record<string, { lat: number; lon: number }> = {
  brookings_sd: { lat: 44.3114, lon: -96.7984 },
  moreno_valley_ca: { lat: 33.9425, lon: -117.2297 },
  broomfield_co: { lat: 39.9205, lon: -105.0866 },
};
export const NEARBY_VENUES = {
  missionInn: { lat: 33.9831026, lon: -117.372934 }, // "Mission Inn, 3649, Mission Inn Avenue, Downtown Riverside"
  fallsPark: { lat: 43.5602851, lon: -96.7221148 }, // "Falls Park, Sioux Falls"
  auraria: { lat: 39.7427179, lon: -105.006226 }, // "Auraria Higher Education Center, 1201, 5th Street, Auraria, Denver"
} as const;
const milesFrom = (townId: string, v: { lat: number; lon: number }) =>
  haversineMiles(TOWN_CENTRE[townId].lat, TOWN_CENTRE[townId].lon, v.lat, v.lon);

const RIVERSIDE_FOL = 'https://riversideca.gov/fol/';
const SF_WW = 'https://www.siouxfalls.gov/activities-recreation/events-venues/community-events-performances/winter-wonderland';
const VISIT_DENVER = 'https://visitdenver.com/articles/post/mile-high-holidays-brings-seasonal-cheer-for-the-whole-family/';
const NEARBY_READ = '2026-11-18';
const CHRISTKINDL = 'https://www.christkindlmarketdenver.com/';

/** Rows read 2026-11-18 on the organizer's or the city's own page (owner NB1, 2026-11-18). */
function nearbyEvents(townId: string): HolidayEvent[] {
  if (townId === 'moreno_valley_ca') {
    return [{
      // City of Riverside's own page: "Switch-on Ceremony: Saturday, November 21, 2026 | Duration: Sunday, November 22 - December 31, 2026",
      // "Closed Thanksgiving & Christmas Day"; ice rink "5:00 pm - 10:00 pm", "$20 per skater. Includes skate rental."
      status: 'confirmed', name: 'Mission Inn Hotel & Spa Festival of Lights', date: '2026-11-22', endDate: '2026-12-31',
      venue: { name: 'Downtown Riverside', locality: 'Riverside', region: 'CA' }, url: RIVERSIDE_FOL,
      nearby: { miles: milesFrom(townId, NEARBY_VENUES.missionInn) },
      details: ['Closed Thanksgiving and Christmas Day.', 'Ice rink at Mission Inn Ave. and Orange St., 5–10 p.m., $20 per skater including skate rental.'],
      source: { name: 'City of Riverside: Festival of Lights', url: RIVERSIDE_FOL }, checkedOn: NEARBY_READ,
    }];
  }
  if (townId === 'brookings_sd') {
    return [{
      // City of Sioux Falls' own page: "kicks off on Friday, November 20, at 5 p.m.", "daily from 5 p.m. to midnight, ending Sunday,
      // January 3, 2027", "There is no cost to visit Falls Park".
      status: 'confirmed', name: 'Winter Wonderland at The Falls', date: '2026-11-20', endDate: '2027-01-03',
      venue: { name: 'Falls Park', locality: 'Sioux Falls', region: 'SD' }, url: SF_WW,
      nearby: { miles: milesFrom(townId, NEARBY_VENUES.fallsPark) },
      details: ['Lights and holiday music daily 5 p.m.–midnight. Free.'],
      source: { name: 'City of Sioux Falls: Winter Wonderland', url: SF_WW }, checkedOn: NEARBY_READ,
    }];
  }
  if (townId === 'broomfield_co') {
    return [{
      // Visit Denver's own release (Nov 10, 2026), as the organizer: "Visit Denver is bringing back the Mile High Drone Shows",
      // "Nov. 20-Dec. 31, 2026, nightly at 7 p.m., Downtown Denver", "optimal viewing from Tivoli Quad at Auraria Campus".
      status: 'confirmed', name: 'Mile High Drone Shows', date: '2026-11-20', endDate: '2026-12-31',
      venue: { name: 'Downtown Denver (best seen from Tivoli Quad, Auraria Campus)', locality: 'Denver', region: 'CO' }, url: VISIT_DENVER,
      nearby: { miles: milesFrom(townId, NEARBY_VENUES.auraria) },
      details: ['Nightly at 7 p.m.'],
      source: { name: 'Visit Denver: Mile High Holidays', url: VISIT_DENVER }, checkedOn: NEARBY_READ,
    }, {
      // The market's own page (owner NB3, read once 2026-11-18): "November 20 to December 23, 2026", "Auraria Campus, Tivoli Quad 1000
      // Larimer St, Denver, CO 80204", "Monday - Thursday 1:00 pm - 9:00 pm", "Friday - Sunday & Last Week (Dec. 17 - 23 ) 11:00 am -
      // 9:00 pm", "Free and open to the public."
      status: 'confirmed', name: 'Denver Christkindlmarket', date: '2026-11-20', endDate: '2026-12-23',
      venue: { name: 'Tivoli Quad, Auraria Campus', street: '1000 Larimer St', locality: 'Denver', region: 'CO', postalCode: '80204' }, url: CHRISTKINDL,
      nearby: { miles: milesFrom(townId, NEARBY_VENUES.auraria) },
      details: ['Mon–Thu 1–9 p.m.; Fri–Sun and every day Dec 17–23, 11 a.m.–9 p.m. Free.'],
      source: { name: 'Denver Christkindlmarket', url: CHRISTKINDL }, checkedOn: NEARBY_READ,
    }];
  }
  return [];
}

/* ------------------------------------------------------------ Brookings */
const BK_COLLECTIONS: Source = { name: 'City of Brookings: Landfill and Collections Calendar', url: 'https://cityofbrookings-sd.gov/265/Landfill-and-Collections-Calendar' };
const BK_HOLIDAYS: Source = { name: 'City of Brookings: City Holidays', url: 'https://www.cityofbrookings-sd.gov/89/City-Holidays' };
const BK_LIBRARY: Source = { name: 'Brookings Public Library', url: 'https://www.brookingslibrary.org/' };
const BK_LIBRARY_CHECKED = '2026-11-14';
const SDSU = (url: string): Source => ({ name: 'South Dakota State University: Events', url });

/** The weeks of Christmas Day and New Year's Day, from the city's holiday rule (lib/trash-schedule.ts). Both are Fridays in
 *  2026/27: Friday recycling moves to Thursday, Thursday recycling to Wednesday; garbage (Mon/Tue) does not move. */
export function brookingsChristmasMoves(): { south: string[]; north: string[] } {
  const weeks = [{ label: 'Christmas week', monday: Date.UTC(2026, 11, 21) }, { label: "New Year's week", monday: Date.UTC(2026, 11, 28) }];
  const side = (s: 'south' | 'north') => weeks.flatMap((w) =>
    upcomingHolidayShifts(w.monday, 7, s).flatMap((h) => h.moves.map((m) => `${w.label}: ${m}`)));
  return { south: side('south'), north: side('north') };
}

function brookingsFacts(): HolidayFact[] {
  const moves = brookingsChristmasMoves();
  const row = (label: string, m: string[]): HolidayFact => ({
    section: 'trash', status: 'confirmed', change: m.length > 0 ? 'changed' : 'open', label, value: m.length > 0 ? m.join('; ') : 'Nothing moves',
    source: BK_COLLECTIONS, checkedOn: OWNER_READ,
  });
  return [
    row('Pickup changes, south of 8th St. S.', moves.south),
    row('Pickup changes, north of 8th St. S.', moves.north),
    {
      // The owner's read of /265 (2026-11-18): collection on Dec 25 and Jan 1 follows the alternate schedule.
      section: 'trash', status: 'confirmed', change: 'changed', label: 'Holiday rule',
      value: 'Christmas Day and New Year\'s Day are collection holidays: Friday recycling is picked up Thursday (Dec 24, Dec 31) and Thursday recycling Wednesday (Dec 23, Dec 30).',
      insight: 'Recycling is picked up a day early in Christmas and New Year\'s weeks.',
      meta: 'Recycling a day early Dec 23–24 and Dec 30–31',
      source: BK_COLLECTIONS, checkedOn: OWNER_READ,
    },
    {
      // Owner 2026-11-18: show the source's "in most cases", promise no more. Christmas Eve and New Year's Eve are not named.
      section: 'closures', status: 'confirmed', change: 'closed', label: 'City offices',
      value: 'In most cases closed Fri Dec 25 and Fri Jan 1.',
      meta: 'City offices closed Dec 25 and Jan 1',
      closedOn: ['2026-12-25', '2027-01-01'],
      // Day grid (owner 2026-11-21): the source's "in most cases" goes under the name, the cells cannot carry it.
      days: { '2026-12-25': 'closed', '2027-01-01': 'closed' },
      dayNote: 'Closed "in most cases", the city says.',
      source: BK_HOLIDAYS, checkedOn: OWNER_READ,
    },
    {
      section: 'closures', status: 'confirmed', change: 'closed', label: 'Landfill',
      value: 'Closed all day Fri Dec 25 and Fri Jan 1. Open Mon–Fri 7:30 a.m.–4:15 p.m.; closed Saturdays Dec 1–Mar 31.',
      meta: 'Landfill closed Dec 25 and Jan 1',
      closedOn: ['2026-12-25', '2027-01-01'],
      days: { '2026-12-25': 'closed', '2027-01-01': 'closed' },
      dayNote: 'Open Mon–Fri 7:30 a.m.–4:15 p.m.; closed Saturdays Dec 1–Mar 31.',
      source: BK_COLLECTIONS, checkedOn: OWNER_READ,
    },
    {
      // sdsu_events 23035 "McCrory Gardens Closed - Christmas Break" (Dec 24), 230 "- Christmas Day", 231 "- New Year's Day".
      section: 'closures', status: 'confirmed', change: 'closed', label: 'McCrory Gardens',
      value: 'Closed Thu Dec 24, Fri Dec 25 and Fri Jan 1.',
      closedOn: ['2026-12-24', '2026-12-25', '2027-01-01'],
      days: { '2026-12-24': 'closed', '2026-12-25': 'closed', '2027-01-01': 'closed' },
      source: SDSU('https://www.sdstate.edu/events/2026/12/mccrory-gardens-closed-christmas-day'), checkedOn: '2026-10-29',
    },
    {
      section: 'hours', status: 'confirmed', label: 'Library (regular hours)',
      value: 'Mon–Thu 9:30 a.m.–8 p.m., Fri–Sat 9:30 a.m.–5:30 p.m., Sun 1–5 p.m.',
      source: BK_LIBRARY, checkedOn: BK_LIBRARY_CHECKED,
    },
    {
      section: 'closures', status: 'unconfirmed', label: "Library on Christmas and New Year's Day", meta: 'Library',
      source: BK_LIBRARY, checkedOn: BK_LIBRARY_CHECKED,
      checkAt: { label: 'Brookings Public Library calendar', url: 'https://www.brookingslibrary.org/calendar.php', phone: '605-692-9407' },
    },
  ];
}

const OSCAR_LARSON = { name: 'The Oscar Larson Performing Arts Center', locality: 'Brookings' };
const MCCRORY = { name: 'McCrory Gardens Education and Visitor Center', locality: 'Brookings' };

/** One event per sdsu_events row (id in the comment); the all-day 08:00–22:00 duplicates (21047, 21048, 22642) are left out,
 *  and so is 24703 "AHPS Holiday Reception" (owner B4). Times are local (America/Chicago). */
function sdsuEvent(id: number, name: string, date: string, startTime: string, endTime: string, venue: typeof OSCAR_LARSON, url: string, checkedOn: string): HolidayEvent {
  void id;
  return { status: 'confirmed', name, date, startTime, endTime, venue, url, source: SDSU(url), checkedOn };
}

const SDSU_EV = 'https://www.sdstate.edu/events/2026/12/';
const BROOKINGS_EVENTS: HolidayEvent[] = [
  sdsuEvent(20545, 'Riders in the Sky: Christmas the Cowboy Way', '2026-12-03', '19:30', '21:30', OSCAR_LARSON, `${SDSU_EV}riders-sky-christmas-cowboy-way`, '2026-10-19'),
  sdsuEvent(22939, 'A Christmas Celebration Dance Concert', '2026-12-04', '19:00', '21:00', OSCAR_LARSON, `${SDSU_EV}christmas-celebration-dance-concert`, '2026-10-28'),
  sdsuEvent(22940, 'A Christmas Celebration Dance Concert', '2026-12-05', '19:00', '21:00', OSCAR_LARSON, `${SDSU_EV}christmas-celebration-dance-concert`, '2026-10-28'),
  sdsuEvent(22941, 'A Christmas Celebration Dance Concert', '2026-12-06', '14:00', '16:00', OSCAR_LARSON, `${SDSU_EV}christmas-celebration-dance-concert`, '2026-10-28'),
  sdsuEvent(25847, 'Santa Visits McCrory Gardens', '2026-12-06', '13:00', '16:00', MCCRORY, `${SDSU_EV}santa-visits-mccrory-gardens`, '2026-11-13'),
  {
    // events 323902 and 323903 (brookingslibrary.libcal.com), two sessions the same day; local America/Chicago.
    status: 'confirmed', name: 'Merry & Bright Ornament Workshop', date: '2026-12-10', startTime: '13:00', endTime: '14:30',
    venue: { name: 'Brookings Public Library', locality: 'Brookings' }, url: 'https://brookingslibrary.libcal.com/event/17926364',
    source: { name: 'Brookings Public Library: Events', url: 'https://brookingslibrary.libcal.com/event/17926364' }, checkedOn: '2026-10-29',
  },
  {
    status: 'confirmed', name: 'Merry & Bright Ornament Workshop', date: '2026-12-10', startTime: '17:30', endTime: '19:00',
    venue: { name: 'Brookings Public Library', locality: 'Brookings' }, url: 'https://brookingslibrary.libcal.com/event/17926377',
    source: { name: 'Brookings Public Library: Events', url: 'https://brookingslibrary.libcal.com/event/17926377' }, checkedOn: '2026-10-29',
  },
  sdsuEvent(24736, 'Delaney Christmas 2026', '2026-12-11', '18:30', '21:00', OSCAR_LARSON, `${SDSU_EV}delaney-christmas-2026`, '2026-11-07'),
  sdsuEvent(24063, 'Holiday Market at the Ag Heritage Museum', '2026-12-12', '09:00', '13:00', { name: 'South Dakota Agricultural Heritage Museum', locality: 'Brookings' }, `${SDSU_EV}holiday-market-ag-heritage-museum`, '2026-11-03'),
  sdsuEvent(25878, 'Santa Visits McCrory Gardens', '2026-12-13', '13:00', '16:00', MCCRORY, `${SDSU_EV}santa-visits-mccrory-gardens`, '2026-11-13'),
  sdsuEvent(25097, 'Madison Avenue Dance Christmas Showcase', '2026-12-13', '16:00', '17:30', OSCAR_LARSON, `${SDSU_EV}madison-avenue-dance-christmas-showcase`, '2026-11-09'),
  sdsuEvent(25098, 'Madison Avenue Dance Christmas Showcase', '2026-12-13', '18:00', '19:30', OSCAR_LARSON, `${SDSU_EV}madison-avenue-dance-christmas-showcase`, '2026-11-09'),
  sdsuEvent(25280, 'Brookings High School Holiday Choir Concert', '2026-12-17', '18:00', '19:00', OSCAR_LARSON, `${SDSU_EV}brookings-high-school-holiday-choir-concert`, '2026-11-10'),
  sdsuEvent(25806, 'Brookings High School Holiday Choir Concert', '2026-12-17', '19:30', '20:30', OSCAR_LARSON, `${SDSU_EV}brookings-high-school-holiday-choir-concert`, '2026-11-13'),
  sdsuEvent(25886, 'Santa Visits McCrory Gardens', '2026-12-20', '17:00', '20:00', MCCRORY, `${SDSU_EV}santa-visits-mccrory-gardens`, '2026-11-13'),
  sdsuEvent(25888, 'Santa Visits McCrory Gardens', '2026-12-21', '17:00', '20:00', MCCRORY, `${SDSU_EV}santa-visits-mccrory-gardens`, '2026-11-13'),
];

// Downtown Brookings' own page, read 2026-11-18 under the one robots mode (owner 2026-11-18): "December 4, 2026", "Pre-parade
// activities begin as early as 4:00 PM and the parade kicks-off at 7:00 PM", "Mayor's Holiday Tree Lighting at 6 p.m. outside the
// Brookings Activity Center". The Children's Museum pre-parade party: visitbrookingssd.com's page is the 2025 one and the chamber
// calendar has no 2026 entry, so only the line on this page ("Free evening of play ...", no time) is shown. Holiday Bazaar: not in the
// chamber calendar (REST search 2026-11-18), left out.
const DTB = 'https://www.downtownbrookings.com/festival-of-lights';
const DTB_SOURCE: Source = { name: 'Downtown Brookings: Festival of Lights', url: DTB };
const BROOKINGS_DOWNTOWN: HolidayEvent[] = [
  {
    status: 'confirmed', name: "Mayor's Holiday Tree Lighting", date: '2026-12-04', startTime: '18:00',
    venue: { name: 'Brookings Activity Center', locality: 'Brookings', region: 'SD' }, url: DTB,
    details: ['Hot chocolate from the Girl Scouts.'],
    source: DTB_SOURCE, checkedOn: OWNER_READ,
  },
  {
    status: 'confirmed', name: 'Festival of Lights Parade', meta: 'Festival of Lights parade Dec 4', date: '2026-12-04', startTime: '19:00',
    venue: { name: 'Downtown Brookings', locality: 'Brookings', region: 'SD' }, url: DTB,
    details: [
      'Pre-parade activities downtown from 4 p.m., including two of Santa\'s reindeer outside the Children\'s Museum 5–7 p.m. and a free evening of play at the Children\'s Museum of South Dakota.',
      'KCountry 102.3 plays Christmas music 6:30–8 p.m.',
    ],
    source: DTB_SOURCE, checkedOn: OWNER_READ,
  },
];

/* --------------------------------------------------------------- Moreno */
const MV_WASTE: Source = { name: 'City of Moreno Valley: Holiday schedule (waste)', url: 'https://www.moreno-valley.ca.us/resident_services/waste/trash-holiday.html' };
const MV_LANDFILL: Source = { name: 'City of Moreno Valley: Landfill and transfer stations', url: 'https://www.moreno-valley.ca.us/resident_services/waste/recycle-landfill.html' };
const MV_LIBRARY: Source = { name: 'Moreno Valley Public Library', url: 'https://moval.gov/mv-library/' };
const MV_LIBRARY_CALENDAR: Source = { name: 'Moreno Valley Public Library calendar', url: 'https://moval.gov/mv-library/' };
const MV_LIBRARY_CALENDAR_READ = '2026-10-03';
const MV_RECHECKED = '2026-11-14';
const MV_RTA: Source = { name: 'Riverside Transit Agency: 2026-2027 Holiday Schedule', url: 'https://www.riversidetransit.com/index.php/news-a-publications/latest-news/1102-2026-2027-holiday-schedule' };

const MORENO_FACTS: HolidayFact[] = [
  {
    section: 'trash', status: 'confirmed', change: 'changed', label: 'Trash, green waste and recycling',
    value: "No collection on Christmas Day (Fri Dec 25) or New Year's Day (Fri Jan 1). Friday pickups those weeks run one day late, on Sat Dec 26 and Sat Jan 2.",
    insight: 'Friday trash pickup moves to Saturday after Christmas Day and New Year\'s Day.',
    meta: 'Friday trash pickup on Sat Dec 26 and Jan 2',
    source: MV_WASTE, checkedOn: MV_RECHECKED,
  },
  {
    section: 'transit', status: 'confirmed', change: 'closed', label: 'RTA buses',
    value: 'No bus service Fri Dec 25 and Fri Jan 1. Regular schedule Thu Dec 24 and Thu Dec 31, with free rides after 2:30 p.m. on Dec 31. Weekend schedule Sat Dec 26 and Sat Jan 2.',
    clarify: 'The Customer Information Center, (951) 565-5002, is closed Dec 25 and Jan 1.',
    meta: 'No RTA buses Dec 25 and Jan 1',
    closedOn: ['2026-12-25', '2027-01-01'],
    source: MV_RTA, checkedOn: MV_RECHECKED,
  },
  {
    // Library calendar (Tockify) rows 303459/304354 (Dec 24-25) and 303461/304356 (Jan 1), read 2026-10-02/03: "The Moreno Valley
    // Public Library locations are closed Thursday, December 24, and Friday, December 25" and "The Moreno Valley Public Libraries are
    // closed Friday, January 1st" (categories Main-Library, Mall-Branch, Iris-Plaza-Branch). Owner B3 2026-11-18: all locations.
    section: 'closures', status: 'confirmed', change: 'closed', label: 'Library (all locations)',
    value: 'Closed Thu Dec 24, Fri Dec 25 and Fri Jan 1.',
    meta: 'Library closed Dec 24–25 and Jan 1',
    closedOn: ['2026-12-24', '2026-12-25', '2027-01-01'],
    source: MV_LIBRARY_CALENDAR, checkedOn: MV_LIBRARY_CALENDAR_READ,
  },
  {
    section: 'closures', status: 'unconfirmed', label: 'Badlands Sanitary Landfill', meta: 'Landfill',
    clarify: 'Closed Sundays and holidays. Regular hours 6 a.m.–4:30 p.m. Mon–Sat.',
    source: MV_LANDFILL, checkedOn: MV_RECHECKED,
    checkAt: { label: 'Call the landfill', url: MV_LANDFILL.url, phone: '951-486-3200' },
  },
  {
    section: 'closures', status: 'unconfirmed', label: 'Waste Management Transfer Station',
    clarify: 'Closed holidays. Regular hours 7 a.m.–2 p.m. Mon–Fri and 7 a.m.–1 p.m. Sat.',
    source: MV_LANDFILL, checkedOn: MV_RECHECKED,
    checkAt: { label: 'Call the transfer station', url: MV_LANDFILL.url, phone: '800-774-0222' },
  },
  {
    section: 'hours', status: 'confirmed', label: 'Library (regular hours)',
    value: 'Main Library Mon–Thu 9 a.m.–8 p.m., Fri 9 a.m.–6 p.m., Sat 9 a.m.–5 p.m., Sun noon–5 p.m. MV Mall and Iris Plaza branches Mon–Fri 10 a.m.–8 p.m., Sat 10 a.m.–6 p.m.',
    source: MV_LIBRARY, checkedOn: MV_RECHECKED,
  },
];

// City pages read 2026-11-18 (robots allow; .claude/evidence/us-christmas-2026-11/): the tree lighting's own page (City Hall, ceremony
// 5:45 p.m.; the year from its ICS, UID winter-tree-lighting-2026, 5-8 p.m.) and the Snow Day page ("Saturday December 5, 2026").
const MV_TREE = 'https://moval.org/parks-comm-svc/event-treelighting.html';
const MV_SNOW = 'https://moval.org/parks-comm-svc/event-snowday.html';
const MV_EVENTS_READ = '2026-11-18';
const MORENO_EVENTS: HolidayEvent[] = [
  {
    status: 'confirmed', name: 'Holiday Snow Day', meta: 'Snow Day Dec 5', date: '2026-12-05', startTime: '10:00', endTime: '17:00',
    venue: { name: 'Civic Center Amphitheater', locality: 'Moreno Valley', region: 'CA' }, url: MV_SNOW,
    details: [
      'Snow play in 45-minute sessions by age (Tot Lot 5 and under, Sled Run 6–12), plus food vendors and a free carnival.',
      'Resident fee $6; a non-resident fee applies. Pre-registration runs to Dec 4 at 4:30 p.m.; remaining time slots are sold on the day.',
    ],
    source: { name: 'City of Moreno Valley: Holiday Snow Day', url: MV_SNOW }, checkedOn: MV_EVENTS_READ,
  },
  {
    status: 'confirmed', name: 'Holiday Tree Lighting Ceremony', meta: 'Tree lighting Dec 5', date: '2026-12-05', startTime: '17:00', endTime: '20:00',
    venue: { name: 'City Hall', locality: 'Moreno Valley', region: 'CA' }, url: MV_TREE,
    details: ['The ceremony starts at 5:45 p.m. Free, with entertainment, photos with Santa, hot cocoa and cookies.'],
    source: { name: 'City of Moreno Valley: Holiday Tree Lighting Ceremony', url: MV_TREE }, checkedOn: MV_EVENTS_READ,
  },
];

/* ------------------------------------------------------------ Broomfield */
const BF_FISH: Source = { name: 'Broomfield FISH', url: 'https://www.broomfieldfish.org/' };
const BF_FISH_CHECKED = '2026-11-14';
// The city's 2026 Holiday Calendar is linked from this page (owner 2026-11-18); the owner pastes it separately.
const BF_HOLIDAYS: Source = { name: 'City and County of Broomfield: Holiday Calendar', url: 'https://www.broomfield.org/3770' };

const BROOMFIELD_FACTS: HolidayFact[] = [
  {
    // compass.broomfield.org lists two all-day "Closing" entries in the week of Dec 20 (owner 2026-11-18); its robots.txt
    // disallows us, so the dates are not read. Until the Holiday Calendar is in: no "N places closed" count (holdsCount).
    section: 'closures', status: 'unconfirmed', label: 'City and County closed for the holiday (dates pending)', meta: 'City offices',
    holdsCount: true,
    source: BF_HOLIDAYS, checkedOn: OWNER_READ,
    checkAt: { label: 'City and County of Broomfield: Holiday Calendar', url: BF_HOLIDAYS.url },
  },
  {
    // FISH's page lists "Thursday, December 24th", "Friday, December 25th" and "Friday, January 1st" (read 2026-11-14).
    section: 'help', status: 'confirmed', change: 'closed', label: 'Broomfield FISH food bank',
    value: 'Closed Thu Dec 24, Fri Dec 25 and Fri Jan 1.',
    meta: 'FISH food bank closed Dec 24–25 and Jan 1',
    closedOn: ['2026-12-24', '2026-12-25', '2027-01-01'],
    days: { '2026-12-24': 'closed', '2026-12-25': 'closed', '2027-01-01': 'closed' },
    clarify: 'Questions about access to food: 303-465-1600 or help@broomfieldfish.org.',
    source: BF_FISH, checkedOn: BF_FISH_CHECKED,
  },
  {
    section: 'hours', status: 'confirmed', label: 'Broomfield FISH marketplace (regular hours)',
    value: 'Mon 12–4:30 p.m., Tue 10 a.m.–3:30 p.m., Wed 1–6 p.m., Fri 12–4:30 p.m.; closed Thursdays. 6 Garden Center.',
    source: BF_FISH, checkedOn: BF_FISH_CHECKED,
  },
];

// Organizer pages read 2026-11-18: 1940sball.org (/winter-ball/ "December 5th 2026", /winter-ball-location-parking/ the venue,
// /winter-ball-schedule/ the times) and Stride & Strategy's RunSignup page (date and route; it gives two different street numbers
// for the bakery, so none is shown, and no start time).
const BF_BALL = 'https://1940sball.org/winter-ball/';
const BF_SWEATER = 'https://runsignup.com/Race/Alpha5KChallenge/Page/Special-Edition';
const BROOMFIELD_MORE_EVENTS: HolidayEvent[] = [
  {
    status: 'confirmed', name: 'Le Ugly Sweater Run à LaBelle French Bakery', date: '2026-12-05',
    venue: { name: 'LaBelle French Bakery', locality: 'Broomfield', region: 'CO' }, url: BF_SWEATER,
    details: ['Free 2.8-mile run on the Lake Link Trail and Ridgeview Open Space, hosted by Stride & Strategy, finishing at the bakery.'],
    source: { name: 'RunSignup: Le Ugly Sweater Run à LaBelle French Bakery', url: BF_SWEATER }, checkedOn: OWNER_READ,
  },
  {
    status: 'confirmed', name: '1940s Winter Ball with the Glenn Miller Orchestra', meta: '1940s Winter Ball Dec 5', date: '2026-12-05', startTime: '17:30', endTime: '23:00',
    venue: { name: 'Omni Interlocken', street: '500 Interlocken Blvd', locality: 'Broomfield', region: 'CO', postalCode: '80021' }, url: BF_BALL,
    details: ['VIP/Gold doors 5:30 p.m., general admission doors 7 p.m.', "The Glenn Miller Orchestra's Holiday Spectacular plays 8–11 p.m."],
    source: { name: '1940s Ball: Winter Ball', url: BF_BALL }, checkedOn: OWNER_READ,
  },
];

/** Broomfield's Holiday Tree Lighting Ceremony (read 2026-11-04) is kept in christmas.ts CHRISTMAS_EVENTS. */
export function buildUsChristmasPage(townId: string, broomfieldEvents: HolidayEvent[]): HolidayPageData | null {
  if (townId === 'brookings_sd') {
    return { ...base(townId), facts: brookingsFacts(), events: [...BROOKINGS_EVENTS, ...BROOKINGS_DOWNTOWN, ...nearbyEvents(townId)], linkOnly: [], related: related(townId) };
  }
  if (townId === 'moreno_valley_ca') {
    return { ...base(townId), facts: MORENO_FACTS, events: [...MORENO_EVENTS, ...nearbyEvents(townId)], linkOnly: [], related: related(townId) };
  }
  if (townId === 'broomfield_co') {
    return {
      ...base(townId), facts: BROOMFIELD_FACTS, events: [...broomfieldEvents, ...BROOMFIELD_MORE_EVENTS, ...nearbyEvents(townId)], related: related(townId),
      linkOnly: [{ label: 'Library events', linkText: 'Broomfield Library calendar', url: 'https://compass.broomfield.org/events/week' }],
    };
  }
  return null;
}
