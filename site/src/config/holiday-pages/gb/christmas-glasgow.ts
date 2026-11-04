/** Glasgow /christmas/ data (British spelling, hence gb/). Rendered by components/HolidayPage.astro; see
 *  config/holiday-pages/christmas.ts for the sourcing rules (council behind Cloudflare, 403 hosts). */
import type { HolidayEvent, HolidayFact, HolidayPageData, Source } from '../../../lib/holiday-page';
import { CHRISTMAS_PAGE_YEAR } from '../../../lib/christmas';

const CHECKED = '2026-11-04';
const WW = 'https://www.glasgowswinterwonderland.com';
const WW_FAQ: Source = { name: "Glasgow's Winter Wonderland: FAQ", url: `${WW}/faq/` };
const WW_ENOCH: Source = { name: "Glasgow's Winter Wonderland: St Enoch Square", url: `${WW}/st-enoch/` };
const WW_GREEN: Source = { name: "Glasgow's Winter Wonderland: Glasgow Green", url: `${WW}/glasgow-green/` };
const GL_LIBRARIES: Source = { name: 'Glasgow Life: libraries and community venues festive opening hours', url: 'https://www.glasgowlife.org.uk/festive-opening-hours/libraries-and-community-venues-festive-opening-hours' };
const GL_SPORT: Source = { name: 'Glasgow Life: sport festive opening hours', url: 'https://www.glasgowlife.org.uk/festive-opening-hours/sport-festive-opening-hours' };
const GL_CHRISTMAS: Source = { name: 'Glasgow Life: Christmas in Glasgow', url: 'https://www.glasgowlife.org.uk/christmas-in-glasgow' };
const COUNCIL_HOURS: Source = { name: 'Glasgow City Council: Christmas and New Year opening times', url: 'https://www.glasgow.gov.uk/article/11458' };
const COUNCIL_SWF: Source = { name: 'Glasgow City Council: Scottish Welfare Fund', url: 'https://www.glasgow.gov.uk/article/992/Scottish-Welfare-Fund' };
const COUNCIL_RECYCLING: Source = { name: 'Glasgow City Council: household waste recycling centres', url: 'https://www.glasgow.gov.uk/article/1529/Household-Waste-Recycling-Centres' };
const COUNCIL_BINS: Source = { name: 'Glasgow City Council: bin collection days', url: 'https://www.glasgow.gov.uk/article/1524/Bin-Collection-Days' };
const COUNCIL_NEWS: Source = { name: 'Glasgow City Council: news', url: 'https://www.glasgow.gov.uk/Avenuesnews' };
const SCOTRAIL: Source = { name: 'ScotRail: Christmas and New Year train times', url: 'https://www.scotrail.co.uk/plan-your-journey/timetables/christmas-and-new-year-train-times' };
const SPT_TIMETABLES: Source = { name: 'SPT: Subway timetables', url: 'https://www.spt.co.uk/subway/subway-timetables/' };
const FIRST: Source = { name: 'First Bus Glasgow: festive service levels', url: 'https://www.firstbus.co.uk/greater-glasgow/plan-journey/festive-service-levels' };
const SAMARITANS: Source = { name: 'Samaritans: contact', url: 'https://www.samaritans.org/how-we-can-help/contact-samaritan/' };
const CITY_MISSION: Source = { name: 'Glasgow City Mission', url: 'https://www.glasgowcitymission.com/' };
const SOCIAL_BITE: Source = { name: 'Social Bite: Festival of Kindness', url: 'https://www.social-bite.co.uk/festival-of-kindness/' };
const FB_SW: Source = { name: 'Glasgow South West Foodbank: locations', url: 'https://glasgowsw.foodbank.org.uk/locations/' };
const FB_NE: Source = { name: 'Glasgow North East Foodbank: locations', url: 'https://glasgowne.foodbank.org.uk/locations/' };
const FB_NW: Source = { name: 'Glasgow North West Foodbank: locations', url: 'https://glasgownw.foodbank.org.uk/locations/' };
const FB_CLARIFY = 'Christmas hours not yet published; call before you go.';
const SHELTER: Source = { name: 'Shelter Scotland', url: 'https://scotland.shelter.org.uk/' };

