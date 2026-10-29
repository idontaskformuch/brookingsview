/** "Getting home" for /tonight (Glasgow): the last Subway trains and a pointer to ScotRail's planner, from official sources only.
 *  Owner 2026-10-28 (steg 3). Every block carries its source link and a "checked <date>"; a block not re-checked within
 *  GETTING_HOME_MAX_AGE_DAYS is dropped from the page rather than shown with an old date (same rule as the T5 rows).
 *
 *  Subway times: SPT's own timetable page (spt.co.uk/subway/subway-timetables/), read 2026-10-29. The page has no effective date, so
 *  the block says "check SPT before you travel" and event nights/holidays are named as exceptions.
 *  Rail: ScotRail publishes last trains per route and day, not one network-wide time, so no time is invented here; the block links
 *  the official planner. Per-route last trains need a source decision (owner). */
export const GETTING_HOME_MAX_AGE_DAYS = 30;

export interface LastTrainRow { circle: string; from: string; monSat: string; sunday: string }

export interface GettingHome {
  townId: string;
  /** YYYY-MM-DD the facts below were last read from the official pages. */
  checked: string;
  subway: { name: string; sourceUrl: string; sourceLabel: string; hours: { monSat: string; sunday: string }; lastTrains: LastTrainRow[] };
  rail: { name: string; plannerUrl: string; sourceLabel: string };
}

export const GETTING_HOME: GettingHome[] = [
  {
    townId: 'glasgow',
    checked: '2026-10-29',
    subway: {
      name: 'Glasgow Subway',
      sourceUrl: 'https://www.spt.co.uk/subway/subway-timetables/',
      sourceLabel: 'SPT Subway timetables',
      hours: { monSat: '06:30 to 23:40', sunday: '10:00 to 18:12' },
      lastTrains: [
        { circle: 'Outer circle', from: 'Govan', monSat: '23:16', sunday: '17:50' },
        { circle: 'Outer circle', from: 'St Enoch', monSat: '23:30', sunday: '18:03' },
        { circle: 'Inner circle', from: 'Govan', monSat: '23:16', sunday: '17:50' },
        { circle: 'Inner circle', from: 'St Enoch', monSat: '23:28', sunday: '18:00' },
      ],
    },
    rail: { name: 'ScotRail', plannerUrl: 'https://www.scotrail.co.uk/plan-your-journey', sourceLabel: 'ScotRail journey planner' },
  },
];

const DAY_MS = 86_400_000;

/** The block for a town, or null when there is none or it has not been checked within GETTING_HOME_MAX_AGE_DAYS of `now`. */
export function gettingHomeFor(townId: string, now: Date, data: GettingHome[] = GETTING_HOME): GettingHome | null {
  const g = data.find((d) => d.townId === townId);
  if (!g) return null;
  const age = (now.getTime() - Date.parse(`${g.checked}T12:00:00Z`)) / DAY_MS;
  return Number.isFinite(age) && age <= GETTING_HOME_MAX_AGE_DAYS ? g : null;
}
