/** Thanksgiving 2026 facts per US town (model: lib/holiday-page.ts). Each row is a value plus the page it came from
 *  and the date it was read; a fact a town has not posted is `unconfirmed` and says where to check. Nothing is
 *  predicted or paraphrased from memory. Refresh every year (THANKSGIVING_PAGE_YEAR below, and data-updated.json).
 *
 *  Brookings and Moreno Valley: rewritten 2026-11-04 from the 2026-10-24 read (checkedOn stays 2026-10-24).
 *  Broomfield: read 2026-11-04. compass.broomfield.org is blocked by robots.txt, so it appears only in `linkOnly`.
 *
 *  Reread 2026-11-14 (owner B4, .claude/specs/thanksgiving-2026.md; copies in .claude/evidence/thanksgiving-2026-11/):
 *  cityofbrookings-sd.gov and broomfield.org refused in strict robots mode (an AI crawler named), so their rows keep the
 *  earlier read; brookingslibrary.org, moreno-valley.ca.us, moval.gov, riversidetransit.com and broomfieldfish.org read. */
import type { HolidayFact, HolidayEvent, HolidayPageData, Source } from '../../lib/holiday-page';
import { dataUpdatedOn } from './data-updated';
import { occurrenceDay } from '../../lib/holiday-calendar';
import { holidayPageDef } from './calendar';
import { upcomingHolidayShifts } from '../../lib/trash-schedule';

const THANKSGIVING_PAGE_YEAR = 2026;

const base = { holiday: 'thanksgiving', year: THANKSGIVING_PAGE_YEAR, locale: 'en-US' } as const;

/* ------------------------------------------------------------ Brookings */
const BK_COLLECTIONS: Source = { name: 'City of Brookings: Landfill and Collections Calendar', url: 'https://cityofbrookings-sd.gov/265/Landfill-and-Collections-Calendar' };
const BK_HOLIDAYS: Source = { name: 'City of Brookings: City Holidays', url: 'https://www.cityofbrookings-sd.gov/89/City-Holidays' };
const BK_LIBRARY: Source = { name: 'Brookings Public Library', url: 'https://www.brookingslibrary.org/' };
const BK_CHECKED = '2026-10-24';
const BK_RECHECKED = '2026-11-14';
// SDSU events calendar rows sdsu_events 21522/21523 (scraped 2026-10-23): "McCrory Gardens Closed - Thanksgiving Break", Nov 26 and 27.
const BK_MCCRORY: Source = { name: 'South Dakota State University: Events', url: 'https://www.sdstate.edu/events/2026/11/mccrory-gardens-closed-thanksgiving-break' };

/** What the Thursday-holiday rule moves for each side of town (lib/trash-schedule.ts upcomingHolidayShifts). */
export interface BrookingsTrashMoves { south: string[]; north: string[] }

/** The moves for Thanksgiving week of the page's year, from the city's Thursday-holiday rule (lib/trash-schedule.ts). */
export function computeBrookingsMoves(): BrookingsTrashMoves {
  const monday = occurrenceDay(holidayPageDef('thanksgiving')!, THANKSGIVING_PAGE_YEAR) - 3 * 86_400_000; // Thursday - 3 days
  const movesFor = (side: 'south' | 'north') =>
    upcomingHolidayShifts(monday, 6, side).find((h) => h.name === 'Thanksgiving Day')?.moves ?? [];
  return { south: movesFor('south'), north: movesFor('north') };
}

/** QA data.holiday-yard-waste: trash rows whose value, insight or meta says yard waste is picked up or moves while the computed
 *  moves for the week have no yard waste (its season is over). Empty = consistent. */
export function yardWasteClaimsWithoutMove(page: HolidayPageData, moves: BrookingsTrashMoves): string[] {
  if ([...moves.south, ...moves.north].some((m) => m.startsWith('Yard waste'))) return [];
  return page.facts.flatMap((f) => (f.section === 'trash' && f.status === 'confirmed'
    ? [f.value, f.insight, f.meta].filter((t): t is string => !!t && /yard waste/i.test(t) && /picked up|move/i.test(t)).map((t) => `${f.label}: "${t}"`)
    : []));
}

