/** Election 2026 -- the `election` block per town (spec: .claude/specs/election-2026.md, phase 1).
 *  Every date, place and link below was read from the cited official page on `checked_on`; the
 *  build fails (lib/election.ts assertElectionValid) if a field lacks a source_url. Nothing here
 *  is written by a model. Where a source did not state something, the field is absent -- it is
 *  never filled from a third-party site or from memory (hard rule 6).
 *
 *  Spec-vs-source corrections found while verifying (2026-10-21):
 *   - Broomfield: the spec says ballots were mailed 9 Oct; broomfield.org says Friday 2 Oct 2026.
 *   - Moreno Valley: voteinfo.net sits behind a Cloudflare challenge (never bypassed, rule 7), so
 *     dates come from rivco.gov and the ROV's own vote-center PDF; the node/1276 page in the
 *     spec could not be read and is not cited. */
import type { ElectionConfig } from '../lib/election';

// ---------------------------------------------------------------- Broomfield
const BF_DATES = 'https://www.broomfield.org/3530/Important-Dates';
const BF_WHERE = 'https://www.broomfield.org/1872/Where-can-I-drop-off-ballot-vote-in-pers';
const BF_INFO = 'https://broomfield.org/4369/Election-Information';
const BF_Q = 'https://broomfield.org/4198/Broomfield-Specific-Ballot-Questions';

const broomfield: ElectionConfig = {
  enabled: true,
  election_date: '2026-11-03',
  checked_on: '2026-10-21',
  officialHosts: ['broomfield.org', 'coloradosos.gov'],
  authority: {
    name: 'City and County Clerk and Recorder, City and County of Broomfield',
    url: BF_INFO, phone: '303-469-3301', source_url: BF_INFO,
  },
  sources: [
    { label: 'Important Election Dates (broomfield.org)', url: BF_DATES },
    { label: 'Polling Center and Drop-box Locations (broomfield.org)', url: BF_WHERE },
    { label: 'Election Information (broomfield.org)', url: BF_INFO },
    { label: 'Broomfield Specific Ballot Questions (broomfield.org)', url: BF_Q },
  ],
  key_dates: [
    { id: 'mailed', date: '2026-10-02', label: 'Ballots mailed to residents', detail: 'Allow 7 days to receive.', source_url: BF_DATES },
    { id: 'centers-open', date: '2026-10-19', label: 'Voter Service and Polling Center opens', detail: 'Residents may vote in person October 19 through November 3.', source_url: BF_DATES },
    { id: 'mail-by', date: '2026-10-26', label: 'Last recommended day to mail your voted ballot', prominent: true, source_url: BF_DATES },
    { id: 'election-day', date: '2026-11-03', label: 'Election Day', detail: 'Ballots must reach the Elections Division by 7 p.m. The city recommends hand-delivering your ballot rather than mailing it.', prominent: true, source_url: BF_WHERE },
  ],
  registration: {
    text: 'You can register to vote or update your registration at any Voter Service and Polling Center.',
    source_url: BF_WHERE,
  },
  mail_ballot: {
    text: 'Ballots were mailed starting October 2. Return yours by mail (the last recommended day to mail is October 26), at a 24-hour drop box, or at a Voter Service and Polling Center.',
    tracking: { label: 'Track your ballot (Colorado Secretary of State)', url: 'https://ballottrax.coloradosos.gov/voter/', source_url: BF_INFO },
    source_url: BF_WHERE,
  },
  places: [
    {
      name: 'George Di Ciero City and County Building', address: 'One DesCombes Dr.', kind: 'election_day',
      schedule: ['Oct. 19 to Nov. 2: Mon.–Fri., 8:00 a.m.–5:00 p.m.', 'Sat., Oct. 31: 8:00 a.m.–5:00 p.m.', 'Sun., Nov. 1: Closed', 'Election Day, Nov. 3: 7:00 a.m.–7:00 p.m.'],
      source_url: BF_WHERE,
    },
    {
      name: 'Flatiron Marketplace', address: '170 E. Flatiron Crossing Dr.', kind: 'election_day',
      schedule: ['Fri., Oct. 30, and Sat., Oct. 31: 8:00 a.m.–5:00 p.m.', 'Sun., Nov. 1: Closed', 'Mon., Nov. 2: 8:00 a.m.–5:00 p.m.', 'Election Day, Nov. 3: 7:00 a.m.–7:00 p.m.'],
      source_url: BF_WHERE,
    },
    {
      name: 'Paul Derda Recreation Center', address: '13201 Lowell Blvd.', kind: 'election_day',
      schedule: ['Mon., Nov. 2: 8:00 a.m.–5:00 p.m.', 'Election Day, Nov. 3: 7:00 a.m.–7:00 p.m.'],
      source_url: BF_WHERE,
    },
    {
      name: 'Broomfield Municipal Shops', address: '3951 W. 144th Ave.', kind: 'election_day',
      schedule: ['Mon., Nov. 2: 8:00 a.m.–5:00 p.m.', 'Election Day, Nov. 3: 7:00 a.m.–7:00 p.m.'],
      source_url: BF_WHERE,
    },
  ],
  places_note: { text: 'These Voter Service and Polling Centers offer ballot drop-off, in-person voting, replacement ballots, and new or updated voter registration.', source_url: BF_WHERE },
  polling_place_lookup: { label: 'Polling centers and drop-box locations (City and County of Broomfield)', url: BF_WHERE, source_url: BF_WHERE },
  drop_boxes: { label: 'Official list of 24-hour ballot drop boxes (open October 2 through November 3)', url: BF_WHERE, source_url: BF_WHERE },
  sample_ballot: { label: 'Sample ballot (Colorado Secretary of State)', url: 'https://myballot.coloradosos.gov/app/home', source_url: BF_INFO },
  ballot: {
    items: [
      { name: '1A - Broomfield Lodging Tax' },
      { name: '1B - Xcel Franchise Agreement' },
      { name: '1C - Future Mayor Term and Term Limits' },
      { name: '7E - Term Limits for the 17th Judicial District Attorney' },
    ],
    note: 'These are the Broomfield-specific ballot questions the city lists. Your full ballot, including candidate races and statewide contests, is on the sample ballot.',
    source_url: BF_Q,
  },
  races_in_scope: ['1A', '1B', '1C', '7E'],
};

