/** Broomfield answer pages (Fas 3). broomfield.org read where ViewMediaBot's group / `*` allows the path (owner decision 5, 2026-11-19);
 *  every page below read once through PoliteFetcher on 2026-11-19, evidence in .claude/evidence/city-answers-2026-11/. The content paths are
 *  not disallowed for any AI crawler either; nothing here goes through a model. */
import type { AnswerPage } from './types';

const B = 'https://www.broomfield.org';
const HAULERS = { name: 'City and County of Broomfield: Licensed Trash Haulers', url: 'https://broomfield.org/1091' };
const BRANCH = { name: 'City and County of Broomfield: Tree Branch Recycling Facility', url: 'https://broomfield.org/2995/Tree-Branch-Recycling' };
const SNOW_ROUTES = { name: 'City and County of Broomfield: Snow and Ice Priority Routes', url: 'https://broomfield.org/1350/Snow-and-Ice-Priority-Routes' };
const SNOW_CONTROL = { name: 'City and County of Broomfield: Snow and Ice Control', url: `${B}/4069/Snow-and-Ice-Control` };
const PAY = { name: 'City and County of Broomfield: Pay a Bill Online', url: `${B}/2348/Pay-Online` };
const TREES = { name: 'City and County of Broomfield: Holiday Tree Recycling', url: 'https://broomfield.org/4401/Holiday-Tree-Recycling' };
const checked = '2026-11-19';