function brookingsFacts(moves: BrookingsTrashMoves): HolidayFact[] {
  const row = (label: string, m: string[]): HolidayFact => ({
    section: 'trash', status: 'confirmed', change: m.length > 0 ? 'changed' : 'open', label, value: m.length > 0 ? m.join('; ') : 'Nothing moves',
    source: BK_COLLECTIONS, checkedOn: BK_CHECKED,
  });
  return [
    row('Pickup changes, south of 8th St. S.', moves.south),
    row('Pickup changes, north of 8th St. S.', moves.north),
    {
      // Yard waste is left out: its season ends Nov 24 (row below), so nothing of it moves to Wed Nov 25 (owner 2026-11-15).
      section: 'trash', status: 'confirmed', change: 'changed', label: 'Holiday rule', value: 'Thanksgiving is a collection holiday: Thursday recycling is picked up Wednesday.',
      insight: 'Thursday recycling is picked up Wed Nov 25.',
      meta: 'Thursday recycling moves to Wed Nov 25',
      source: BK_COLLECTIONS, checkedOn: BK_CHECKED,
    },
    {
      section: 'trash', status: 'confirmed', change: 'changed', label: 'Yard waste season', value: 'Curbside yard waste collection ends for the season on Nov 24, 2026.',
      source: BK_COLLECTIONS, checkedOn: BK_CHECKED,
    },
    {
      // Only what the page says about the day itself (owner 2026-11-15): administrative offices closed on the holiday.
      section: 'closures', status: 'confirmed', change: 'closed', label: 'City offices',
      value: 'Closed Thu Nov 26.',
      meta: 'City offices closed Nov 26',
      closedOn: ['2026-11-26'],
      days: { '2026-11-26': 'closed' },
      source: BK_HOLIDAYS, checkedOn: BK_CHECKED,
    },
    {
      section: 'closures', status: 'confirmed', change: 'closed', label: 'Landfill',
      value: 'Closed all day Thu Nov 26. Sat Nov 28 is the last Saturday open for the season.',
      meta: 'Landfill closed Nov 26',
      days: { '2026-11-26': 'closed' },
      dayNote: 'Sat Nov 28 is the last Saturday open for the season.',
      source: BK_COLLECTIONS, checkedOn: BK_CHECKED,
    },
    {
      section: 'closures', status: 'confirmed', change: 'closed', label: 'McCrory Gardens',
      value: 'Closed Thu Nov 26 and Fri Nov 27.',
      // No meta: the description's 155 characters keep the recycling move instead.
      closedOn: ['2026-11-26', '2026-11-27'],
      days: { '2026-11-26': 'closed', '2026-11-27': 'closed' },
      source: BK_MCCRORY, checkedOn: '2026-10-23',
    },
    {
      section: 'hours', status: 'confirmed', label: 'Library (regular hours)',
      value: 'Mon–Thu 9:30 a.m.–8 p.m., Fri–Sat 9:30 a.m.–5:30 p.m., Sun 1–5 p.m.',
      source: BK_LIBRARY, checkedOn: BK_RECHECKED,
    },
    {
      section: 'closures', status: 'unconfirmed', label: 'Library on Thanksgiving', meta: 'Library',
      source: BK_LIBRARY, checkedOn: BK_RECHECKED,
      checkAt: { label: 'Brookings Public Library calendar', url: 'https://www.brookingslibrary.org/calendar.php', phone: '605-692-9407' },
    },
  ];
}

