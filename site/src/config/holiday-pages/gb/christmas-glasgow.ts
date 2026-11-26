/** Glasgow /christmas/ data (British spelling, hence gb/). Rendered by components/holiday/HolidayFestivePage.astro (HolidaySeasonPage until 2026-11-26) while the window is open
 *  (day-by-day, owner 2026-11-14, .claude/specs/glasgow-christmas-2026.md) and by components/HolidayPage.astro outside it; see
 *  config/holiday-pages/christmas.ts for the sourcing rules (council behind Cloudflare, 403 hosts).
 *
 *  2026-11-14 (owner): rows read again through scrapers/polite_fetch.py (evidence .claude/evidence/glasgow-christmas-2026-11/).
 *  A row about one place on several days is one row per distinct value, with `on` = its days. Rows whose answer is not out are
 *  plain links with no explanation; Glasgow Life's festive hours and the council's office hours are still the 2025/26 ones and are
 *  not shown as times at all, only linked; ScotRail shows what it confirms plus a link, SPT and First Bus are links only. Bank holidays come from GOV.UK. */
import type { HolidayEvent, HolidayFact, HolidayPageData, Source } from '../../../lib/holiday-page';
import { seasonDays, lastSeasonBankHoliday, type NamedDay } from '../../../lib/holiday-season';
import { dataUpdatedOn } from '../data-updated';
import { SCOTLAND_BANK_HOLIDAYS } from './bank-holidays';

const CHRISTMAS_PAGE_YEAR = 2026;

const CHECKED = '2026-11-04';
const READ = '2026-11-14';
const WW = 'https://www.glasgowswinterwonderland.com';
const WW_FAQ: Source = { name: "Glasgow's Winter Wonderland: FAQ", url: `${WW}/faq/` };
const WW_ENOCH: Source = { name: "Glasgow's Winter Wonderland: St Enoch Square", url: `${WW}/st-enoch/` };
const WW_GREEN: Source = { name: "Glasgow's Winter Wonderland: Glasgow Green", url: `${WW}/glasgow-green/` };
const GL_LIBRARIES: Source = { name: 'Glasgow Life: libraries and community venues festive opening hours', url: 'https://www.glasgowlife.org.uk/festive-opening-hours/libraries-and-community-venues-festive-opening-hours' };
const GL_SPORT: Source = { name: 'Glasgow Life: sport festive opening hours', url: 'https://www.glasgowlife.org.uk/festive-opening-hours/sport-festive-opening-hours' };
const GL_CHRISTMAS: Source = { name: 'Glasgow Life: Christmas in Glasgow', url: 'https://www.glasgowlife.org.uk/christmas-in-glasgow' };
const GL_EVENT = (name: string, path: string): Source => ({ name: `Glasgow Life: ${name}`, url: `https://www.glasgowlife.org.uk/event/${path}` });
const COUNCIL_HOURS: Source = { name: 'Glasgow City Council: Christmas and New Year opening times', url: 'https://www.glasgow.gov.uk/article/11458' };
const COUNCIL_SWF: Source = { name: 'Glasgow City Council: Scottish Welfare Fund', url: 'https://www.glasgow.gov.uk/article/992/Scottish-Welfare-Fund' };
const COUNCIL_RECYCLING: Source = { name: 'Glasgow City Council: household waste recycling centres', url: 'https://www.glasgow.gov.uk/article/1529/Household-Waste-Recycling-Centres' };
const COUNCIL_BINS: Source = { name: 'Glasgow City Council: bin collection days', url: 'https://www.glasgow.gov.uk/article/1524/Bin-Collection-Days' };
const COUNCIL_NEWS: Source = { name: 'Glasgow City Council: news', url: 'https://www.glasgow.gov.uk/Avenuesnews' };
const SCOTRAIL: Source = { name: 'ScotRail: Christmas and New Year train times', url: 'https://www.scotrail.co.uk/plan-your-journey/timetables/christmas-and-new-year-train-times' };
const SAMARITANS: Source = { name: 'Samaritans: contact', url: 'https://www.samaritans.org/how-we-can-help/contact-samaritan/' };
const CITY_MISSION: Source = { name: 'Glasgow City Mission', url: 'https://www.glasgowcitymission.com/' };
const SOCIAL_BITE: Source = { name: 'Social Bite: Festival of Kindness', url: 'https://www.social-bite.co.uk/festival-of-kindness/' };
const FB_SW: Source = { name: 'Glasgow South West Foodbank: locations', url: 'https://glasgowsw.foodbank.org.uk/locations/' };
const FB_NE: Source = { name: 'Glasgow North East Foodbank: locations', url: 'https://glasgowne.foodbank.org.uk/locations/' };
const FB_NW: Source = { name: 'Glasgow North West Foodbank: locations', url: 'https://glasgownw.foodbank.org.uk/locations/' };
const SHELTER: Source = { name: 'Shelter Scotland', url: 'https://scotland.shelter.org.uk/' };

