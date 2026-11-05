/** Per-town configuration of the /city-hall/ meetings page (.claude/standards.md, Meetings). The layout code never branches on a town: everything
 *  that differs is here. A town is on the structured page only when it has an entry.
 *
 *  BODIES: exact match on the source's own organ string (whitespace collapsed). An organ that is not listed falls back to its own name, so a new
 *  body shows up rather than vanishing; the QA check "unknown organ in the database" (qa/checks.json) lists them. Different organs are never
 *  merged. Last full check against the database: 2026-11-05 (Brookings 134 rows, Broomfield 40, Moreno Valley 36, Glasgow 58). */
import type { BodyInfo, MeetingsTownConfig } from '../lib/meetings-view';
import { GLASGOW_MEETINGS } from './gb/meetings-glasgow';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/* ------------------------------------------------------------ Brookings */

const BROOKINGS_BODIES: Record<string, BodyInfo> = {
  'City Council': { key: 'city-council', label: 'City Council', tone: 'council' },
  'Commission': { key: 'county-commission', label: 'County Commission', tone: 'council' },
  'Planning Commission': { key: 'planning-commission', label: 'Planning Commission', tone: 'planning' },
  'Planning & Zoning Commission': { key: 'county-planning-zoning', label: 'County Planning & Zoning Commission', tone: 'planning' },
  'Joint Board of Adjustment': { key: 'joint-board-of-adjustment', label: 'Joint Board of Adjustment', tone: 'planning' },
  'Brookings County/City of Brookings Joint Board of Adjustment': { key: 'joint-board-of-adjustment', label: 'Joint Board of Adjustment', tone: 'planning' },
  'Brookings Historic Preservation Commission': { key: 'historic-preservation', label: 'Historic Preservation Commission', tone: 'planning' },
  'Utility Board': { key: 'utility-board', label: 'Utility Board', tone: 'utilities' },
  'Airport Board': { key: 'airport-board', label: 'Airport Board', tone: 'other' },
  'Brookings Disability Awareness Committee': { key: 'disability-awareness', label: 'Disability Awareness Committee', tone: 'other' },
  'Brookings Health System Board of Trustees': { key: 'health-system-board', label: 'Health System Board of Trustees', tone: 'other' },
  'Brookings Public Arts Commission': { key: 'public-arts', label: 'Public Arts Commission', tone: 'other' },
  'Dacotah Bank Center Advisory Board': { key: 'dacotah-bank-center', label: 'Dacotah Bank Center Advisory Board', tone: 'other' },
  'East Central Communications Council (E-911)': { key: 'e911', label: 'East Central Communications Council (E-911)', tone: 'other' },
  'Human Rights Commission': { key: 'human-rights', label: 'Human Rights Commission', tone: 'other' },
  'Library Board': { key: 'library-board', label: 'Library Board', tone: 'other' },
  'Park & Recreation Advisory Board': { key: 'park-rec-board', label: 'Park & Recreation Advisory Board', tone: 'other' },
  'Sustainability Council': { key: 'sustainability-council', label: 'Sustainability Council', tone: 'other' },
  // Added 2026-11-05: in the database but missing from this table (they fell back to their own name, tone other).
  'Brookings County 765kV Transmission Line Advisory Committee': { key: 'county-transmission-line-advisory', label: 'County 765kV Transmission Line Advisory Committee', tone: 'other' },
  'Brookings County Housing & Redevelopment Commission': { key: 'county-housing-redevelopment', label: 'County Housing & Redevelopment Commission', tone: 'other' },
  'Brookings County Outdoor Adventure Center Advisory Board': { key: 'county-outdoor-adventure-center', label: 'County Outdoor Adventure Center Advisory Board', tone: 'other' },
  'Weed & Pest Board': { key: 'weed-pest-board', label: 'Weed & Pest Board', tone: 'other' },
  'Extension Board': { key: 'extension-board', label: 'Extension Board', tone: 'other' },
  'Local Emergency Planning Committee': { key: 'local-emergency-planning', label: 'Local Emergency Planning Committee', tone: 'other' },
};

/* ------------------------------------------------------------ Broomfield */

// AgendaLink names the meeting type, not the organ: every row is the City Council. One organ plus a type label.
const council = (type: string, closed = false): BodyInfo => ({ key: 'city-council', label: 'City Council', tone: 'council', type, ...(closed ? { closed: true } : {}) });
const BROOMFIELD_BODIES: Record<string, BodyInfo> = {
  'City Council Regular Meeting': council('Regular'),
  'City Council Study Session': council('Study session'),
  'City Council Special Meeting': council('Special'),
  'City Council Executive Session': council('Executive session', true),
  'City Council Transition Meeting': council('Transition'),
  'City Council Workshop': council('Workshop'),
};

/* --------------------------------------------------------- Moreno Valley */

const MORENO_BODIES: Record<string, BodyInfo> = {
  'City Council Regular Meeting': council('Regular'),
  'Closed Session City Council Meeting': council('Closed session', true),
  'Study Session City Council Meeting': council('Study session'),
  'City Council Special Meeting': council('Special'),
  'Planning Commission': { key: 'planning-commission', label: 'Planning Commission', tone: 'planning' },
};

/* ---------------------------------------------------------------- towns */

export const MEETINGS_TOWNS: Record<string, MeetingsTownConfig> = {
  brookings_sd: {
    bodies: BROOKINGS_BODIES,
    hidden: [],
    groupRules: [],
    collapsedGroups: [],
    topicLabels: true,
    locale: 'us',
    comment: { href: '/how-city-council-works/', bodyKeys: ['city-council'] },
    place: { locality: 'Brookings', region: 'SD', country: 'US' },
    authority: 'City of Brookings',
    portal: null,
    extraLinks: [
      { lead: 'New to following the council?', href: '/how-city-council-works/', label: 'How it works, how to watch and how to speak →' },
      { lead: 'Garbage, recycling and yard waste:', href: '/trash-recycling/', label: 'pickup days and what goes where →' },
    ],
    emptyNote: null,
  },
  broomfield_co: {
    bodies: BROOMFIELD_BODIES,
    hidden: [],
    groupRules: [],
    collapsedGroups: [],
    topicLabels: true,
    locale: 'us',
    comment: null,
    place: { locality: 'Broomfield', region: 'CO', country: 'US' },
    authority: 'City and County of Broomfield',
    // The city's own public page for council agendas (it points to the agenda portal). AgendaLink's own API only returns a sandbox host, which the
    // site never links (lib/sandbox-url.ts); verified 2026-11-05 with one read of this page.
    portal: { href: 'https://broomfield.org/4079/Broomfield-Council-Meetings', label: 'Council agendas on broomfield.org' },
    extraLinks: [],
    emptyNote: null,
  },
  moreno_valley_ca: {
    bodies: MORENO_BODIES,
    hidden: [],
    groupRules: [],
    collapsedGroups: [],
    topicLabels: true,
    locale: 'us',
    comment: null,
    place: { locality: 'Moreno Valley', region: 'CA', country: 'US' },
    authority: 'City of Moreno Valley',
    portal: { href: 'https://pub-morenovalley.escribemeetings.com/', label: 'Meetings and agendas on eSCRIBE' },
    extraLinks: [],
    // eSCRIBE publishes a meeting 4-7 days before it (our own data: council 4-5 days, planning commission 6-7), so an empty list is the normal state between meetings.
    emptyNote: 'Moreno Valley usually posts agendas 4–7 days ahead.',
  },
  glasgow: GLASGOW_MEETINGS,
};