/* --------------------------------------------------------------- Moreno */
const MV_WASTE: Source = { name: 'City of Moreno Valley: Holiday schedule (waste)', url: 'https://www.moreno-valley.ca.us/resident_services/waste/trash-holiday.html' };
const MV_LANDFILL: Source = { name: 'City of Moreno Valley: Landfill and transfer stations', url: 'https://www.moreno-valley.ca.us/resident_services/waste/recycle-landfill.html' };
const MV_LIBRARY: Source = { name: 'Moreno Valley Public Library', url: 'https://moval.gov/mv-library/' };
const MV_LIBRARY_CALENDAR: Source = { name: 'Moreno Valley Public Library calendar', url: 'https://moval.gov/mv-library/' };
const MV_LIBRARY_CALENDAR_READ = '2026-10-03';
const MV_RECHECKED = '2026-11-14';
// RTA press release dated Nov 12, 2026 (linked from riversidetransit.com's front page "Latest News", read 2026-11-14).
const MV_RTA: Source = { name: 'Riverside Transit Agency: 2026-2027 Holiday Schedule', url: 'https://www.riversidetransit.com/index.php/news-a-publications/latest-news/1102-2026-2027-holiday-schedule' };

const MORENO_FACTS: HolidayFact[] = [
  {
    section: 'trash', status: 'confirmed', change: 'changed', label: 'Trash, green waste and recycling',
    insight: 'Trash pickup is one day late after Thanksgiving Day.',
    value: 'No collection on Thanksgiving Day. Pickups for the rest of that week run one day late.',
    clarify: "Thursday's pickup moves to Friday and Friday's to Saturday; Monday to Wednesday are unchanged.",
    meta: 'Trash pickup one day late after Nov 26',
    source: MV_WASTE, checkedOn: MV_RECHECKED,
  },
  {
    section: 'transit', status: 'confirmed', change: 'closed', label: 'RTA buses',
    value: 'No bus service Thu Nov 26. Buses run on a regular schedule Wed Nov 25 and Fri Nov 27.',
    clarify: 'The Customer Information Center, (951) 565-5002, is closed Thu Nov 26.',
    meta: 'No RTA buses Nov 26',
    source: MV_RTA, checkedOn: MV_RECHECKED,
  },
  // City offices row removed 2026-11-15 (owner): it linked to the city's front page, and the city hours page
  // (moval.gov/city_hall/city-hours.html, read 2026-11-15) names no holiday.
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
  // The library's own calendar (Tockify), events 304267 "LIBRARY CLOSED: Thanksgiving" and 304264 "Libraries Close Early at
  // 5PM", read 2026-10-03 (snapshot 7970): "locations are closed Thursday, November 26th, and Friday, November 27th" and
  // "close early at 5:00 pm, Wednesday, November 25th". Shown on the owner's word 2026-11-14 (no new fetch); the link is the
  // library's own page.
  {
    section: 'closures', status: 'confirmed', change: 'closed', label: 'Library (all locations)',
    value: 'Closed Thu Nov 26 and Fri Nov 27.',
    meta: 'Library closed Nov 26–27',
    closedOn: ['2026-11-26', '2026-11-27'],
    source: MV_LIBRARY_CALENDAR, checkedOn: MV_LIBRARY_CALENDAR_READ,
  },
  {
    section: 'closures', status: 'confirmed', change: 'changed', label: 'Library (all locations)',
    value: 'Closes at 5 p.m. Wed Nov 25.',
    source: MV_LIBRARY_CALENDAR, checkedOn: MV_LIBRARY_CALENDAR_READ,
  },
];

/* ------------------------------------------------------------ Broomfield */
const BF_CHECKED = '2026-11-04';
/** broomfieldfish.org reread 2026-11-14 (B4). The city closures come from its Nov 16 notice (BF_NOTICE below). */
const BF_FISH_CHECKED = '2026-11-14';
const BF_LIBRARY: Source = { name: 'City and County of Broomfield: Library', url: 'https://www.broomfield.org/276/Library-Home' };
const BF_REC: Source = { name: 'City and County of Broomfield: Recreation Facilities Hours', url: 'https://www.broomfield.org/1452/Recreation-Facilities-Hours' };
const BF_TREE_BRANCH: Source = { name: 'City and County of Broomfield: Tree Branch Recycling Program', url: 'https://broomfield.org/1031/Tree-Branch-Recycling-Program' };
const BF_FISH: Source = { name: 'Broomfield FISH', url: 'https://www.broomfieldfish.org/' };
// The city's "CCOB Closures and Adjusted Hours for Thanksgiving" notice, posted Nov 16 in its News Flash. broomfield.org is
// refused in strict robots mode, so the owner pasted the text on 2026-11-17 and gave its address the same day (not fetched).
const BF_NOTICE: Source = { name: 'City and County of Broomfield: CCOB Closures and Adjusted Hours for Thanksgiving', url: 'https://www.broomfield.org/CivicAlerts.aspx?AID=3155' };
const BF_NOTICE_READ = '2026-11-17';
const BF_RACE = 'https://runsignup.com/Race/CO/Broomfield/BroomfieldTurkeyDay';

