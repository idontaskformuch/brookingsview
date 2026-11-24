#!/usr/bin/env node
/**
 * Owner rule 2026-11-07 (all four towns): no empty-state messages and no explanation boxes on content pages.
 * Reads the real `dist/` of an `astro build` and fails on any page that contains one of the banned phrases:
 * "Nothing scheduled", "No weather alerts", "No wildfires" (and their siblings) or the old explanation box headings
 * ("What this shows", "How to use it" as a box heading). /how-we-gather-this/ is the one page where the per-page
 * explanations now live, so the headings are allowed there.
 *
 * /traffic/'s former "No crashes or closures reported ..." line (F4, 2026-11-11) is gone: the owner ruled 2026-11-15 that the page shows
 * no empty message in any town (lib/traffic-verdict.ts), so its wording is in EMPTY.
 *
 * Owner 2026-11-24 (all four towns): no empty-state text anywhere. Besides the phrases, any element with class `empty` or a BEM
 * `__empty` class fails the build (QA build.empty-state, fixture tests/fixtures/qa_empty_states_2026-11-24: real Broomfield pages
 * built at 66dcd830, among them /this-week/2026-w48/ with "A quiet week").
 *
 * Two more checks on the same real build:
 *  - a town without a /traffic/ page (no dist/traffic/index.html: no traffic source) has no link to /traffic/ anywhere (owner 2026-11-07);
 *  - no page mentions a domain on scripts/blocked-domains.json (a hijacked or unsafe domain);
 *  - no "Not confirmed" / "Page lists no year" status text (holiday rows, F9 2026-11-11);
 *  - none of the earlier AI statements (STALE_AI_CLAIMS, owner B6 2026-11-11), also in llms.txt;
 *  - an indexed /traffic/ has at least one incident row (data-traffic-row: current or "Earlier this week") under its heading
 *    (QA build.traffic-empty, owner 2026-11-15: an indexed page is never without content under the heading);
 *  - an indexed /traffic/ has the hero (a fresh read) or the out-of-date line (no fresh read): its rows never stand without saying
 *    which read they come from (audit Fas 6a, owner 2026-11-16);
 *  - no "About this page" box is a heading with nothing under it (Broomfield AdSense plan F5, 2026-11-11: /election-results/'s slot held
 *    only an optional notice that Broomfield does not have).
 *
 * Usage: node scripts/verify_no_empty_messages.mjs <dist-dir>
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const dist = process.argv[2];
if (!dist) { console.error('Usage: node scripts/verify_no_empty_messages.mjs <dist-dir>'); process.exit(2); }

const EMPTY = [
  'Nothing scheduled', 'No weather alerts', 'No weather warnings', 'No wildfires', 'No active weather alerts', 'No incidents in',
  'Nothing on the calendar', 'No marquee events', 'Nothing else listed', 'No alerts or traffic incidents', 'No current air-quality reading',
  'No crashes or closures reported', 'road feed has not been read since',
  // Owner 2026-11-24 (all towns): no empty-state text at all; an empty section is left out and the page leads with what it has.
  // The wordings removed that day, matched on the page's visible text (EMPTY_TEXT), plus the markup rule in emptyMarkup().
  'A quiet week', 'No past meetings recorded', 'No meetings scheduled at the moment', 'No meeting updates recorded',
  'No projects tracked yet', 'No corrections have been logged', 'No past events recorded', 'No facility information available',
  'Prices are not available right now', 'No sales recorded', 'No digests published yet', 'No job listings available',
  'listings available right now', 'No structured data cleared', 'No months published yet', 'No confirmed openings or closings',
  'No games scheduled right now', 'No upcoming events listed', 'No earlier weeks yet', 'No Vail Resorts news collected',
  'Nothing found in the area', 'No reviews summarized', 'No comments yet', 'Schools are open', 'No meetings posted yet',
  'The forecast is not available', "We have not read the City's list", 'Nothing else on tonight', 'Nothing else scheduled',
  'Nothing is listed for', 'are listed right now', 'listed this week — check back', 'Nothing this weekend', 'Nothing today',
];
/** Owner 2026-11-24: an element whose class is `empty` or a BEM `__empty` (the markup every empty-state line used) never ships,
 *  whatever its wording. Returns the first such class, or null. */
function emptyMarkup(html) {
  for (const [, cls] of html.matchAll(/\sclass="([^"]*)"/g)) {
    const hit = cls.split(/\s+/).find((t) => t === 'empty' || /__empty$/.test(t));
    if (hit) return hit;
  }
  return null;
}
/** The page's visible text (no script/style, tags out, common entities decoded), so "City's" matches "City&#39;s". */
function visibleText(html) {
  return html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&#39;|&#x27;|&apos;|&rsquo;/g, "'").replace(/&mdash;|&#8212;/g, '—').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
}
// Broomfield AdSense plan F9 (2026-11-11): a holiday row whose notice is not out yet is a plain link to the place's page
// (lib/holiday-view.ts), never a "Not confirmed" status, and no row says its source "lists no year".
const UNCONFIRMED = ['Not confirmed', 'Page lists no year'];
// Owner B6 (2026-11-11): the site's AI statement is site/src/lib/ai-disclosure.ts. These earlier wordings were false (place and
// project descriptions, page text and event/meeting details come from a model) or promised a source check that is not done yet.
const STALE_AI_CLAIMS = [
  'No other text on the site is written by an AI model', 'No text on this site is written by an AI model',
  'no model-written text', 'No model-written text', 'Text written by an AI model is not shown', 'we check them against those pages',
];
const BOX = ['What this shows', 'How to use it'];
const EXPLAINER_PAGE = '/how-we-gather-this/';
const BLOCKED = JSON.parse(readFileSync(new URL('./blocked-domains.json', import.meta.url), 'utf8')).domains;
const hasTrafficPage = existsSync(join(dist, 'traffic', 'index.html'));
const TRAFFIC_LINK = /href=["']\/traffic\/?["'#?]/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.html')) out.push(p);
  }
  return out;
}

