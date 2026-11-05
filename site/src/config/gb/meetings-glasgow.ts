/** Glasgow's meetings table (British spelling lives under config/gb/, see american-spelling.test.ts). Same shape and rules as config/meetings.ts. */
import type { BodyInfo, MeetingsTownConfig } from '../../lib/meetings-view';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const GLASGOW_GROUPS = {
  council: 'Council and committees',
  planning: 'Planning',
  licensing: 'Licensing',
  health: 'Health and care',
  areas: 'Area Partnerships',
} as const;

/** Chips are per GROUP, not per organ (standards: max 6 colours/categories per page type, no colour per organ). */
const g = (group: string, tone: BodyInfo['tone'], names: string[]): Record<string, BodyInfo> =>
  Object.fromEntries(names.map((n) => [n, { key: slug(n), label: n, tone, group }]));
const GLASGOW_BODIES: Record<string, BodyInfo> = {
  ...g(GLASGOW_GROUPS.council, 'council', [
    'Glasgow City Council', 'City Administration Committee', 'Contracts and Property Committee', 'Finance and Audit Scrutiny Committee',
    'Operational Performance and Delivery Scrutiny Committee',
    'Wellbeing, Equalities, Communities, Culture and Engagement City Policy Committee',
    'Economy, Housing, Transport and Regeneration City Policy Committee',
    'Net Zero and Climate Progress Monitoring City Policy Committee',
    'Environment and Liveable Neighbourhoods City Policy Committee',
    'Education, Skills and Early Years City Policy Committee',
    'Glasgow City Region Cabinet', 'Strathclyde Pension Fund Committee', 'Safe Glasgow Partnership',
  ]),
  ...g(GLASGOW_GROUPS.planning, 'planning', ['Planning Applications Committee', 'Planning Local Review Committee']),
  ...g(GLASGOW_GROUPS.licensing, 'other', ['Licensing and Regulatory Committee', 'Licensing Board']),
  ...g(GLASGOW_GROUPS.health, 'other', [
    'Glasgow City Integration Joint Board', 'Glasgow City IJB Finance, Audit and Scrutiny Committee', 'Glasgow City IJB Public Engagement Committee',
  ]),
};

export const GLASGOW_MEETINGS: MeetingsTownConfig = {
  bodies: GLASGOW_BODIES,
  // Employment/personnel negotiation: hidden like the Personnel Appeals Committee (which the scraper never stores).
  hidden: ['Local Negotiating Committee for Teaching Staff'],
  groupRules: [{ test: /Area Partnership$/, group: GLASGOW_GROUPS.areas, tone: 'other' }],
  collapsedGroups: [GLASGOW_GROUPS.areas],
  topicLabels: false,
  locale: 'gb',
  comment: null,
  place: { locality: 'Glasgow', region: 'Scotland', country: 'GB' },
  authority: 'Glasgow City Council',
  portal: { href: 'https://onlineservices.glasgow.gov.uk/councillorsandcommittees/', label: 'Councillors and committees on glasgow.gov.uk' },
  extraLinks: [],
  emptyNote: null,
};