const BROOMFIELD_FACTS: HolidayFact[] = [
  {
    section: 'closures', status: 'confirmed', change: 'closed', label: 'City offices',
    value: 'Closed Thu Nov 26 and Fri Nov 27: George Di Ciero City and County Building, Health and Human Services Building and Water Recovery Facility.',
    meta: 'City offices closed Nov 26–27',
    standing: 'George Di Ciero City and County Building, Health and Human Services Building and Water Recovery Facility.',
    days: { '2026-11-26': 'closed', '2026-11-27': 'closed' },
    dayNote: 'George Di Ciero City and County Building, Health and Human Services Building and Water Recovery Facility.',
    source: BF_NOTICE, checkedOn: BF_NOTICE_READ,
  },
  { section: 'closures', status: 'confirmed', change: 'closed', label: 'Combined Courts', value: 'Closed Thu Nov 26 and Fri Nov 27.', days: { '2026-11-26': 'closed', '2026-11-27': 'closed' }, source: BF_NOTICE, checkedOn: BF_NOTICE_READ },
  { section: 'closures', status: 'confirmed', change: 'closed', label: 'inventHQ', value: 'Closed Thu Nov 26 and Fri Nov 27.', days: { '2026-11-26': 'closed', '2026-11-27': 'closed' }, source: BF_NOTICE, checkedOn: BF_NOTICE_READ },
  {
    section: 'closures', status: 'confirmed', change: 'closed', label: 'Library',
    value: 'Open 9 a.m.–5 p.m. Wed Nov 25. Closed Thu Nov 26 and Fri Nov 27.',
    days: { '2026-11-25': '9 a.m.–5 p.m.', '2026-11-26': 'closed', '2026-11-27': 'closed' },
    source: BF_NOTICE, checkedOn: BF_NOTICE_READ,
  },
  {
    section: 'closures', status: 'confirmed', change: 'closed', label: 'Broomfield Community Center',
    value: 'Closed Thu Nov 26, open for 8 a.m. group fitness classes only. Open 8 a.m.–2 p.m. Fri Nov 27.',
    days: { '2026-11-26': '8 a.m. group fitness only', '2026-11-27': '8 a.m.–2 p.m.' }, area: 'rec',
    source: BF_NOTICE, checkedOn: BF_NOTICE_READ,
  },
  {
    section: 'closures', status: 'confirmed', change: 'closed', label: 'Paul Derda Recreation Center',
    value: 'Closed Thu Nov 26. Open 12–6:30 p.m. Fri Nov 27.',
    days: { '2026-11-26': 'closed', '2026-11-27': '12–6:30 p.m.' }, area: 'rec',
    source: BF_NOTICE, checkedOn: BF_NOTICE_READ,
  },
  {
    section: 'closures', status: 'confirmed', change: 'closed', label: 'Depot Museum',
    value: 'Closed Fri Nov 27.',
    closedOn: ['2026-11-27'],
    days: { '2026-11-27': 'closed' },
    source: BF_NOTICE, checkedOn: BF_NOTICE_READ,
  },
  {
    section: 'closures', status: 'confirmed', change: 'closed', label: 'RV Waste Disposal Station',
    value: 'Closed Thu Nov 26.',
    days: { '2026-11-26': 'closed' },
    source: BF_NOTICE, checkedOn: BF_NOTICE_READ,
  },
  {
    section: 'closures', status: 'confirmed', change: 'changed', label: 'Police Department Building and Detention Center',
    value: 'Operations run 24/7. On Nov 26 and 27 the front desk is not staffed; the vestibule phone connects to an officer 24/7.',
    past: 'Operations ran 24/7. On Nov 26 and 27 the front desk was not staffed; the vestibule phone connected to an officer 24/7.',
    standing: 'Operations run 24/7; the front desk is not staffed and the vestibule phone connects to an officer.',
    source: BF_NOTICE, checkedOn: BF_NOTICE_READ,
  },
  {
    // The city notice (2026-11-17) also says "Tree Branch Recycling Facility: Closed Nov. 28".
    section: 'closures', status: 'confirmed', change: 'closed', label: 'Tree Branch Recycle and RV Wastewater Disposal Facility',
    value: 'Closed Sat Nov 28. Regular hours Wed 1–5 p.m. and Sat 8 a.m.–5 p.m. at 2990 W 124th Ave.',
    meta: 'Tree Branch Recycle closed Nov 28',
    closedOn: ['2026-11-28'],
    days: { '2026-11-28': 'closed' },
    dayNote: 'Regular hours Wed 1–5 p.m. and Sat 8 a.m.–5 p.m. at 2990 W 124th Ave.',
    clarify: 'Call 303-464-5651 if unsure; it may also close when muddy or wet.',
    source: BF_TREE_BRANCH, checkedOn: BF_CHECKED,
  },
  {
    section: 'hours', status: 'confirmed', label: 'Library (regular hours)',
    value: 'Mon–Thu 9 a.m.–9 p.m., Fri–Sat 9 a.m.–5 p.m., Sun 1–5 p.m.',
    source: BF_LIBRARY, checkedOn: BF_CHECKED,
  },
  {
    section: 'hours', status: 'confirmed', label: 'Recreation centers (regular hours)',
    value: 'Broomfield Community Center: Mon–Thu 5 a.m.–10 p.m., Fri 5 a.m.–8 p.m., Sat 7 a.m.–8 p.m., Sun 8 a.m.–6 p.m. Paul Derda Recreation Center: same, except Fri 5 a.m.–6:30 p.m. The Bay Aquatic Park: open weather permitting.',
    clarify: 'All open hours are subject to change.',
    source: BF_REC, checkedOn: BF_CHECKED,
  },
  // Trash row removed 2026-11-15 (owner). RTD row removed the same day: rtd-denver.com/community/news (read 2026-11-15) has no
  // Thanksgiving notice and links no holiday-service page, and a general news page does not answer the question.
  {
    // FISH's page gives weekdays, not a year: "Thursday, November 26th", "Friday, November 27th", then Dec 24 (Thu),
    // Dec 25 (Fri) and Jan 1 (Fri) -- the 2026/27 calendar (read 2026-11-11).
    section: 'help', status: 'confirmed', change: 'closed', label: 'Broomfield FISH food bank',
    value: 'Closed Thu Nov 26 and Fri Nov 27.',
    meta: 'FISH food bank closed Nov 26–27',
    closedOn: ['2026-11-26', '2026-11-27'],
    days: { '2026-11-26': 'closed', '2026-11-27': 'closed' },
    clarify: 'Questions about access to food: 303-465-1600 or help@broomfieldfish.org.',
    source: BF_FISH, checkedOn: BF_FISH_CHECKED,
  },
  {
    section: 'hours', status: 'confirmed', label: 'Broomfield FISH marketplace (regular hours)',
    value: 'Mon 12–4:30 p.m., Tue 10 a.m.–3:30 p.m., Wed 1–6 p.m., Fri 12–4:30 p.m.; closed Thursdays. 6 Garden Center.',
    source: BF_FISH, checkedOn: BF_FISH_CHECKED,
  },
  {
    section: 'help', status: 'confirmed', label: 'Food drive at the Turkey Day race',
    value: 'Bring 5 items for Broomfield FISH on race day to be entered in a raffle.',
    source: { name: 'RunSignup: Broomfield Turkey Day 5K/10K', url: BF_RACE }, checkedOn: BF_CHECKED,
  },
  // "Free Thanksgiving meal" removed 2026-11-11 (owner): FISH's pages name no meal or distribution for Thanksgiving, and the
  // Salvation Army Broomfield Corps page (read once headless, owner yes) offers "Thanksgiving Meals for Seniors" at two
  // care centers, with no date and not open to the public.
];