/** Council office rows: read by the owner on glasgow.gov.uk 2026-11-04, all of it the 2025/26 festive period, so every
 *  row is unconfirmed for 2026 with last year's value (source: the council page). No 2026 weekdays are stated. */
function councilOfficeRows(): HolidayFact[] {
  const row = (label: string, value: string, source: Source = COUNCIL_HOURS): HolidayFact => ({
    section: 'closures', status: 'unconfirmed', label,
    lastYear: { value, source, season: '2025/26' },
    checkAt: { label: COUNCIL_HOURS.name, url: COUNCIL_HOURS.url },
    source: COUNCIL_HOURS, checkedOn: CHECKED,
  });
  return [
    row('Registrars', 'Closed 4pm Wed 24 Dec 2025, reopened Mon 29 Dec 2025 at 9am. Closed again 12.30pm Wed 31 Dec 2025, reopened Mon 5 Jan 2026 at 9am.'),
    row('Housing Benefit and Council Tax', 'Priority phone line closed 12pm Tue 23 Dec 2025, reopened Mon 5 Jan 2026 at 9am. Council Tax live chat closed 12pm Wed 24 Dec 2025.'),
    row('Scottish Welfare Fund, phone', 'Phone service closed 4pm Wed 24 Dec 2025, reopened Mon 5 Jan 2026.'),
    row('Scottish Welfare Fund, online', 'Online applications were open 24 hours a day.', COUNCIL_SWF),
    row('Social work offices', 'Open 8.45am–4.45pm Mon–Thu and 8.45am–3.55pm Fri. Closed 25 and 26 Dec 2025 and 1 and 2 Jan 2026, and from 12 noon on 31 Dec 2025 (Alcohol and Drug Recovery Services open until 5pm). Castlemilk (10 Ardencraig Place) and Mercat2 (35 Hecla Avenue) closed 4.45pm Wed 24 Dec 2025 and reopened 3 Jan 2026. Emergency Social Work Service 0300 343 1505. Homelessness out of hours 0800 838 502.'),
    row('Home care', 'Limited service on 25 and 26 Dec 2025, the afternoon of 31 Dec 2025, and 1 and 2 Jan 2026.'),
  ];
}

