/** Brookings answer pages (Fas 3). K1 (owner 2026-11-19): the trash, recycling and yard waste guide moved here from pages/trash-recycling.astro
 *  with the same content, byte for byte (test: lib/city-answers-brookings.test.ts against a fixture of the page as it was built on 19 Nov).
 *  Every fact is from the City of Brookings' own solid-waste pages (SOURCES), read 2026-10-23. Dates and fees are the 2026 ones. */
import type { AnswerPage } from './types';

const BASE = 'https://www.cityofbrookings-sd.gov';
const CHECKED = 'October 23, 2026';
const PHONE_LANDFILL = '605-693-3667';
export const BROOKINGS_TRASH_SOURCES = [
  { name: 'City of Brookings: Garbage collection (schedule, set-out, fees)', url: `${BASE}/260/Garbage-Collection` },
  { name: 'City of Brookings: Garbage', url: `${BASE}/261/Garbage` },
  { name: 'City of Brookings: Recycling', url: `${BASE}/262/Recycling` },
  { name: 'City of Brookings: Yard waste', url: `${BASE}/264/Yard-Waste` },
  { name: 'City of Brookings: Landfill information', url: `${BASE}/255/Landfill-Information` },
  { name: 'City of Brookings: Landfill fees (effective January 1, 2026)', url: `${BASE}/257/Fees` },
  { name: 'City of Brookings: Spring bulky item pickup', url: `${BASE}/258/Spring-Bulky-Item-Pickup` },
  { name: 'City of Brookings: Household hazardous waste event', url: `${BASE}/330/Household-Hazardous-Waste-HHW-Event` },
  { name: 'City of Brookings: Electronic waste recycling', url: `${BASE}/927/Electronic-Waste-Recycling` },
];
const S = BROOKINGS_TRASH_SOURCES;
const checked = '2026-10-23';
const checkAt = '2027-02-20';