/** The body of components/ui/AboutThisPage.astro (div.ui-about__body) has no visible text. */
function emptyAboutBox(html) {
  const m = html.match(/<section[^>]*data-about-this-page[^>]*>[\s\S]*?<div[^>]*class="ui-about__body[^"]*"[^>]*>([\s\S]*?)<\/section>/);
  return !!m && m[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;|\s+/g, '').length === 0;
}

/** Owner 2026-11-11: a holiday page in its standing (timeless) mode (data-holiday-mode="timeless", components/HolidayPage.astro)
 *  says what the day is, what is normally closed and the next date -- never that something happened. Returns the first
 *  past-tense word between the H1 and the About box, or null. */
const PAST_TENSE = /\b(was|were|ran|held|provided|took place|happened)\b/i;
function timelessPastTense(html) {
  if (!html.includes('data-holiday-mode="timeless"')) return null;
  const start = html.search(/<h1[\s>]/);
  const end = html.indexOf('data-about-this-page');
  const text = html.slice(Math.max(0, start), end > start ? end : undefined)
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
  return text.match(PAST_TENSE)?.[0] ?? null;
}

/** Owner 2026-11-11: the hero of a holiday page says its weekday once ("Veterans Day is Thursday, Nov 11, 2027", not
 *  "Thursday" over "Thursday, Nov 11, 2027"). Returns the repeated weekday, or null. */
const WEEKDAY = /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/g;
function heroRepeatsWeekday(html) {
  if (!html.includes('class="hp-title"')) return null;
  const m = html.match(/<div class="ui-hero[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  if (!m) return null;
  const seen = new Set();
  for (const [day] of m[1].replace(/<[^>]+>/g, ' ').matchAll(WEEKDAY)) {
    if (seen.has(day)) return day;
    seen.add(day);
  }
  return null;
}

const bad = [];
let pages = 0;
for (const file of walk(dist)) {
  pages++;
  const url = '/' + relative(dist, file).split(sep).join('/').replace(/index\.html$/, '');
  const html = readFileSync(file, 'utf8');
  const text = visibleText(html);
  for (const phrase of EMPTY) if (html.includes(phrase) || text.includes(phrase)) bad.push(`${url}: empty message "${phrase}"`);
  const emptyClass = emptyMarkup(html);
  if (emptyClass) bad.push(`${url}: empty-state markup class="${emptyClass}"`);
  if (!hasTrafficPage && TRAFFIC_LINK.test(html)) bad.push(`${url}: link to /traffic/ but this town has no traffic page`);
  for (const b of BLOCKED) if (html.toLowerCase().includes(b.domain)) bad.push(`${url}: blocked domain ${b.domain} (${b.reason})`);
  if (url !== EXPLAINER_PAGE) for (const phrase of BOX) if (html.includes(phrase)) bad.push(`${url}: explanation box "${phrase}"`);
  for (const phrase of UNCONFIRMED) if (html.includes(phrase)) bad.push(`${url}: status text "${phrase}"`);
  for (const phrase of STALE_AI_CLAIMS) if (html.includes(phrase)) bad.push(`${url}: old AI statement "${phrase}"`);
  if (url === '/traffic/' && !/<meta\s+name="robots"\s+content="noindex/i.test(html) && !html.includes('data-traffic-row=')) {
    bad.push(`${url}: indexed with no incident row under the heading`);
  }
  if (url === '/traffic/' && !/<meta\s+name="robots"\s+content="noindex/i.test(html)
    && !html.includes('data-traffic-hero') && !html.includes('data-traffic-stale')) {
    bad.push(`${url}: indexed with neither the hero nor the out-of-date line`);
  }
  if (emptyAboutBox(html)) bad.push(`${url}: "About this page" heading with no text under it`);
  const past = timelessPastTense(html);
  if (past) bad.push(`${url}: standing holiday page says "${past}" (past tense)`);
  const twice = heroRepeatsWeekday(html);
  if (twice) bad.push(`${url}: holiday hero says "${twice}" twice`);
}
const llms = join(dist, 'llms.txt');
if (existsSync(llms)) {
  const txt = readFileSync(llms, 'utf8');
  for (const phrase of STALE_AI_CLAIMS) if (txt.includes(phrase)) bad.push(`/llms.txt: old AI statement "${phrase}"`);
}
if (bad.length) { console.error(bad.join('\n')); console.error(`FAIL: ${bad.length} banned phrase(s) in ${pages} pages`); process.exit(1); }
console.log(`OK: no empty messages or explanation boxes in ${pages} pages.`);