/** Days without a bank holiday of their own that get a section (the rest come from GOV.UK). */
const NAMED_DAYS: NamedDay[] = [
  { mmdd: '12-24', name: 'Christmas Eve' },
  { mmdd: '12-31', name: 'Hogmanay', hero: true },
];
/** The second front-page post starts here (owner 2026-11-14) and runs to the season's last bank holiday. */
const HOGMANAY_POST_FROM = '12-27';

/** Council office rows: the owner read glasgow.gov.uk on 2026-11-04 and found only the 2025/26 festive period. Plain link rows
 *  with no times (owner 2026-11-14: no 2025/26 values on the page), like Glasgow Life's festive hours. */
function councilOfficeRows(): HolidayFact[] {
  const row = (label: string, at: Source = COUNCIL_HOURS): HolidayFact => ({
    section: 'closures', status: 'unconfirmed', label,
    checkAt: { label: at.name, url: at.url },
    source: COUNCIL_HOURS, checkedOn: CHECKED,
  });
  return [
    row('Registrars'),
    row('Housing Benefit and Council Tax'),
    row('Scottish Welfare Fund, phone'),
    row('Scottish Welfare Fund, online', COUNCIL_SWF),
    row('Social work offices'),
    row('Home care'),
  ];
}

const ENOCH = 'Winter Wonderland, St Enoch Square';
const GREEN = 'Winter Wonderland, Glasgow Green';

