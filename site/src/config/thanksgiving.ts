/** Thanksgiving 2026 facts per US town, each read from the town's own pages on 2026-10-24 (owner-ordered
 *  2026-10-23). Nothing here is predicted: where a town has not posted a fact yet, the entry says so and links to
 *  where the town will post it. Refresh every year (lib/thanksgiving.ts THANKSGIVING_PAGE_YEAR). */

export interface ThanksgivingFact {
  label: string;
  /** Plain sentence(s), paraphrasing the source. */
  text: string;
  source: { name: string; url: string };
}

export interface ThanksgivingTown {
  /** Heading for the trash/recycling block's intro line. */
  trashIntro: string;
  /** Static trash/recycling facts; Brookings also gets the computed pickup table (see the page). */
  trash: ThanksgivingFact[];
  /** City offices, libraries, drop-off sites. */
  services: ThanksgivingFact[];
  /** Where to look for last-minute changes. */
  watch: { label: string; url: string }[];
}

export const THANKSGIVING_TOWNS: Record<string, ThanksgivingTown> = {
  brookings_sd: {
    trashIntro: "The City of Brookings follows its Thursday-holiday rule: recycling and yard waste move to Wednesday.",
    trash: [
      {
        label: 'Holiday rule',
        text: "Thanksgiving is one of the city's collection holidays. For a Thursday holiday, the city says recycling and yard waste are picked up on Wednesday. Curbside yard waste collection ends for the season on November 24, 2026.",
        source: { name: 'City of Brookings: Landfill and Collections Calendar', url: 'https://cityofbrookings-sd.gov/265/Landfill-and-Collections-Calendar' },
      },
    ],
    services: [
      {
        label: 'City offices',
        text: "The city recognizes Thanksgiving Day as a holiday and says that in most cases city administrative offices are closed on the holiday. Some city-owned facilities and recreation activities may have closures, schedule changes or special hours; the city posts those on its social media. The city's page does not mention the day after Thanksgiving.",
        source: { name: 'City of Brookings: City Holidays', url: 'https://www.cityofbrookings-sd.gov/89/City-Holidays' },
      },
      {
        label: 'Landfill',
        text: 'The Brookings Regional Landfill is closed all day Thursday, November 26. Saturday, November 28 is the last Saturday it is open for the season.',
        source: { name: 'City of Brookings: Landfill and Collections Calendar', url: 'https://cityofbrookings-sd.gov/265/Landfill-and-Collections-Calendar' },
      },
      {
        label: 'Library',
        text: "Brookings Public Library's standing hours are Monday to Thursday 9:30 a.m. to 8 p.m., Friday and Saturday 9:30 a.m. to 5:30 p.m. and Sunday 1 to 5 p.m. No Thanksgiving notice was posted yet; the library's calendar has holiday hours (or call 605-692-9407).",
        source: { name: 'Brookings Public Library', url: 'https://www.brookingslibrary.org/' },
      },
    ],
    watch: [
      { label: 'City of Brookings: Garbage collection and holiday changes', url: 'https://www.cityofbrookings-sd.gov/260/Garbage-Collection' },
      { label: 'Brookings Public Library calendar', url: 'https://www.brookingslibrary.org/calendar.php' },
    ],
  },
  moreno_valley_ca: {
    trashIntro: "Moreno Valley's collection is suspended on Thanksgiving Day and runs one day late for the rest of that week.",
    trash: [
      {
        label: 'Holiday rule',
        text: "Collection is suspended on Thanksgiving Day, one of six holidays the city lists (New Year's Day, Memorial Day, the Fourth of July, Labor Day, Thanksgiving and Christmas). When the holiday falls on a weekday, trash, green waste and recycling pickups are delayed by one day for the remainder of that week. Applying that rule: Thursday's pickup moves to Friday and Friday's to Saturday; Monday to Wednesday are unchanged.",
        source: { name: 'City of Moreno Valley: Holiday schedule (waste)', url: 'https://www.moreno-valley.ca.us/resident_services/waste/trash-holiday.html' },
      },
    ],
    services: [
      {
        label: 'Landfill and transfer station',
        text: 'The Badlands Sanitary Landfill (6 a.m. to 4:30 p.m. Monday to Saturday) is listed as closed Sundays and holidays, and the Waste Management Transfer Station (7 a.m. to 2 p.m. Monday to Friday, 7 a.m. to 1 p.m. Saturday) as closed holidays; the city page does not name which holidays. Call to confirm: landfill 951-486-3200, transfer station 800-774-0222.',
        source: { name: 'City of Moreno Valley: Landfill and transfer stations', url: 'https://www.moreno-valley.ca.us/resident_services/waste/recycle-landfill.html' },
      },
      {
        label: 'Library',
        text: "The Moreno Valley Public Library publishes its holiday schedule as a PDF on its page; the 2026 schedule had not been posted when this was checked. Standing hours: Main Library Monday to Thursday 9 a.m. to 8 p.m., Friday 9 a.m. to 6 p.m., Saturday 9 a.m. to 5 p.m., Sunday noon to 5 p.m.; the MV Mall and Iris Plaza branches Monday to Friday 10 a.m. to 8 p.m. and Saturday 10 a.m. to 6 p.m.",
        source: { name: 'Moreno Valley Public Library', url: 'https://moval.gov/mv-library/' },
      },
      {
        label: 'City offices',
        text: "The city had not posted its Thanksgiving office schedule when this was checked. Watch the city's website and social media for it.",
        source: { name: 'City of Moreno Valley', url: 'https://www.moreno-valley.ca.us/' },
      },
    ],
    watch: [
      { label: 'City of Moreno Valley: Residential trash and recycling', url: 'https://moval.gov/resident_services/waste/residential-index.html' },
      { label: 'Waste Management: Holiday waste pickup schedule', url: 'https://www.wm.com/us/en/holiday-schedule' },
      { label: 'Moreno Valley Public Library', url: 'https://moval.gov/mv-library/' },
    ],
  },
  broomfield_co: {
    trashIntro: "Broomfield's curbside hauler, Waste Connections, is the source for Thanksgiving collection changes.",
    trash: [
      {
        label: 'Holiday collection',
        text: "The City and County of Broomfield contracts with Waste Connections of Colorado for curbside trash and recycling. Its holiday delay notices come through the WasteConnect mobile app (residents can sign up for reminders about weather and holiday delays) and its customer line, 303-288-2100. The city's page does not list the holiday shift itself, so check your own pickup day in the hauler's calendar before the holiday.",
        source: { name: 'City and County of Broomfield: Residential waste services', url: 'https://www.broomfield.org/3980/Residential-Waste-Services-in-Broomfield' },
      },
    ],
    services: [
      {
        label: 'Tree Branch Recycle and RV Wastewater Disposal Facility',
        text: 'The facility at 2990 W 124th Avenue (open Wednesdays 1 to 5 p.m. and Saturdays 8 a.m. to 5 p.m.) lists November 28 among its closure dates, so it is closed the Saturday after Thanksgiving. It is for Broomfield residents only.',
        source: { name: 'City and County of Broomfield: Tree Branch Recycling Program', url: 'https://broomfield.org/1031/Tree-Branch-Recycling-Program' },
      },
      {
        label: 'City offices, library and recreation centers',
        text: "The city had not posted a 2026 Thanksgiving closure list when this was checked; it has posted one in earlier years, so watch its news page. The Broomfield Library's page gives regular hours and says holiday hours are posted separately.",
        source: { name: 'City and County of Broomfield: Library', url: 'https://www.broomfield.org/276/Library-Home' },
      },
    ],
    watch: [
      { label: 'City and County of Broomfield: News', url: 'https://www.broomfield.org/CivicAlerts.aspx?CID=-1' },
      { label: 'Residential waste services (Waste Connections)', url: 'https://www.broomfield.org/3980/Residential-Waste-Services-in-Broomfield' },
    ],
  },
};