export const BROOMFIELD_ANSWERS: AnswerPage[] = [
  // B2 (owner: yes; no pickup day or holiday shift, the source has neither).
  {
    slug: 'trash-recycling',
    title: 'Trash & Recycling Guide | {Site}',
    h1: 'Broomfield trash and recycling: who picks it up and where hazardous waste goes',
    description: 'Who collects trash and recycling in Broomfield, who is enrolled in the city program, and where to take paint and other household hazardous waste.',
    about: "Who collects Broomfield's trash and recycling and where household hazardous waste goes, from the City and County of Broomfield's Licensed Trash Haulers page. Your pickup day is not on that page; your hauler or HOA has it.",
    answers: [
      {
        id: 'who', question: 'Who picks up my trash and recycling?', sources: [HAULERS], checked, checkAt: '2027-03-01',
        blocks: [
          { kind: 'p', text: 'The City and County of Broomfield has contracted with **Waste Connections of Colorado** for curbside collection of trash and recycling.' },
          { kind: 'facts', rows: [
            { label: 'Enrolled automatically', value: "Residents who don't live in an HOA, and residents in HOAs without a contracted waste and recycling hauler." },
            { label: 'Opting out', value: 'Residents can opt out of the program for a fee.' },
            { label: 'Recycling', value: 'Included at no additional cost.' },
            { label: 'In an HOA with its own hauler', value: 'Contact your homeowners association about your service.' },
            { label: 'A complaint about a hauler', value: 'Contact that provider directly. If it breaks the Broomfield Municipal Code, contact Code Compliance or the police non-emergency line at 303-438-6400.' },
          ] },
        ],
        actions: [{ label: 'List of licensed trash haulers', href: 'https://docs.google.com/spreadsheets/d/15oRU-IMxtvCadL0scz1YYqyx55zLF6A1oiwcn0RKuxc/edit?usp=sharing' }],
        faq: 'Waste Connections of Colorado collects trash and recycling for residents enrolled in Broomfield\'s program: residents outside an HOA and in HOAs without their own hauler. Recycling is included at no extra cost.',
      },
      {
        id: 'hazardous', question: 'Where do I take paint and other household hazardous waste?', sources: [HAULERS], checked, checkAt: '2027-03-01',
        blocks: [
          { kind: 'p', text: "Broomfield residents can take household hazardous waste to Boulder County's **Hazardous Materials Management Facility, 1901 63rd Street, Boulder**, at no charge. It is open on a regular basis year round." },
          { kind: 'facts', rows: [
            { label: 'Boulder/Broomfield Household Hazardous Waste', value: '303-441-4800' },
            { label: 'Broomfield Recycling Center', value: '303-438-6334' },
          ] },
        ],
        actions: [{ label: 'Household hazardous waste disposal', href: `${B}/1032/Household-Hazardous-Waste-Disposal` }],
        faq: "Broomfield residents can take household hazardous waste to Boulder County's Hazardous Materials Management Facility at 1901 63rd Street, Boulder, at no charge.",
      },
    ],
  },
  // B3 (owner: yes; past closure dates drop off by themselves).
  {
    slug: 'leaf-branch-drop-off',
    title: 'Leaf & Branch Drop-Off | {Site}',
    h1: 'Broomfield leaf, branch and yard waste drop-off: hours, rules and closed days',
    description: "Where Broomfield residents drop off leaves, branches and yard waste for free: the Tree Branch Recycling Facility's hours, what it takes and its closed days.",
    about: "Broomfield's free drop-off for leaves, branches and yard waste, from the City and County of Broomfield's Tree Branch Recycling Facility page. Closed days drop off this page once they have passed.",
    answers: [
      {
        id: 'where', question: 'Where do I take leaves and branches?', sources: [BRANCH], checked, checkAt: '2027-01-15',
        blocks: [
          { kind: 'facts', rows: [
            { label: 'Where', value: '**Tree Branch Recycling Facility, 2990 W 124th Avenue**, within the Tree Branch Recycle & RV Wastewater Disposal Facility.' },
            { label: 'Hours', value: 'Wednesdays 1 to 5 p.m. and Saturdays 8 a.m. to 5 p.m., year-round, with some exceptions for holidays.' },
            { label: 'Who', value: 'Broomfield residents only, no contractors or non-residents. Proof of residency is required at the gate.' },
            { label: 'Cost', value: 'Free. Free mulch is available year-round for residents: bring a shovel.' },
          ] },
          { kind: 'p', text: 'The site may close if it is extremely muddy or wet. If in doubt, call 303-464-5651.' },
        ],
        faq: 'Broomfield residents can drop off leaves, branches and yard waste for free at the Tree Branch Recycling Facility, 2990 W 124th Avenue, Wednesdays 1 to 5 p.m. and Saturdays 8 a.m. to 5 p.m.',
      },
      {
        id: 'what', question: 'What can I bring?', sources: [BRANCH], checked, checkAt: '2027-01-15',
        blocks: [
          { kind: 'p', text: '**Yes:** tree and shrub branches (branches more than 18 inches in diameter must be cut into 4-foot lengths), grass clippings, weeds, leaves, pumpkins (separate dumpster) and perennial flower clippings.' },
          { kind: 'p', text: '**No:** paper or plastic bags (empty them into the bin), wire, nails or metal of any kind, and household hazardous waste.' },
        ],
      },
      {
        id: 'closed', question: 'When is it closed?', sources: [BRANCH], checked, checkAt: '2027-01-15',
        blocks: [
          { kind: 'dated', intro: 'Closed on these days:', none: 'No closed days are listed for the coming weeks. Call 303-464-5651 if in doubt.', items: [
            { date: '2026-11-28', text: 'Saturday, November 28, 2026' },
            { date: '2026-12-23', text: 'Wednesday, December 23, 2026' },
            { date: '2026-12-26', text: 'Saturday, December 26, 2026' },
            { date: '2027-01-02', text: 'Saturday, January 2, 2027' },
          ] },
        ],
        actions: [{ label: 'Questions about tree branches: 303-464-5651', href: 'tel:+13034645651' }, { label: 'Yard waste questions: 303-438-6329', href: 'tel:+13034386329' }],
      },
    ],
  },
  // B4 (owner: yes).
  {
    slug: 'snow-plowing',
    title: 'Snow Plowing Priority | {Site}',
    h1: 'Broomfield snow plowing: which streets first, and when yours is plowed',
    description: "When Broomfield plows your street: the priority order, how much snow before residential streets are plowed, and who clears state highways.",
    about: "How Broomfield plows its streets, trails and sidewalks, from the City and County of Broomfield's Snow and Ice Priority Routes and Snow and Ice Control pages.",
    answers: [
      {
        id: 'when', question: 'When will my street be plowed?', sources: [SNOW_ROUTES, SNOW_CONTROL], checked, checkAt: '2027-03-01',
        blocks: [
          { kind: 'table', caption: 'Plowing priority', head: ['Priority', 'Streets', 'Serviced'], rows: [
            { th: 'First', cells: ['Major collectors serving several subdivisions; streets next to schools and in business, commercial and industrial areas', 'Within four hours of the first call'] },
            { th: 'Second', cells: ['Minor collectors serving one subdivision; steep hills and sharp curves depending on the storm', 'Within four hours after the storm subsides'] },
            { th: 'Third', cells: ['Stop sign approaches to first priority streets', 'Within twelve hours after the storm subsides'] },
          ] },
          { kind: 'facts', rows: [
            { label: 'Residential streets', value: 'Plowed by the amount of snowfall: **4+ inches = one lane plowed**, **12+ inches = two lanes plowed**.' },
            { label: 'State highways', value: 'The Colorado Department of Transportation (CDOT) is responsible for state highways such as US 287 and 120th Avenue.' },
          ] },
          { kind: 'p', text: 'Broomfield aims to keep the roads passable and does not perform snow removal services.' },
        ],
        actions: [
          { label: 'Priority map: north half', href: `${B}/DocumentCenter/View/44458/Snow_Priority_11x17_North_2024` },
          { label: 'Priority map: south half', href: `${B}/DocumentCenter/View/44457/Snow_Priority_11x17_South_2024` },
          { label: 'Report a snow or ice concern', href: `${B}/323/Street-Maintenance` },
        ],
        faq: 'Broomfield plows first priority streets within four hours of the first call. Residential streets are plowed one lane at 4 or more inches of snow and two lanes at 12 or more inches.',
      },
      {
        id: 'trails', question: 'When are trails and sidewalks cleared?', sources: [SNOW_ROUTES], checked, checkAt: '2027-03-01',
        blocks: [
          { kind: 'p', text: 'Primary school routes and other high-use sidewalks are plowed as promptly as reasonably possible when there is **one inch of accumulation** on concrete surfaces, followed by recreational and less used sidewalks. Parking lots, sidewalks and entrances at all City and County facilities are cleared during any storm.' },
        ],
      },
    ],
  },
  // B5 (owner: yes).
  {
    slug: 'pay-water-bill',
    title: 'Pay Your Water Bill | {Site}',
    h1: 'Pay your Broomfield water and sewer bill online',
    description: "Pay Broomfield's water and sewer bill online through the city's payment portal, with no additional fees.",
    about: "How to pay the water and sewer bill, from the City and County of Broomfield's Pay a Bill Online page.",
    answers: [
      {
        id: 'pay', question: 'How do I pay my water and sewer bill?', sources: [PAY], checked, checkAt: '2027-03-01',
        blocks: [{ kind: 'p', text: 'Online, through the city\'s payment portal. Water/sewer bill payment is available online with **no additional fees**.' }],
        actions: [{ label: 'Pay the water bill', href: 'https://ipn.paymentus.com/cp/brm' }],
        faq: "Broomfield's water and sewer bill can be paid online through the city's payment portal with no additional fees.",
      },
    ],
  },
  // B1 (owner: build, do not publish until the 1 Dec re-read confirms 2026-27 sites and dates; if still undated, report instead).
  {
    slug: 'christmas-tree-recycling',
    draft: true,
    title: 'Christmas Tree Recycling 2026–27 | {Site}',
    h1: 'Broomfield Christmas tree recycling 2026–27: drop-off sites',
    description: 'Where to recycle a real Christmas tree in Broomfield after the holidays: the city drop-off sites, as the city publishes them for 2026–27.',
    about: "Broomfield's holiday tree drop-off, from the City and County of Broomfield's Holiday Tree Recycling page.",
    answers: [
      {
        id: 'where', question: 'Where do I recycle my Christmas tree?', sources: [TREES, BRANCH], checked, checkAt: '2026-12-01', unconfirmed: true,
        blocks: [
          { kind: 'p', text: 'The city says drop-off sites and dates for 2026-27 will be announced. Holiday trees only; no wreaths, garland, yard waste, tree branches or other wood products. The trees become free mulch for residents and Broomfield parks.' },
        ],
        actions: [{ label: "The city's holiday tree recycling page", href: TREES.url }],
      },
    ],
  },
];