const BROOMFIELD_EVENTS: HolidayEvent[] = [
  {
    status: 'confirmed',
    name: 'Broomfield Turkey Day 5K/10K',
    meta: 'Turkey Day 5K/10K Nov 26',
    date: '2026-11-26',
    startTime: '09:00',
    venue: { name: 'Broomfield County Commons', street: '13200 Sheridan Blvd', locality: 'Broomfield', region: 'CO', postalCode: '80020' },
    url: BF_RACE,
    details: [
      'The 5K and the 10K both start at 9:00 a.m.',
      '10K $54 ($44 ages 0–16). 5K $44 ($34 ages 0–16). Kids Fun Run (about ½ mile, untimed, ages 1–12) $22. Prices include fees.',
    ],
    source: { name: 'RunSignup: Broomfield Turkey Day 5K/10K', url: BF_RACE },
    checkedOn: BF_CHECKED,
  },
];

export const THANKSGIVING_TOWN_IDS = ['brookings_sd', 'moreno_valley_ca', 'broomfield_co'] as const;

/** Towns whose event calendars feed the Events group (lib/holiday-calendar-events.ts), each with the rows it leaves out:
 *  key (story slug) -> reason, shown in the build log. Brookings takes no part (owner 2026-11-14: no events section). */
export const THANKSGIVING_CALENDAR_EXCLUDES: Record<string, Record<string, string>> = {
  moreno_valley_ca: {
    'event-330656': 'raw_data has no description; not confirmed as an event (owner 2026-11-14)',
    'event-6228': 'library closure, not an event; see the Library on Thanksgiving row',
    'event-303372': 'library closure, not an event; see the Library on Thanksgiving row',
    'event-304267': 'library closure, not an event; see the Library on Thanksgiving row',
  },
  broomfield_co: {},
};