const GLASGOW_FACTS: HolidayFact[] = [
  /* closures and changed hours, per day (Winter Wonderland FAQ, read again 2026-11-14: same as 2026-11-04) */
  { section: 'closures', status: 'confirmed', change: 'changed', label: ENOCH, value: '10am–8pm', on: ['2026-12-24'], source: WW_FAQ, checkedOn: READ },
  {
    section: 'closures', status: 'confirmed', change: 'closed', label: ENOCH, dayShort: 'St Enoch', value: 'Closed', on: ['2026-12-25'], closedOn: ['2026-12-25'],
    metaGroup: 'Winter Wonderland', meta: 'closed 25 Dec', source: WW_FAQ, checkedOn: READ,
  },
  { section: 'closures', status: 'confirmed', change: 'changed', label: ENOCH, value: '12 noon–8pm', on: ['2026-12-26', '2026-12-27'], source: WW_FAQ, checkedOn: READ },
  { section: 'closures', status: 'confirmed', change: 'changed', label: GREEN, value: 'Closes at 8pm', on: ['2026-12-24'], source: WW_FAQ, checkedOn: READ },
  { section: 'closures', status: 'confirmed', change: 'closed', label: GREEN, dayShort: 'Glasgow Green', value: 'Closed', on: ['2026-12-25'], closedOn: ['2026-12-25'], source: WW_FAQ, checkedOn: READ },
  { section: 'closures', status: 'confirmed', change: 'open', label: GREEN, value: '12 noon–10pm', on: ['2026-12-26', '2026-12-28', '2026-12-31', '2027-01-02'], source: WW_FAQ, checkedOn: READ },
  { section: 'closures', status: 'confirmed', change: 'changed', label: GREEN, value: '2pm–10pm', on: ['2027-01-01'], source: WW_FAQ, checkedOn: READ },
  {
    section: 'closures', status: 'unconfirmed', label: 'Libraries and community venues: festive opening hours',
    checkAt: { label: 'Glasgow Life', url: GL_LIBRARIES.url }, source: GL_LIBRARIES, checkedOn: READ,
  },
  {
    section: 'closures', status: 'unconfirmed', label: 'Sport centres and pools: festive opening hours',
    checkAt: { label: 'Glasgow Life', url: GL_SPORT.url }, source: GL_SPORT, checkedOn: READ,
  },
  ...councilOfficeRows(),
  {
    section: 'closures', status: 'unconfirmed', label: 'Recycling centres',
    checkAt: { label: COUNCIL_RECYCLING.name, url: COUNCIL_RECYCLING.url },
    source: COUNCIL_RECYCLING, checkedOn: CHECKED,
  },
  /* trash */
  {
    section: 'trash', status: 'unconfirmed', label: 'Bin collection days', meta: 'bins',
    checkAt: { label: 'Enter your address to see your collection days', url: COUNCIL_BINS.url },
    source: COUNCIL_BINS, checkedOn: CHECKED,
  },
  /* transit: what ScotRail confirms (read 2026-11-14); its timetable, SPT and the bus operators are links (linkOnly) */
  { section: 'transit', status: 'confirmed', change: 'changed', label: 'ScotRail', value: 'Last trains leave earlier than normal', on: ['2026-12-24', '2026-12-31'], source: SCOTRAIL, checkedOn: READ },
  {
    section: 'transit', status: 'confirmed', change: 'closed', label: 'ScotRail', value: 'No trains', on: ['2026-12-25', '2027-01-01'],
    meta: 'No ScotRail trains 25 Dec or 1 Jan', source: SCOTRAIL, checkedOn: READ,
  },
  /* help */
  {
    section: 'help', status: 'confirmed', change: 'open', label: 'Samaritans',
    value: 'Call 116 123, free, 24 hours a day, every day of the year.',
    source: SAMARITANS, checkedOn: CHECKED,
  },
  {
    section: 'help', status: 'unconfirmed', label: 'Glasgow South West Foodbank',
    usual: 'Ibrox Mon 12 noon–2pm; Penilee Tue 10:30am–12:30pm; Linthouse Tue 2–4pm; Priesthill Thu 10am–12 noon; Cardonald Fri 10am–12:45pm. You need a voucher.',
    checkAt: { label: FB_SW.name, url: FB_SW.url, phone: '07437 910115' },
    source: FB_SW, checkedOn: CHECKED,
  },
  {
    section: 'help', status: 'unconfirmed', label: 'Glasgow North East Foodbank',
    usual: 'Parkhead Mon 1–3pm, Wed 10:30am–12:30pm, Fri 1–3pm; Bridgeton Thu 10:45am–12:45pm; Shettleston Thu 1:30–3:30pm; Riddrie Wed 1:30–3:30pm; Easterhouse Thu 2–4pm; The Story Coffee (Bridgeton) Mon 5–6:30pm. You need a voucher.',
    checkAt: { label: FB_NE.name, url: FB_NE.url, phone: '07951 749373' },
    source: FB_NE, checkedOn: CHECKED,
  },
  {
    section: 'help', status: 'unconfirmed', label: 'Glasgow North West Foodbank',
    usual: 'Blawarthill Church (Scotstoun) Tue and Fri 12 noon–2pm; Victory Family Centre (Possilpark) Wed and Thu 12 noon–2pm. You need a voucher.',
    checkAt: { label: FB_NW.name, url: FB_NW.url, phone: '07735 522621' },
    source: FB_NW, checkedOn: CHECKED,
  },
  {
    section: 'help', status: 'unconfirmed', label: 'Glasgow City Mission',
    checkAt: { label: 'Glasgow City Mission: get help', url: 'https://www.glasgowcitymission.com/get-help/' },
    source: CITY_MISSION, checkedOn: CHECKED,
  },
  {
    section: 'help', status: 'unconfirmed', label: 'Social Bite Christmas dinner',
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
    value: '6 November – 20 December: Sun–Wed 12 noon–9pm, Thu–Fri 12 noon–10pm, Sat 10am–10pm. 21 to 23 Dec: 10am–10pm.',
    source: WW_FAQ, checkedOn: READ,
  },
  {
    section: 'hours', status: 'confirmed', label: 'Winter Wonderland, Glasgow Green (regular hours)',
    value: '20 Nov to 20 Dec: Mon–Fri 3pm–10pm, Sat–Sun 12 noon–10pm. 21 Dec to 3 Jan: 12 noon–10pm daily. Fri 1 Jan 2pm–10pm.',
    source: WW_FAQ, checkedOn: READ,
  },
];

