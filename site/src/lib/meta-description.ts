/** Meta descriptions (owner 2026-11-03, Bing Webmaster Tools "meta description too short").
 *
 *  One template per page type, built only from the page's own data (town names, the item's name, its type). No AI text, no daily
 *  numbers (event counts etc.), so a description does not change between builds. The target is 120-160 characters and unique per
 *  page; fitDescription() is the safety net that trims at a word boundary or, when a template comes out short, appends the first
 *  filler that still fits. QA: web.description (qa/web/checks.mjs) flags a missing, <70 or >160 character description and a repeat
 *  within a town; meta-description.test.ts runs every template for all four towns. */
import { forCountry, placeAbbr, placeLabel, type PlaceFields } from './country-profile';

export const DESCRIPTION_MIN = 120;
export const DESCRIPTION_MAX = 160;

export interface DescFields extends PlaceFields {
  siteName: string;
}

const END = /[.!?]$/;

/** Cut `text` to at most `max` characters: at the last sentence end that leaves `min`+ characters, else at a word boundary. */
function trimTo(text: string, max: number, min: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max + 1);
  const room = text.slice(0, max); // leaves one character for a closing period
  const sentence = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  if (sentence + 1 >= min) return head.slice(0, sentence + 1);
  const space = room.lastIndexOf(' ');
  const cut = (space > 0 ? room.slice(0, space) : room).replace(/[\s,;:–—-]+$/, '');
  // A word cut is marked as one ("…"), never dressed up as a sentence with a period (2026-11-11).
  return END.test(cut) ? cut : `${cut}…`;
}

// A period after these is not a sentence end ("225 Commerce St. in", "J. Smith").
const ABBREVIATIONS = /(?:^|\s)(?:[A-Z]|St|Ave|Blvd|Rd|Dr|Mt|Ft|Inc|Co|Corp|Ltd|Jr|Sr|No|U\.S|vs|approx|e\.g|i\.e)\.$/;

/** The longest run of whole sentences from the start of `text` that fits in `max` characters, or null when even the first sentence
 *  is longer (Broomfield AdSense plan F6, 2026-11-11: descriptions were cut mid-sentence and given a period, "...Manager George Di."). */