// ------------------------------------------------------------- Moreno Valley
const MV_CLERK = 'https://moval.gov/departments/city-clerk/2026-election.html';
const MV_PR = 'https://rivco.gov/news/vote-mail-ballots-november-3-2026-general-election-way-voters';
const MV_SOS = 'https://www.sos.ca.gov/elections/upcoming-elections/general-election-november-3-2026/key-dates-deadlines';
const MV_SOSREG = 'https://www.sos.ca.gov/elections/voter-registration';
const MV_VC = 'https://voteinfo.net/sites/g/files/aldnop371/files/2026-10/Nov%203%20VC_Sites_November_General%202026.pdf';

const morenoValley: ElectionConfig = {
  enabled: true,
  election_date: '2026-11-03',
  checked_on: '2026-10-21',
  officialHosts: ['moval.gov', 'rivco.gov', 'voteinfo.net', 'registertovote.ca.gov', 'sos.ca.gov'],
  authority: {
    name: 'Riverside County Registrar of Voters',
    url: MV_PR, phone: '(951) 486-7200', phone_note: 'The number the Registrar lists for requesting a paper registration application.',
    source_url: MV_PR,
  },
  sources: [
    { label: 'Moreno Valley City Clerk: 2026 Election', url: MV_CLERK },
    { label: 'Riverside County: Vote-by-mail ballots on the way to voters', url: MV_PR },
    { label: 'California Secretary of State: Voter Registration', url: MV_SOSREG },
    { label: 'California Secretary of State: Key Dates and Deadlines, November 3, 2026 General Election', url: MV_SOS },
    { label: 'Riverside County Registrar of Voters: Vote Centers, November 3, 2026 General Election (PDF)', url: MV_VC },
  ],
  key_dates: [
    { id: 'mailed', date: '2026-10-05', label: 'Vote-by-mail ballots sent to the U.S. Postal Service', source_url: MV_PR },
    { id: 'roc-early', date: '2026-10-05', label: 'Early voting begins at the Registrar of Voters office', detail: 'Monday through Friday, 8 a.m. to 5 p.m.', source_url: MV_PR },
    { id: 'register-by', date: '2026-10-19', label: 'Last day to register to vote', detail: 'California’s deadline is 15 days before Election Day.', prominent: true, source_url: MV_SOSREG },
    { id: 'cvr', date: '2026-10-20', label: 'Same Day (conditional) registration available through Election Day', detail: 'October 20 to November 3: register “conditionally” and vote a provisional ballot.', source_url: MV_SOS },
    { id: 'vc-open', date: '2026-10-24', label: 'Vote centers begin to open', detail: 'Most sites October 24 to November 2, 9:00 a.m. to 5:00 p.m.; some sites open only October 24–25 or from October 31. Check the official vote center list.', source_url: MV_VC },
    { id: 'election-day', date: '2026-11-03', label: 'Election Day', detail: 'All vote centers are open 7:00 a.m. to 8:00 p.m.', prominent: true, source_url: MV_VC },
    { id: 'mail-received', date: '2026-11-10', label: 'Last day for a mailed ballot to arrive', detail: 'Mailed ballots must be postmarked on or before Election Day and received no later than this date. Ballots returned by mail need no postage.', source_url: MV_PR },
  ],
  registration: {
    text: 'The deadline to register for this election was October 19. Voters who missed it can still register “conditionally” and vote a provisional ballot from October 20 through Election Day, November 3. Check your eligibility and register online at registertovote.ca.gov, or call the Registrar to request a paper application.',
    link: { label: 'Register to vote (California Secretary of State)', url: 'https://registertovote.ca.gov/', source_url: MV_CLERK },
    source_url: MV_SOS,
  },
  mail_ballot: {
    text: 'Ballots were sent to the U.S. Postal Service on October 5. Mail yours back with no postage, or return it to the Registrar of Voters office or any vote center in Riverside County by 8 p.m. on Election Day.',
    link: { label: 'Vote by mail (Riverside County Registrar of Voters)', url: 'https://voteinfo.net/vote-mail', source_url: MV_CLERK },
    source_url: MV_PR,
  },
  places: [],
  places_note: { text: 'Moreno Valley sites are on the Registrar of Voters\' official vote center list (ZIP codes 92551, 92553, 92555 and 92557). The list is linked below rather than copied here, so it cannot go out of date on this page.', source_url: MV_VC },
  polling_place_lookup: { label: 'Official Riverside County vote center list, November 3, 2026 (PDF)', url: MV_VC, source_url: MV_VC },
  drop_boxes: { label: 'Registrar of Voters office: two 24-hour drop boxes at 2720 and 2724 Gateway Drive, Riverside. City clerk drop-off locations and hours are listed at voteinfo.net', url: 'https://voteinfo.net/', source_url: MV_PR },
  ballot: {
    items: [
      { name: 'Mayor (two-year term, elected at large)' },
      { name: 'City Councilmember, District 2 (four-year term)' },
      { name: 'City Councilmember, District 4 (four-year term)' },
    ],
    note: 'These are the city offices on the ballot. The City Clerk lists the qualified candidates on its election page. County and state contests and measures appear on your own ballot.',
    source_url: MV_CLERK,
  },
  races_in_scope: ['Mayor', 'District 2', 'District 4'],
};