const MUPPET = GL_EVENT("Disney's The Muppet Christmas Carol in Concert", '1/disneys-the-muppet-christmas-carol-in-concert-live-to-film');
const SNOWMAN = GL_EVENT('RSNO Christmas Concert featuring The Snowman', '1/rsno-202627-christmas-concert-featuring-the-snowman-matinee');
const GRINCH = GL_EVENT('Meet the Grinch at Riverside Christmas Market', '1/meet-the-grinch-at-riverside-christmas-market');
const CRAFTS = GL_EVENT('Christmas Nature Crafts', '1/christmas-nature-crafts');
const DANCE = GL_EVENT('Dance into Christmas', '1/dance-into-christmas');

const GLASGOW_EVENTS: HolidayEvent[] = [
  {
    status: 'confirmed', name: "Glasgow's Winter Wonderland, St Enoch Square",
    date: '2026-11-06', endDate: '2026-12-27', seasonJsonLd: true,
    venue: { name: 'St Enoch Square', locality: 'Glasgow' },
    url: WW_ENOCH.url, source: WW_ENOCH, checkedOn: READ,
    metaGroup: 'Winter Wonderland', meta: 'St Enoch from 6 Nov',
    // the FAQ's St Enoch table (read 2026-11-14), the same hours as the regular-hours row and the per-day rows above
    openHours: [
      { from: '2026-11-06', to: '2026-12-20', days: [7, 1, 2, 3], open: '12:00', close: '21:00' },
      { from: '2026-11-06', to: '2026-12-20', days: [4, 5], open: '12:00', close: '22:00' },
      { from: '2026-11-06', to: '2026-12-20', days: [6], open: '10:00', close: '22:00' },
      { from: '2026-12-21', to: '2026-12-23', open: '10:00', close: '22:00' },
      { from: '2026-12-24', to: '2026-12-24', open: '10:00', close: '20:00' },
      { from: '2026-12-25', to: '2026-12-25', open: null },
      { from: '2026-12-26', to: '2026-12-27', open: '12:00', close: '20:00' },
    ],
    details: [
      'Entry is free; you pay for the attractions, including the solar-powered observation wheel.',
      'The main entrance is from Argyle Street.',
    ],
  },
  {
    status: 'confirmed', name: "Glasgow's Winter Wonderland, Glasgow Green",
    date: '2026-11-20', endDate: '2027-01-03', seasonJsonLd: true,
    venue: { name: 'Glasgow Green', locality: 'Glasgow' },
    url: WW_GREEN.url, source: WW_GREEN, checkedOn: READ,
    metaGroup: 'Winter Wonderland', meta: 'Glasgow Green from 20 Nov',
    // the FAQ's Glasgow Green table and notes (read 2026-11-14): closes 8pm on 24 Dec, closed 25 Dec, 2pm to 10pm on 1 Jan
    openHours: [
      { from: '2026-11-20', to: '2026-12-20', days: [1, 2, 3, 4, 5], open: '15:00', close: '22:00' },
      { from: '2026-11-20', to: '2026-12-20', days: [6, 7], open: '12:00', close: '22:00' },
      { from: '2026-12-21', to: '2027-01-03', open: '12:00', close: '22:00' },
      { from: '2026-12-24', to: '2026-12-24', open: '12:00', close: '20:00' },
      { from: '2026-12-25', to: '2026-12-25', open: null },
      { from: '2027-01-01', to: '2027-01-01', open: '14:00', close: '22:00' },
    ],
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
    status: 'confirmed', name: 'Meet the Grinch at Riverside Christmas Market',
    date: '2026-11-28', endDate: '2026-11-29', startTime: '12:30', endTime: '16:30',
    venue: { name: 'Riverside Museum', locality: 'Glasgow' },
    url: GRINCH.url, source: GRINCH, checkedOn: READ,
    details: ['Free, drop in. All ages.'],
  },
  {
    status: 'confirmed', name: "Disney's The Muppet Christmas Carol in Concert",
    date: '2026-12-02', startTime: '19:00',
    venue: { name: 'Glasgow Royal Concert Hall', locality: 'Glasgow' },
    url: MUPPET.url, source: MUPPET, checkedOn: READ,
    details: ['Tickets £37.90 to £77.10, including the booking fee. Under 16s must be accompanied by an adult.'],
  },
  {
    status: 'confirmed', name: 'Christmas Nature Crafts (RSPB)',
    date: '2026-12-05', endDate: '2026-12-06', startTime: '13:00', endTime: '16:00',
    venue: { name: 'Kelvingrove Art Gallery and Museum', locality: 'Glasgow' },
    url: CRAFTS.url, source: CRAFTS, checkedOn: READ,
    details: ['Free, drop in. Families.'],
  },
  {
    status: 'confirmed', name: 'Big Phat Brunch',
    date: '2026-12-06', startTime: '13:00', endTime: '17:00',
    venue: { name: 'Alpine Lodge Bar, Winter Wonderland on Glasgow Green', locality: 'Glasgow' },
    url: WW_FAQ.url, source: WW_FAQ, checkedOn: READ,
    details: ['Over 18s only. £15 per person plus booking and admin fee; the ticket does not include brunch.'],
  },
  {
    status: 'confirmed', name: 'Dance into Christmas',
    date: '2026-12-11', startTime: '12:30', endTime: '15:30',
    venue: { name: 'Glasgow Club Donald Dewar', locality: 'Glasgow' },
    url: DANCE.url, source: DANCE, checkedOn: READ,
    details: ['£6, or free with Glasgow Club membership; a light lunch and cakes are included. Adults.'],
  },
  {
    status: 'confirmed', name: 'RSNO Christmas Concert featuring The Snowman',
    date: '2026-12-19', startTime: '14:00',
    venue: { name: 'Glasgow Royal Concert Hall', locality: 'Glasgow' },
    url: SNOWMAN.url, source: SNOWMAN, checkedOn: READ,
    details: ['A second performance is at 6pm.', 'Tickets £21.50 to £53.50. Under 16s must be accompanied by an adult.'],
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
    checkAt: { label: COUNCIL_NEWS.name, url: COUNCIL_NEWS.url },
    source: COUNCIL_NEWS, checkedOn: CHECKED,
  },
];