const GLASGOW_FACTS: HolidayFact[] = [
  /* closures */
  {
    section: 'closures', status: 'confirmed', label: 'Winter Wonderland, St Enoch Square',
    value: 'Thu 24 Dec 10am–8pm. Closed Fri 25 Dec. Sat 26 and Sun 27 Dec 12 noon–8pm.',
    metaGroup: 'Winter Wonderland', meta: 'closed 25 Dec',
    source: WW_FAQ, checkedOn: CHECKED,
  },
  {
    section: 'closures', status: 'confirmed', label: 'Winter Wonderland, Glasgow Green',
    value: 'Thu 24 Dec closes at 8pm. Closed Fri 25 Dec. Sat 26 Dec 12 noon–10pm.',
    source: WW_FAQ, checkedOn: CHECKED,
  },
  {
    section: 'closures', status: 'unconfirmed', label: 'Libraries (Glasgow Life)',
    lastYear: {
      value: 'Closed 25 and 26 Dec 2025. Most branches 10am–4pm on 24 Dec; hours varied by branch after that.',
      source: GL_LIBRARIES, season: '2025/26',
    },
    checkAt: { label: 'Glasgow Life festive opening hours', url: GL_LIBRARIES.url },
    source: GL_LIBRARIES, checkedOn: CHECKED,
  },
  {
    section: 'closures', status: 'unconfirmed', label: 'Sport and leisure centres (Glasgow Life)',
    lastYear: {
      value: 'Most venues closed 25 and 26 Dec 2025 and 1 and 2 Jan, reopening 3 Jan. Many had reduced hours on 24 Dec; a few closed longer.',
      source: GL_SPORT, season: '2025/26',
    },
    checkAt: { label: 'Glasgow Life sport festive opening hours', url: GL_SPORT.url },
    source: GL_SPORT, checkedOn: CHECKED,
  },
  ...councilOfficeRows(),
  {
    section: 'closures', status: 'unconfirmed', label: 'Recycling centres',
    clarify: 'Easter Queenslie HWRC closed from 20 Apr 2026 for redevelopment; reopening was expected late summer or early autumn 2026.',
    checkAt: { label: COUNCIL_RECYCLING.name, url: COUNCIL_RECYCLING.url },
    source: COUNCIL_RECYCLING, checkedOn: CHECKED,
  },
  /* trash */
  {
    section: 'trash', status: 'unconfirmed', label: 'Christmas and New Year collections', meta: 'bins',
    checkAt: { label: 'Enter your address to see your collection days', url: COUNCIL_BINS.url },
    source: COUNCIL_BINS, checkedOn: CHECKED,
  },
  /* transit */
  {
    section: 'transit', status: 'confirmed', label: 'ScotRail, Fri 25 Dec', value: 'No trains run on Christmas Day.',
    meta: 'No ScotRail trains 25 Dec',
    source: SCOTRAIL, checkedOn: CHECKED,
  },
  {
    section: 'transit', status: 'confirmed', label: 'ScotRail, Thu 24 Dec', value: 'The last trains leave earlier than normal.',
    source: SCOTRAIL, checkedOn: CHECKED,
  },
  {
    section: 'transit', status: 'unconfirmed', label: 'ScotRail timetable for 24 to 31 Dec',
    clarify: 'ScotRail says the full timetable will be published on that page.',
    checkAt: { label: SCOTRAIL.name, url: SCOTRAIL.url },
    source: SCOTRAIL, checkedOn: CHECKED,
  },
  {
    section: 'transit', status: 'unconfirmed', label: 'Glasgow Subway',
    checkAt: { label: SPT_TIMETABLES.name, url: SPT_TIMETABLES.url },
    source: SPT_TIMETABLES, checkedOn: CHECKED,
  },
  {
    section: 'transit', status: 'unconfirmed', label: 'First Bus Glasgow',
    checkAt: { label: FIRST.name, url: FIRST.url },
    source: FIRST, checkedOn: CHECKED,
  },
  /* help */
  {
    section: 'help', status: 'confirmed', label: 'Samaritans',
    value: 'Call 116 123, free, 24 hours a day, every day of the year.',
    source: SAMARITANS, checkedOn: CHECKED,
  },
  {
    section: 'help', status: 'unconfirmed', label: 'Glasgow South West Foodbank',
    usual: 'Ibrox Mon 12 noon–2pm; Penilee Tue 10:30am–12:30pm; Linthouse Tue 2–4pm; Priesthill Thu 10am–12 noon; Cardonald Fri 10am–12:45pm. You need a voucher.',
    clarify: FB_CLARIFY,
    checkAt: { label: FB_SW.name, url: FB_SW.url, phone: '07437 910115' },
    source: FB_SW, checkedOn: CHECKED,
  },
  {
    section: 'help', status: 'unconfirmed', label: 'Glasgow North East Foodbank',
    usual: 'Parkhead Mon 1–3pm, Wed 10:30am–12:30pm, Fri 1–3pm; Bridgeton Thu 10:45am–12:45pm; Shettleston Thu 1:30–3:30pm; Riddrie Wed 1:30–3:30pm; Easterhouse Thu 2–4pm; The Story Coffee (Bridgeton) Mon 5–6:30pm. You need a voucher.',
    clarify: FB_CLARIFY,
    checkAt: { label: FB_NE.name, url: FB_NE.url, phone: '07951 749373' },
    source: FB_NE, checkedOn: CHECKED,
  },
  {
    section: 'help', status: 'unconfirmed', label: 'Glasgow North West Foodbank',
    usual: 'Blawarthill Church (Scotstoun) Tue and Fri 12 noon–2pm; Victory Family Centre (Possilpark) Wed and Thu 12 noon–2pm. You need a voucher.',
    clarify: FB_CLARIFY,
    checkAt: { label: FB_NW.name, url: FB_NW.url, phone: '07735 522621' },
    source: FB_NW, checkedOn: CHECKED,
  },
  {
    section: 'help', status: 'unconfirmed', label: 'Glasgow City Mission',
    clarify: 'It runs a Winter Project; its site gives no dates or hours yet.',
    checkAt: { label: 'Glasgow City Mission: get help', url: 'https://www.glasgowcitymission.com/get-help/' },
    source: CITY_MISSION, checkedOn: CHECKED,
  },
  {
    section: 'help', status: 'unconfirmed', label: 'Social Bite Christmas dinner',
    clarify: 'Social Bite says its coffee shops open on Christmas Eve and Christmas Day every year; it gives no Glasgow details yet.',
    checkAt: { label: 'Social Bite Glasgow coffee shop', url: 'https://www.social-bite.co.uk/coffee-shops/glasgow/' },
    source: SOCIAL_BITE, checkedOn: CHECKED,
  },
  {
    section: 'help', status: 'unconfirmed', label: 'Shelter Scotland housing advice',
    checkAt: { label: 'Shelter Scotland: get help', url: 'https://scotland.shelter.org.uk/get_help' },
    source: SHELTER, checkedOn: CHECKED,
  },
  /* standing hours (rendered under More) */
  {
    section: 'hours', status: 'confirmed', label: 'Winter Wonderland, St Enoch Square (regular hours)',
    value: '6 to 20 Dec: Sun–Wed 12 noon–9pm, Thu–Fri 12 noon–10pm, Sat 10am–10pm. 21 to 23 Dec: 10am–10pm.',
    source: WW_FAQ, checkedOn: CHECKED,
  },
  {
    section: 'hours', status: 'confirmed', label: 'Winter Wonderland, Glasgow Green (regular hours)',
    value: '20 Nov to 20 Dec: Mon–Fri 3pm–10pm, Sat–Sun 12 noon–10pm. 21 Dec to 3 Jan: 12 noon–10pm daily. Fri 1 Jan 2pm–10pm.',
    source: WW_FAQ, checkedOn: CHECKED,
  },
  {
    section: 'hours', status: 'confirmed', label: 'Glasgow Subway (regular hours)',
    value: 'Mon–Sat 6:30am–11:40pm, Sun 10am–6:12pm.',
    source: SPT_TIMETABLES, checkedOn: CHECKED,
  },
];