export const BROOKINGS_ANSWERS: AnswerPage[] = [
  {
    slug: 'trash-recycling',
    title: 'Trash & Recycling Guide | {Site}',
    h1: 'Brookings trash, recycling and yard waste: pickup days and what goes where',
    description: 'Brookings garbage, recycling and yard waste: which day is yours, what goes in each cart, holiday changes, and what to do with big items, branches and paint.',
    sourcesInAbout: false,
    about: `The City of Brookings picks up garbage, recycling and yard waste every week, and the day depends on which side of 8th Street South you live on. This guide puts the city's rules in one place: find your day, see what goes in each cart, and learn what to do with the things that do not fit, like couches, branches, old computers and paint. Everything comes from the city's own pages, last checked ${CHECKED}; fees and dates are the 2026 ones.`,
    answers: [
      {
        id: 'pickup-day', question: 'Find your pickup day', sources: [S[0], S[3]], checked, checkAt,
        faq: 'Garbage is picked up Monday south of 8th Street South and Tuesday north of it; recycling Thursday south and Friday north.',
        blocks: [
          { kind: 'component', name: 'brookings-trash-picker' },
          { kind: 'table', caption: 'Pickup days by area', head: ['Area', 'Garbage', 'Recycling', 'Yard waste (seasonal)'], rows: [
            { th: 'South of 8th St. S.', cells: ['Monday', 'Thursday', 'Monday and Thursday'] },
            { th: 'North of 8th St. S.', cells: ['Tuesday', 'Friday', 'Tuesday and Friday'] },
          ] },
          { kind: 'p', text: `The city's [collection map (PDF)](${BASE}/DocumentCenter/View/19360) shows the boundary if you are not sure which side you are on. Yard waste collection runs April 6 to November 24, 2026 and does not run in winter.` },
        ],
      },
      {
        id: 'carts-out', question: 'Putting your carts out', sources: [S[0]], checked, checkAt,
        blocks: [
          { kind: 'list', items: [
            '**Be at the curb by 7:00 a.m.** on your collection day. The city says this is what ensures pickup.',
            '**Leave room for the truck:** at least 3 feet clear on each side of a cart and 1.5 feet behind it. Keep carts away from mailboxes, trees, parked vehicles, trailers and boats. If the crew does not have room, the cart is not emptied.',
            '**Boulevard only, and bring it back the same day.** Under city ordinance 40-10, carts go on the parkway or boulevard next to your property and must be removed the same day.',
            '**In winter,** keep a spot cleared on either side of the driveway so the cart can be placed there.',
          ] },
        ],
      },
      {
        id: 'holidays', question: 'Holiday weeks', sources: [S[0]], checked, checkAt,
        blocks: [
          { kind: 'p', text: "These holidays change pickup: New Year's Day, Martin Luther King Jr. Day, Presidents' Day, Memorial Day, Juneteenth, Independence Day, Labor Day, Native American Day, Veterans Day, Thanksgiving Day and Christmas Day. The city's rules:" },
          { kind: 'list', items: [
            "Sunday (except Easter) or Monday holiday: Monday's garbage and yard waste move to Tuesday, and Tuesday's move to Wednesday.",
            'Tuesday holiday: garbage and yard waste move to Wednesday.',
            'Thursday holiday: recycling and yard waste move to Wednesday.',
            "Friday or Saturday holiday: Friday's recycling and yard waste move to Thursday, and Thursday's move to Wednesday.",
          ] },
          { kind: 'component', name: 'brookings-trash-holidays' },
        ],
      },
      {
        id: 'what-goes-where', question: 'What goes where', sources: [S[1], S[2], S[3]], checked, checkAt,
        blocks: [
          { kind: 'cols', cols: [
            { heading: 'Green cart: garbage', blocks: [
              { kind: 'p', text: 'The city provides a 90-gallon green cart to each home. It is for **household garbage only**. Put garbage and pet waste in a tied plastic bag first to control odor, and keep the cart clean.' },
              { kind: 'p', text: '**Never in the garbage cart:** car batteries or lithium batteries, hot ashes, oil products, paint cans (unless empty), tree trimmings and yard waste.' },
            ] },
            { heading: 'Blue cart: recycling', blocks: [
              { kind: 'p', text: "**Empty, rinsed, loose.** That is the city's rule for everything in the blue cart." },
              { kind: 'p', text: '**Yes:** plastic bottles, tubs, jugs and jars (put plastic lids back on unless they are pumps or nozzles); glass bottles and jars of any color; aluminum, steel and tin cans, clean foil and trays, and empty aerosol cans; paper, newspaper, magazines, mail and envelopes; cardboard and cartons, including cereal, shipping and shoe boxes. Shredded paper goes in a clear plastic bag, the only bag allowed.' },
              { kind: 'p', text: '**No:** plastic bags and wrappers, clamshells, straws, red Solo cups, Styrofoam, batteries, food and plant waste, diapers, clothing and fabric, hoses, cords and string lights, glass drinking glasses, dishware, mirrors and window glass, light bulbs, pots and pans, and soiled paper, paper towels and napkins. **Greasy pizza boxes go in the garbage.**' },
            ] },
            { heading: 'Brown cart: yard waste', blocks: [
              { kind: 'p', text: '**Yes:** grass clippings, leaves, flowers, weeds, stalks, vines and small twigs under half an inch across.' },
              { kind: 'p', text: '**No:** trees and branches. Take them to the landfill (free) or put them out during the spring bulky item pickup.' },
              { kind: 'p', text: 'Adding a yard waste cart costs nothing; an optional second cart is $6.40 a month plus sales tax. Collection runs April 6 to November 24, 2026.' },
            ] },
          ] },
          { kind: 'p', text: `Not sure about an item? The city has a [What Goes Where search tool](${BASE}/928/What-Goes-Where-Search-Tool).` },
        ],
      },
      {
        id: 'big-things', question: 'Big things, branches, electronics and paint', sources: [S[4], S[5], S[6], S[7], S[8]], checked, checkAt,
        blocks: [
          { kind: 'facts', rows: [
            { label: 'Couches, furniture, metal and branches (once a year)', value: 'The city runs a **Spring Bulky Item Pickup**. In 2026, residents could put items out from April 8 (all items out by April 12) and crews went through April 13 to 17. Sort into three piles (metals, bulky items, branches) at least 4 feet apart, on the boulevard, even with snow. Branches can be up to 12 inches across and 6 feet long, placed parallel to the street. Crews pass each street one time, do not do alleys, and serve city residents only. Not taken at the curb: e-waste, household trash, cardboard, grass and leaves, whole trees, remodeling material and concrete, paint, batteries, oil and chemicals. Dates for the next spring pickup are announced by the city each year.' },
            { label: 'Anything else: the landfill', value: `The Brookings Regional Landfill is at 4101 30th Street (${PHONE_LANDFILL}). It is open Monday to Friday 7:30 a.m. to 4:15 p.m. and Saturday 8:00 to 11:45 a.m. (closed Saturdays December 1 through March 31; holiday closures are on the city's landfill calendar). **Cover your load:** an uncovered load is a $25 fee, and straps do not count as a cover. It takes clean lumber and trees, tires, metal and appliances. Scavenging is not allowed. 2026 fees: tires $4.70 (car), $7.00 (pickup), $14.80 (truck) and $39.75 (tractor) each, rims $9.15; refrigerators, freezers, air conditioners and dehumidifiers $20 each (no need to remove the coolant). Garbage and demolition loads are $49.25 a ton and lumber or trees $24.10 a ton.` },
            { label: 'Branches and yard waste, any time', value: "The landfill's yard waste drop-off is free, open 24 hours a day all year. Residents can pick up free compost there too." },
            { label: 'Old computers, TVs and electronics', value: "Take e-waste to the electronic storage shed south of the landfill office (the page lists no separate hours, so use the landfill's). Since April 20, 2026 the fee is $0.75 a pound, weighed at drop-off. Accepted: computers, laptops, tablets, monitors, TVs, printers, keyboards, routers and similar. Not accepted: fluorescent bulbs, medical equipment and mercury-containing items. Lithium and single-use batteries can also go in the drop-box near the west door of the Brookings East Fire Station." },
            { label: 'Paint, chemicals and other household hazardous waste', value: `Never put these in the trash, a sink, the ground or a storm drain. The city holds a free household hazardous waste event once a year; in 2026 it was Saturday, August 15 at the Dacotah Bank Center, for residents of Brookings, Deuel, Hamlin, Kingsbury, Lake and Moody counties (limit 15 gallons or 125 pounds per vehicle). The city's page lists no year-round option, so call the landfill at ${PHONE_LANDFILL} between events.` },
          ] },
        ],
      },
      {
        id: 'cost', question: 'Cost, new carts and who to call', sources: [S[0]], checked, checkAt,
        blocks: [
          { kind: 'list', items: [
            '**Garbage service** is $19.70 a month plus sales tax, billed through Brookings Municipal Utilities. An additional garbage cart is $6.40 a month plus sales tax.',
            `**New to town, or need a recycling or yard waste cart?** Call the Brookings Collection Department at ${PHONE_LANDFILL}, use the [city's cart request form](https://seeclickfix.com/web_portal/PFjWLgnz21kvWrNXMprhZAyM/report/category/27568/location), or the Engage Brookings app.`,
            '**City of Brookings:** 605-692-6281, 520 3rd Street, Suite 230. The city lists its collection hours of operation as 6:30 a.m. to 4:30 p.m. Monday, Tuesday, Thursday and Friday.',
          ] },
        ],
      },
    ],
    tail: {
      heading: 'Sources',
      blocks: [
        { kind: 'list', className: 'tr-sources', items: S.map((s) => `[${s.name}](${s.url})`) },
        { kind: 'p', note: true, text: `Unofficial guide by Brookings View, summarizing the City of Brookings' published rules; the city's pages are the authority and can change. Last checked ${CHECKED}. Found a mistake? See [corrections](/corrections/) or [contact us](/contact/). Related: [City Hall](/city-hall/), [closures](/closures/).` },
      ],
    },
  },
];