export function wholeSentences(text: string, max: number): string | null {
  let best: string | null = null;
  const end = /[.!?]["')]?(?=\s|$)/g;
  for (let m = end.exec(text); m && m.index < max; m = end.exec(text)) {
    const candidate = text.slice(0, m.index + m[0].length);
    if (candidate.length > max) break;
    if (m[0] === '.' && ABBREVIATIONS.test(candidate)) continue;
    best = candidate;
  }
  return best;
}

/** 120-160 characters: a long text keeps its whole sentences that fit, a short one gets the first filler sentences that fit; only a
 *  text with no sentence end inside 160 characters is cut at a word. */
export function fitDescription(raw: string, fillers: string[] = []): string {
  // " -- " is a typewriter stand-in for a dash (style rule; source texts still carry it)
  let t = raw.replace(/\s+/g, ' ').replace(/ -- /g, ' — ').trim();
  if (t.length > DESCRIPTION_MAX) t = wholeSentences(t, DESCRIPTION_MAX) ?? t;
  for (const f of fillers) {
    if (t.length >= DESCRIPTION_MIN) break;
    const joined = `${END.test(t) ? t : `${t}.`} ${f}`;
    if (joined.length <= DESCRIPTION_MAX) t = joined;
  }
  return trimTo(t, DESCRIPTION_MAX, DESCRIPTION_MIN);
}

const TEMPLATES: Record<string, (c: DescFields) => string> = {
  home: (c) => `${c.siteName} is a local news site for ${placeLabel(c)}: events, council meetings, weather, closures and public places, with sources linked.`,
  about: (c) => `About ${c.siteName}: who runs this local site for ${placeLabel(c)}, how its pages are made and checked, the sources it uses and how to reach us.`,
  contact: (c) => `Contact ${c.siteName}: report a correction, tell us about an event we missed, or get in touch with the team behind the local pages for ${c.cityName}.`,
  privacy: (c) => `What ${c.siteName} collects about visitors, how comments and polls, advertising and analytics work, and what happens to anything you email us.`,
  terms: (c) => `The terms for using ${c.siteName}: what the site is, how accurate to expect it to be, rules for comments and polls, advertising and links to other sites.`,
  cookies: (c) => `Which cookies and browser storage ${c.siteName} uses for security, analytics and advertising, and how to change your cookie choice at any time.`,
  corrections: (c) => `A public record of corrections made on ${c.siteName}: what was wrong, what was fixed and when, and how to report a mistake on a ${c.cityName} page.`,
  advertising: (c) => `How sponsorship and advertising work on ${c.siteName}: what we accept, what we never do, how ads are labeled and how to ask about a placement.`,
  'editorial-policy': (c) => `How ${c.siteName} is written, which automated fact-checks every item must pass before it publishes, and how a mistake is corrected.`,
  'how-we-gather': (c) => `Every source ${c.siteName} draws from for ${c.cityName}, how often they are checked, and what the software works out itself.`,
  today: (c) => `What is happening today in ${placeAbbr(c)}: the weather, ${forCountry(c.country, 'school and road alerts', 'travel and weather warnings')}, events and anything that changes your day.`,
  events: (c) => `Events in ${placeLabel(c)} this week and beyond: library programs, city events and community happenings, with dates, times and where to go.`,
  facilities: (c) => `Addresses, phone numbers and opening hours for libraries, parks, city offices and other public places in ${placeAbbr(c)}, with a page for each.`,
  'city-hall': (c) => `${forCountry(c.country, 'City council and committee', 'Council and committee')} meetings in ${placeLabel(c)}: what is on the agenda, what was decided and what comes next.`,
  'city-hall-archive': (c) => `Every past council and committee meeting covered in ${placeLabel(c)}, grouped by month, each with its agenda items and a link to the agenda.`,
  weather: (c) => `The forecast, weather alerts and current conditions for ${placeLabel(c)}, from the official weather source and updated through the day.`,
  closures: (c) => `Official school and weather closure status for ${c.cityName}, taken from the source and never a prediction, with the time it was last checked.`,
  traffic: (c) => `Road incidents, lane closures and construction affecting ${placeAbbr(c)}, from the official road-condition source, with the time it was last updated.`,
  tonight: (c) => `Things to do tonight and tomorrow night in ${c.cityName}: live music, comedy, quiz nights and more, with start times and venues for each.`,
  'this-weekend': (c) => `Things to do this weekend in ${c.cityName}: Friday night, Saturday and Sunday, with start times and venues for each, from official listings.`,
  projects: (c) => `Real development and civic projects in ${placeAbbr(c)}, tracked from proposal through the meetings that decide them, with the latest status of each.`,
  'month-index': (c) => `Every monthly recap of ${placeAbbr(c)}, oldest to newest: city decisions, projects, home sales and events for each month, from public data.`,
  'workplace-watch': (c) => `Job postings counted each month for the major employers around ${c.cityName}, with the change since last month and the source of the count.`,
  'this-week-week': (c) => `A day-by-day look at ${placeAbbr(c)} for this week: council meetings, events and sports, so you can plan the days ahead.`,
};

export type DescriptionKind = keyof typeof TEMPLATES;
export const DESCRIPTION_KINDS = Object.keys(TEMPLATES);

/** The description for a fixed page type, fitted to 120-160 characters. */
export function metaDescription(kind: DescriptionKind, c: DescFields): string {
  const t = TEMPLATES[kind];
  if (!t) throw new Error(`no meta description template for "${kind}"`);
  return fitDescription(t(c), [`Local information for ${placeLabel(c)}.`, `Plan ahead with ${c.siteName}.`]);
}

/** Facility detail page: its own curated description if it has one (trimmed at a sentence or word), else the name + address template. */
export function facilityDescription(c: DescFields, f: { name: string; description?: string | null; street_address?: string | null; address?: string | null }): string {
  const where = f.street_address ?? f.address;
  const curated = f.description?.trim();
  // Curated texts are sometimes identical across facilities of one kind ("Fire station ..."): lead with the name so each page is unique.
  // Longest first; the first that fits whole is used, so a long name or address gets a shorter sentence instead of a word cut.
  const template = [
    `${f.name} in ${placeAbbr(c)}${where ? `, ${where}` : ''}: address, phone number and opening hours, with upcoming events and a link to the official page where there is one.`,
    `${f.name} in ${placeAbbr(c)}${where ? `, ${where}` : ''}: address, phone number and opening hours, with a link to the official page.`,
    `${f.name} in ${placeAbbr(c)}${where ? `, ${where}` : ''}: address, phone number and opening hours.`,
    `${f.name}, ${placeAbbr(c)}: address, phone number and opening hours.`,
    `${f.name}: address, phone number and opening hours.`,
  ].find((s) => s.length <= DESCRIPTION_MAX) ?? `${f.name}.`;
  const named = curated ? (curated.toLowerCase().includes(f.name.toLowerCase()) ? curated : `${f.name}: ${curated}`) : null;
  // A curated text whose first sentence alone is too long would only come out as a fragment: the template is a whole sentence.
  const base = named && (named.length <= DESCRIPTION_MAX || wholeSentences(named, DESCRIPTION_MAX)) ? named : template;
  return fitDescription(base, [
    `Address, phone number and hours for ${f.name} in ${placeAbbr(c)}.`,
    `Address, phone number and hours in ${placeAbbr(c)}.`,
    'Hours and address.',
  ]);
}

/** True when fitDescription() could only cut `text` at a word (no sentence end within 160 characters). */
export function isWordCut(text: string): boolean {
  return text.endsWith('…');
}

/** Development project page: the project's own text when whole sentences of it fit, else a whole-sentence template (2026-11-11:
 *  planning texts whose first sentence alone runs past 160 characters ended in a word cut). */
export function projectDescription(c: DescFields, p: { title: string; description?: string | null }): string {
  const own = p.description ? fitDescription(p.description) : '';
  if (own && !isWordCut(own)) return own;
  return [
    `${p.title} in ${placeAbbr(c)}: what is proposed, where it stands and what was decided, from city records.`,
    `${p.title}: what is proposed, where it stands and what was decided.`,
    `${p.title}.`,
  ].find((s) => s.length <= DESCRIPTION_MAX) ?? fitDescription(p.title);
}

/** Default fillers for a hand-written description that came out short. */
export function descriptionFillers(c: DescFields): string[] {
  return [`Local information for ${placeLabel(c)}.`, `Plan ahead with ${c.siteName}.`];
}

/** Monthly recap page: the label ("August 2026") is the page's own period. */
export function monthDescription(c: DescFields, label: string): string {
  return fitDescription(
    `A recap of ${placeAbbr(c)} for ${label}: city hall decisions, development projects, home sales, events, traffic and jobs, from public data.`,
    descriptionFillers(c),
  );
}

/** Weekly page ("week of Oct 19"): the label is the page's own date range. */
export function weekDescription(c: DescFields, weekLabel: string, withUniversity: boolean): string {
  return fitDescription(
    `A day-by-day look at ${placeAbbr(c)} for the week of ${weekLabel}: council meetings, events${withUniversity ? ', SDSU' : ''} and sports, so you can plan the days ahead.`,
    [`Local information for ${placeLabel(c)}.`, `Plan ahead with ${c.siteName}.`],
  );
}