// ----------------------------------------------------------------- Brookings
const BK_COUNTY = 'https://brookingscountysd.gov/118/Elections';
const SD_CAL = 'https://sdsos.gov/elections-voting/upcoming-elections/general-information/2026%20Election%20Information/2026%20Election%20Assets/Election%20Information/updated2026electioncalendar.pdf';
const SD_ABS = 'https://sdsos.gov/elections-voting/voting/absentee-voting.aspx';
const SD_VIP = 'https://vip.sdsos.gov/VIPLogin.aspx';
const SD_PP = 'https://sdsos.gov/elections-voting/upcoming-elections/general-information/2026%20Election%20Information/2026-Election-Polling-Places.aspx';

const brookings: ElectionConfig = {
  enabled: true,
  election_date: '2026-11-03',
  checked_on: '2026-10-21',
  officialHosts: ['brookingscountysd.gov', 'sdsos.gov'],
  authority: {
    name: 'Brookings County Finance Office & Elections', url: BK_COUNTY, phone: '605-696-8250', source_url: BK_COUNTY,
  },
  sources: [
    { label: 'Brookings County Finance Office & Elections', url: BK_COUNTY },
    { label: 'South Dakota Secretary of State: 2026 election calendar (PDF)', url: SD_CAL },
    { label: 'South Dakota Secretary of State: Absentee voting', url: SD_ABS },
    { label: 'South Dakota Secretary of State: 2026 precincts and polling places', url: SD_PP },
    { label: 'South Dakota Voter Information Portal', url: SD_VIP },
  ],
  key_dates: [
    { id: 'abs-open', date: '2026-09-18', label: 'Absentee voting begins', source_url: BK_COUNTY },
    { id: 'register-by', date: '2026-10-19', label: 'Voter registration deadline', detail: '5:00 p.m. local time.', source_url: SD_CAL },
    { id: 'abs-request', date: '2026-11-02', label: 'Last day to request an absentee ballot', detail: 'Before 5:00 p.m. local time.', prominent: true, source_url: SD_CAL },
    { id: 'election-day', date: '2026-11-03', label: 'Election Day', detail: 'Polls are open 7:00 a.m. to 7:00 p.m. local time. An absentee ballot must be received by the county election official on Election Day, in time to reach the precinct before the polls close.', prominent: true, source_url: SD_CAL },
  ],
  registration: {
    text: 'The registration deadline for this election was October 19. The state Voter Information Portal has a registration check.',
    link: { label: 'Check your voter registration (South Dakota Voter Information Portal)', url: SD_VIP, source_url: SD_PP },
    source_url: BK_COUNTY,
  },
  mail_ballot: {
    text: 'Absentee ballots can be requested from the County Finance Office or through the Secretary of State. The request form is a PDF to print and mail. Registered voters can also vote absentee in person at the County Finance Office once absentee voting has begun; bring a valid photo ID.',
    link: { label: 'Absentee voting and request form (South Dakota Secretary of State)', url: SD_ABS, source_url: SD_ABS },
    tracking: { label: 'Track your absentee ballot (Voter Information Portal)', url: SD_VIP, source_url: SD_ABS },
    source_url: BK_COUNTY,
  },
  places: [
    {
      name: 'Brookings County Finance Office (in-person absentee voting)', address: '520 Third Street, Suite 100, Brookings, SD 57006', kind: 'early',
      schedule: ['Monday through Friday, 8 a.m. to 5 p.m.'], source_url: BK_COUNTY,
    },
    { name: 'Holy Life Tabernacle', address: '241 Mustang Pass, Brookings', kind: 'election_day', source_url: BK_COUNTY },
    { name: 'Activity Center', address: '320 5th Avenue, Brookings', kind: 'election_day', source_url: BK_COUNTY },
    { name: 'Bethel Baptist Church (Area 1 and Area 2)', address: '714 17th Avenue S, Brookings', kind: 'election_day', source_url: BK_COUNTY },
    { name: 'The Impact Church', address: '201 E Pine Street, Aurora', kind: 'election_day', source_url: BK_COUNTY },
    { name: 'Community Club', address: '409 Jefferson St, Bruce', kind: 'election_day', source_url: BK_COUNTY },
    { name: 'Community Center', address: '109 Elk Street, Elkton', kind: 'election_day', source_url: BK_COUNTY },
    { name: 'Community Center', address: '109 Samara Avenue, Volga', kind: 'election_day', source_url: BK_COUNTY },
    { name: 'McKnight Hall', address: '228 W Main Street, White', kind: 'election_day', source_url: BK_COUNTY },
  ],
  places_note: { text: 'Brookings County lists these vote centers. Registered voters may vote at any vote center they choose.', source_url: BK_COUNTY },
  polling_place_lookup: { label: 'Where do I vote? (South Dakota Voter Information Portal)', url: SD_VIP, source_url: SD_PP },
  sample_ballot: { label: 'View your sample ballot (South Dakota Voter Information Portal)', url: SD_VIP, source_url: SD_PP },
  ballot: {
    items: [],
    note: 'Your ballot depends on where you live. The county does not publish a contest list on its election page; the Voter Information Portal shows the sample ballot for your address.',
    source_url: BK_COUNTY,
  },
};

export const ELECTION_BY_TOWN: Record<string, ElectionConfig> = {
  brookings_sd: brookings,
  moreno_valley_ca: morenoValley,
  broomfield_co: broomfield,
};