/** Page data for a town, or null where there is no Thanksgiving page. Brookings needs the computed pickup moves. */
export function buildThanksgivingPage(townId: string, brookingsMoves?: BrookingsTrashMoves): HolidayPageData | null {
  if (townId === 'brookings_sd' && !brookingsMoves) brookingsMoves = computeBrookingsMoves();
  const related = [
    { label: 'Forecast and weather alerts', href: '/weather/' },
    ...(townId === 'brookings_sd' ? [] : [{ label: 'Road incidents', href: '/traffic/' }]), // Brookings has no traffic source, so no /traffic/ page
    { label: 'All upcoming events', href: '/events/' },
    { label: 'Today in town', href: '/today/' },
  ];
  if (townId === 'brookings_sd') {
    if (!brookingsMoves) throw new Error('Brookings Thanksgiving page needs the computed pickup moves');
    return { ...base, townId, dataUpdatedOn: dataUpdatedOn('thanksgiving', townId), facts: brookingsFacts(brookingsMoves), events: [], linkOnly: [], related: [{ label: 'Trash, recycling and yard waste guide', href: '/trash-recycling/' }, ...related] };
  }
  if (townId === 'moreno_valley_ca') {
    return { ...base, townId, dataUpdatedOn: dataUpdatedOn('thanksgiving', townId), facts: MORENO_FACTS, events: [], linkOnly: [], related };
  }
  if (townId === 'broomfield_co') {
    return {
      ...base, townId, dataUpdatedOn: dataUpdatedOn('thanksgiving', townId), facts: BROOMFIELD_FACTS, events: BROOMFIELD_EVENTS, related,
      linkOnly: [{ label: 'Library events', linkText: 'Broomfield Library calendar', url: 'https://compass.broomfield.org/events/week' }],
    };
  }
  return null;
}
