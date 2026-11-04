/** Veterans Day 2026, Broomfield only (owner 2026-11-04: other towns get no page and no sitemap entry). Same model
 *  as thanksgiving.ts; nothing is predicted or paraphrased from memory.
 *
 *  Sources read 2026-11-04, robots.txt first: broomfield.org (newsflash 3155, recreation hours, waste page),
 *  rtd-denver.com (news), broomfieldfish.org, broomfieldveterans.org. compass.broomfield.org is blocked by robots.txt,
 *  so it appears only in `linkOnly`. Notice 3155 is a rolling notice: it was the Thanksgiving closures notice and
 *  became the Veterans Day one on Nov 2, so the Thanksgiving recheck must look for a new notice in the newsflash list. */
import type { HolidayFact, HolidayEvent, HolidayPageData, Source } from '../../lib/holiday-page';
import { dataUpdatedOn } from './data-updated';

const VETERANS_DAY_PAGE_YEAR = 2026;

const CHECKED = '2026-11-04';
const NOTICE: Source = {
  name: "City and County of Broomfield: CCOB Closures and Adjusted Hours for Veteran's Day",
  url: 'https://www.broomfield.org/m/newsflash/home/detail/3155',
};
const BF_REC: Source = { name: 'City and County of Broomfield: Recreation Facilities Hours', url: 'https://www.broomfield.org/1452/Recreation-Facilities-Hours' };
const BF_WASTE: Source = { name: 'City and County of Broomfield: Residential waste services', url: 'https://www.broomfield.org/3980/Residential-Waste-Services-in-Broomfield' };
const RTD_NEWS: Source = { name: 'RTD: News', url: 'https://www.rtd-denver.com/community/news' };
const FISH: Source = { name: 'Broomfield FISH', url: 'https://www.broomfieldfish.org/' };
const MUSEUM_POST = 'https://broomfieldveterans.org/uncategorized/annual-veterans-day-ceremony-to-feature-grady-birdsong-as-keynote-speaker/';

const FACTS: HolidayFact[] = [
  {
    section: 'closures', status: 'confirmed', label: 'City offices',
    value: 'Closed Nov 11: George Di Ciero City and County Building, Health and Human Services Building and Water Recovery Facility.',
    source: NOTICE, checkedOn: CHECKED,
  },
  { section: 'closures', status: 'confirmed', label: 'Combined Courts', value: 'Closed Nov 11.', source: NOTICE, checkedOn: CHECKED },
  { section: 'closures', status: 'confirmed', label: 'inventHQ', value: 'Closed Nov 11.', source: NOTICE, checkedOn: CHECKED },
  { section: 'closures', status: 'confirmed', label: 'Library', value: 'Closed Nov 11.', source: NOTICE, checkedOn: CHECKED },
  {
    section: 'closures', status: 'confirmed', label: 'Police Department Building and Detention Center',
    value: 'Operations run 24/7 on Nov 11. The front desk is not staffed; the vestibule phone connects to an officer 24/7.',
    source: NOTICE, checkedOn: CHECKED,
  },
  {
    section: 'closures', status: 'unconfirmed', label: 'Recreation centers',
    clarify: 'Neither the city notice nor the recreation hours page mentions Nov 11.',
    source: BF_REC, checkedOn: CHECKED,
    checkAt: { label: 'Recreation Facilities Hours', url: BF_REC.url },
  },
  {
    section: 'trash', status: 'unconfirmed', label: 'Holiday collection (Waste Connections)',
    clarify: "The city's waste page lists no Veterans Day change; delay alerts come through the WasteConnect app.",
    source: BF_WASTE, checkedOn: CHECKED,
    checkAt: { label: 'WasteConnect app (link on the city waste page)', url: BF_WASTE.url, phone: '303-288-2100 ext. 6' },
  },
  {
    section: 'transit', status: 'unconfirmed', label: 'RTD service on Nov 11',
    clarify: "RTD's news page lists no Veterans Day service notice.",
    source: RTD_NEWS, checkedOn: CHECKED,
    checkAt: { label: 'RTD service alerts', url: 'https://www.rtd-denver.com/service-alerts' },
  },
  {
    section: 'help', status: 'unconfirmed', label: 'Broomfield FISH food bank',
    clarify: 'FISH has not announced a change for Nov 11.',
    usual: 'Wednesday 1–6 p.m.',
    source: FISH, checkedOn: CHECKED,
    checkAt: { label: 'Broomfield FISH', url: FISH.url, phone: '303-465-1600' },
  },
];

const EVENTS: HolidayEvent[] = [
  {
    status: 'confirmed',
    name: 'Annual Veterans Day Ceremony',
    date: '2026-11-11',
    startTime: '11:00',
    venue: { name: 'Broomfield Veterans Memorial Museum', street: '12 Garden Center', locality: 'Broomfield', region: 'CO' },
    url: MUSEUM_POST,
    details: [
      'Music by Rocky Mountain Brassworks, Mile High Fife and Drum and the Broomfield Civic Chorus. Keynote: Grady Birdsong (USMC retired).',
      'The Broomfield Police Department and Fraternal Order of Police Lodge 45 provide refreshments.',
      'The museum lists no cost.',
    ],
    source: { name: 'Broomfield Veterans Memorial Museum: ceremony announcement (posted Oct 27, 2026)', url: MUSEUM_POST },
    checkedOn: CHECKED,
  },
];

export const VETERANS_DAY_TOWN_IDS = ['broomfield_co'] as const;

/** Fixed, owner-approved wording (2026-11-04): promises only what the page has. */
export const VETERANS_DAY_META = {
  title: "Veterans Day 2026 in Broomfield: what's closed on Nov 11",
  h1: "Veterans Day 2026: what's closed on Nov 11",
  description: 'Nov 11: Broomfield city offices, courts, inventHQ and library closed. Police run 24/7 but the front desk is unstaffed. Trash, RTD and rec hours unconfirmed.',
};

/** Outside the window: no year in the title, the description names the season it covers. */
export const VETERANS_DAY_META_EVERGREEN = {
  title: 'Veterans Day in Broomfield: closures and hours',
  h1: 'Veterans Day: closures and hours',
  description: '2026: Broomfield city offices, courts, inventHQ and library closed Nov 11; police ran 24/7. Each row shows its source and check date.',
};

/** The Veterans Day page, or null for a town without one. */
export function buildVeteransDayPage(townId: string): HolidayPageData | null {
  if (townId !== 'broomfield_co') return null;
  return {
    holiday: 'veterans-day', year: VETERANS_DAY_PAGE_YEAR, locale: 'en-US', townId,
    facts: FACTS, events: EVENTS,
    linkOnly: [{ label: 'City events', linkText: 'Broomfield events calendar', url: 'https://compass.broomfield.org/events/week' }],
    metaOverride: VETERANS_DAY_META,
    metaOverrideEvergreen: VETERANS_DAY_META_EVERGREEN,
    dataUpdatedOn: dataUpdatedOn('veterans-day', townId),
    related: [
      { label: 'All upcoming events', href: '/events/' },
      { label: 'Today in town', href: '/today/' },
    ],
  };
}