/** The Glasgow page. */
export function buildGlasgowChristmasPage(): HolidayPageData {
  const days = seasonDays(SCOTLAND_BANK_HOLIDAYS, CHRISTMAS_PAGE_YEAR, NAMED_DAYS);
  const last = lastSeasonBankHoliday(SCOTLAND_BANK_HOLIDAYS, CHRISTMAS_PAGE_YEAR);
  const newYear = days.filter((d) => d.hero && d.date >= `${CHRISTMAS_PAGE_YEAR}-12-31`);
  return {
    holiday: 'christmas', year: CHRISTMAS_PAGE_YEAR, locale: 'en-GB', townId: 'glasgow',
    dataUpdatedOn: dataUpdatedOn('christmas', 'glasgow'),
    label: 'Christmas and New Year', h1: 'Christmas and New Year in Glasgow', noClosedCount: true,
    season: { days },
    frontPage: last ? [{
      label: 'Hogmanay and New Year', from: `${CHRISTMAS_PAGE_YEAR}-${HOGMANAY_POST_FROM}`, to: last, anchor: 'dec-31',
      deckDays: newYear.map((d) => ({ label: d.name, date: d.date })),
    }] : [],
    facts: GLASGOW_FACTS,
    events: GLASGOW_EVENTS,
    linkOnly: [
      { group: 'Trains, Subway and buses', label: 'ScotRail', linkText: 'Christmas and New Year train times', url: SCOTRAIL.url },
      { group: 'Trains, Subway and buses', label: 'Glasgow Subway (SPT)', linkText: 'Subway timetables', url: 'https://www.spt.co.uk/subway/subway-timetables/' },
      { group: 'Trains, Subway and buses', label: 'First Bus Glasgow', linkText: 'festive service levels', url: 'https://www.firstbus.co.uk/greater-glasgow/plan-journey/festive-service-levels' },
      { group: 'Trains, Subway and buses', label: "McGill's", linkText: 'mcgillsbuses.co.uk', url: 'https://www.mcgillsbuses.co.uk/' },
      { group: 'Trains, Subway and buses', label: 'Stagecoach', linkText: 'stagecoachbus.com', url: 'https://www.stagecoachbus.com/' },
      { group: 'Trains, Subway and buses', label: 'Citylink', linkText: 'citylink.co.uk', url: 'https://www.citylink.co.uk/' },
      { label: 'SEIN Glasgow', linkText: 'festive activities and support', url: 'https://seinglasgow.org.uk/news/festive-activities-and-support' },
    ],
    related: [{ label: 'All upcoming events in Glasgow', href: '/events/' }],
  };
}