const GLASGOW_EVENTS: HolidayEvent[] = [
  {
    status: 'confirmed', name: "Glasgow's Winter Wonderland, St Enoch Square",
    date: '2026-11-06', endDate: '2026-12-27', seasonJsonLd: true,
    venue: { name: 'St Enoch Square', locality: 'Glasgow' },
    url: WW_ENOCH.url, source: WW_ENOCH, checkedOn: CHECKED,
    metaGroup: 'Winter Wonderland', meta: 'St Enoch from 6 Nov',
    clarify: 'Hours change on 24 to 27 Dec (see Closures and changed hours); regular hours are under More.',
    details: [
      'Entry is free; you pay for the attractions, including the solar-powered observation wheel.',
      'The main entrance is from Argyle Street.',
    ],
  },
  {
    status: 'confirmed', name: "Glasgow's Winter Wonderland, Glasgow Green",
    date: '2026-11-20', endDate: '2027-01-03', seasonJsonLd: true,
    venue: { name: 'Glasgow Green', locality: 'Glasgow' },
    url: WW_GREEN.url, source: WW_GREEN, checkedOn: CHECKED,
    metaGroup: 'Winter Wonderland', meta: 'Glasgow Green from 20 Nov',
    clarify: 'Hours change on 24 to 26 Dec (see Closures and changed hours); regular hours are under More.',
    details: [
      'Entry is free; the ice rink, circus and Santa’s Grotto are ticketed.',
      'Santa’s Grotto runs to Thu 24 Dec: £16.75 per child plus fees. A Very Merry Circus: £12.50 plus fees.',
      'The entrance is at the McLennan Arch, next to the observation wheel.',
    ],
  },
  {
    status: 'confirmed', name: 'Hansel & Gretel (Hopscotch Theatre and Glasgow Life)',
    date: '2026-11-26', endDate: '2026-12-19',
    venue: { name: 'Community centres across Glasgow', locality: 'Glasgow' },
    url: 'https://www.glasgowlife.org.uk/event/1/hopscotch-theatre-and-glasgow-life-present-hansel-gretel',
    source: GL_CHRISTMAS, checkedOn: CHECKED,
    details: [
      'Pay what you can afford; suggested £3 for adults, £1 for children and concessions.',
      'Barlanark, Govan (Pearce Institute), Pollok, Barmulloch, Penilee, Knightswood and Castlemilk; dates and times are on the Glasgow Life page.',
    ],
  },
  {
    status: 'confirmed', name: 'Riverside Christmas Market',
    date: '2026-11-28', endDate: '2026-11-29',
    venue: { name: 'Riverside Museum', locality: 'Glasgow' },
    url: 'https://www.glasgowlife.org.uk/event/4/riverside-christmas-market',
    source: GL_CHRISTMAS, checkedOn: CHECKED,
    details: ['Sat 28 Nov 10am–4:30pm, Sun 29 Nov 11am–4:30pm. Free.'],
  },
  {
    status: 'confirmed', name: 'RSNO: Home Alone 2 in Concert',
    date: '2026-12-23', startTime: '14:30',
    venue: { name: 'Glasgow Royal Concert Hall', locality: 'Glasgow' },
    url: 'https://www.glasgowlife.org.uk/event/3/rsno-202627-home-alone-2-lost-in-new-york-in-concert',
    source: GL_CHRISTMAS, checkedOn: CHECKED,
    details: ['A second performance is at 7pm.', 'Tickets £22.50 to £73.50. Box office 0141 353 8000.'],
  },
  {
    status: 'confirmed', name: 'The McDougalls: Christmas in Toyland',
    date: '2026-12-24', startTime: '13:00',
    venue: { name: 'Glasgow Royal Concert Hall, New Auditorium', locality: 'Glasgow' },
    url: 'https://www.glasgowlife.org.uk/event/1/the-mcdougalls-christmas-in-toyland',
    source: GL_CHRISTMAS, checkedOn: CHECKED,
    details: ['A second performance is at 3pm.', 'Tickets £17.18 including the booking fee. Under 16s must be accompanied by an adult.'],
  },
  {
    status: 'unconfirmed', name: 'George Square: Good Times Christmas Village',
    clarify: 'The council announced it, but no dates or hours are published where we can read them.',
    checkAt: { label: COUNCIL_NEWS.name, url: COUNCIL_NEWS.url },
    source: COUNCIL_NEWS, checkedOn: CHECKED,
  },
];

/** The Glasgow page. */
export function buildGlasgowChristmasPage(): HolidayPageData {
  return {
    holiday: 'christmas', year: CHRISTMAS_PAGE_YEAR, locale: 'en-GB', townId: 'glasgow',
    facts: GLASGOW_FACTS,
    events: GLASGOW_EVENTS,
    linkOnly: [
      { group: 'Other bus and coach operators', label: "McGill's", linkText: 'mcgillsbuses.co.uk', url: 'https://www.mcgillsbuses.co.uk/' },
      { group: 'Other bus and coach operators', label: 'Stagecoach', linkText: 'stagecoachbus.com', url: 'https://www.stagecoachbus.com/' },
      { group: 'Other bus and coach operators', label: 'Citylink', linkText: 'citylink.co.uk', url: 'https://www.citylink.co.uk/' },
      { label: 'SEIN Glasgow', linkText: 'festive activities and support', url: 'https://seinglasgow.org.uk/news/festive-activities-and-support' },
    ],
    related: [{ label: 'All upcoming events in Glasgow', href: '/events/' }],
  };
}
