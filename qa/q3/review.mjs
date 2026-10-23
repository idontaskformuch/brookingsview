// QA Q3 -- the owner's checklist, the deterministic checks and the AI reviewer's prompt/parse.
// Pure functions (no browser, no network) so they can be unit-tested (site/src/lib/qa-q3.test.ts).
import { LITERAL_RE } from '../web/checks.mjs';

export const CHECKLIST = [
  { id: 1, key: 'literal', label: 'Leaked code / stray characters in visible text' },
  { id: 2, key: 'dates', label: 'Wrong or already-passed dates' },
  { id: 3, key: 'duplicate', label: 'Duplicated content (list vs detail page)' },
  { id: 4, key: 'old', label: 'Old content taking too much room' },
  { id: 5, key: 'image', label: 'Wrong image (other town / season / identifiable other place)' },
  { id: 6, key: 'empty', label: 'Empty headings' },
  { id: 7, key: 'abbr', label: 'Unclear abbreviations' },
  { id: 8, key: 'dense', label: 'Dense blocks of text' },
  { id: 9, key: 'mode', label: 'Problems in light/dark mode' },
  { id: 10, key: 'helps', label: 'Does the page help a resident? (data -> what it means -> what the reader can do)' },
];

const ABBR_ALLOW = new Set(['CC', 'BY', 'SA', 'US', 'USA', 'SD', 'CO', 'CA', 'UK', 'GB', 'SDSU', 'NWS', 'AM', 'PM', 'FAQ', 'ID', 'TV', 'PDF', 'RSS', 'API', 'USDA', 'DOT', 'HOA',
  'ICE', 'NYC', 'LA', 'DC', 'II', 'III', 'IV', 'VI', 'VII', 'VIII', 'IX', 'XI', 'XII', 'NCAA', 'FCS', 'PAC', 'EV', 'ADA', 'ER', 'ICO', 'GA', 'CDOT', 'ROV', 'MSP',
  'BST', 'GMT', 'CDT', 'CST', 'MDT', 'MST', 'PDT', 'PST', 'UV', 'WIFI', 'SUV', 'RV', 'LED', 'OK', 'NO', 'CEO', 'CFO', 'DJ', 'FM', 'AA', 'JR', 'SR', 'NW', 'NE', 'SW', 'SE',
  'GLASGOW', 'BROOKINGS', 'MORENO', 'VALLEY', 'BROOMFIELD', 'WITH', 'NEW', 'THE', 'AND', 'FOR', 'ALL', 'FREE', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);

const TOWN_TOKENS = { brookings_sd: 'brookings', moreno_valley_ca: 'moreno', broomfield_co: 'broomfield', glasgow: 'glasgow' };
const SEASON_WORDS = { winter: 'winter', autumn: 'autumn', fall: 'autumn', spring: 'spring', summer: 'summer' };

export function currentSeason(now, lat = 40) {
  const m = now.getUTCMonth() + 1;
  const north = lat >= 0;
  const s = m === 12 || m <= 2 ? 'winter' : m <= 5 ? 'spring' : m <= 8 ? 'summer' : 'autumn';
  if (north) return s;
  return { winter: 'summer', summer: 'winter', spring: 'autumn', autumn: 'spring' }[s];
}

export function sentencesOf(text) {
  return text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length >= 80);
}

/** Sentences (>= 80 chars) that appear on two or more different pages of the town. [{sentence, paths}] */
export function duplicateSentences(pages) {
  const seen = new Map();
  for (const p of pages) {
    for (const s of new Set(sentencesOf(p.text))) {
      const key = s.toLowerCase().replace(/\s+/g, ' ');
      if (!seen.has(key)) seen.set(key, { sentence: s, paths: [] });
      seen.get(key).paths.push(p.path);
    }
  }
  return [...seen.values()].filter((v) => new Set(v.paths).size >= 2);
}

const f = (check, severity, where, evidence, cause, source = 'det') => ({ check, severity, source, where, evidence, cause });

export function deterministicFindings(rec, { town, now, dup, season }) {
  const out = [];
  const L = rec.light?.facts; const D = rec.dark?.facts;
  if (!L) return out;
  // 1. literals (main + shell)
  const lits = new Set([...(L.mainText.match(LITERAL_RE) ?? []), ...((L.shellText ?? '').match(LITERAL_RE) ?? [])]);
  if (lits.size) out.push(f(1, 'high', rec.path, `visible: ${[...lits].join(', ')}`, 'template/JSX leftover or an unformatted value reaching the page'));
  // 6. empty headings
  for (const h of L.emptyHeadings ?? []) out.push(f(6, 'medium', rec.path, `heading "${h}" has no content under it`, 'section rendered with no data and no empty-state text'));
  // 8. dense text
  const longest = Math.max(0, ...(L.paragraphWords ?? [0]));
  if (longest > 110) out.push(f(8, 'low', rec.path, `a single paragraph of ${longest} words`, 'long generated or copied text without structure (split, add subheads or a list)'));
  // 9. contrast in either mode
  for (const [mode, r] of [['light', rec.light], ['dark', rec.dark]]) {
    const bad = r?.contrast ?? [];
    if (bad.length) out.push(f(9, 'medium', rec.path, `${bad.length} low-contrast element(s) in ${mode} mode, e.g. ${bad.slice(0, 2).map((b) => b.target).join(' | ')}`, 'colour token below WCAG AA on this background'));
  }
  // 5. images: broken, missing alt, other town in the file name, wrong season in the file name
  for (const im of L.images ?? []) {
    const name = (im.src || '').split('/').pop() || '';
    if (!im.ok) out.push(f(5, 'medium', rec.path, `image failed to load: ${name}`, 'missing asset or wrong path'));
    if (!im.alt) out.push(f(5, 'low', rec.path, `image without alt text: ${name}`, 'alt not set where the image is rendered'));
    for (const [t, tok] of Object.entries(TOWN_TOKENS)) {
      if (t !== town && name.toLowerCase().includes(tok)) out.push(f(5, 'high', rec.path, `image file "${name}" belongs to another town (${t})`, 'cross-town image pool or shared component picking the wrong pool'));
    }
    const m = name.toLowerCase().match(/(winter|autumn|fall|spring|summer)/);
    if (m && SEASON_WORDS[m[1]] !== season && /this-week|section|hero/i.test(im.src)) out.push(f(5, 'low', rec.path, `image "${name}" is a ${SEASON_WORDS[m[1]]} photo; it is ${season} now`, 'season pool not switched at the season boundary, or a repeat from another period'));
  }
  // 2. past dates in upcoming lists; 4. old items taking room
  const archive = /^\/(this-week\/[^/]+|events\/past|city-hall\/archive)\//.test(rec.path) || /archive|past/i.test(rec.path);
  const ts = (L.timestamps ?? []).map((t) => Date.parse(t)).filter(Number.isFinite);
  if (!archive && /^\/(today|events|whats-on|this-week)\/$/.test(rec.path)) {
    const past = ts.filter((t) => t < now.getTime() - 24 * 3600e3);
    if (past.length) out.push(f(2, 'medium', rec.path, `${past.length} dated item(s) on an upcoming list are more than a day in the past (oldest ${new Date(Math.min(...past)).toISOString().slice(0, 10)})`, 'list built at deploy time and not hidden in the browser, or a past item kept in the query'));
  }
  if (!archive) {
    const old = ts.filter((t) => t < now.getTime() - 30 * 24 * 3600e3);
    if (old.length > 5) out.push(f(4, 'low', rec.path, `${old.length} items dated more than 30 days ago on a main page`, 'archive content in a main listing (cap the list, link to an archive)'));
  }
  // 3. duplicates between this page and another page of the same town
  const mine = (dup ?? []).filter((d) => d.paths.includes(rec.path));
  if (mine.length) {
    const d = mine[0];
    out.push(f(3, 'low', rec.path, `${mine.length} sentence(s) also appear on ${[...new Set(mine.flatMap((x) => x.paths).filter((p) => p !== rec.path))].slice(0, 3).join(', ')}: "${d.sentence.slice(0, 140)}"`, 'same text rendered in a list and on its detail page (show a teaser, not the text)'));
  }
  // 7. abbreviations (hint only: the AI decides if they are unclear)
  const abbr = new Map();
  for (const m of L.mainText.matchAll(/\b[A-Z]{2,5}\b/g)) if (!ABBR_ALLOW.has(m[0])) abbr.set(m[0], (abbr.get(m[0]) ?? 0) + 1);
  if (abbr.size) out.push(f(7, 'low', rec.path, `all-caps terms: ${[...abbr.entries()].slice(0, 8).map(([k, n]) => `${k}${n > 1 ? `x${n}` : ''}`).join(', ')}`, 'source abbreviations shown unexpanded (normalise like normalizeSportTitle)'));
  return out;
}

export function buildReviewPrompt(rec, { town, cfg, now }) {
  const tz = cfg.timezone;
  const local = new Intl.DateTimeFormat('en-GB', { timeZone: tz, dateStyle: 'full', timeStyle: 'short' }).format(now);
  const system = [
    'You are the weekly page reviewer for a small network of local-information websites (one per town). You review ONE page type at a time,',
    'from phone screenshots in light and dark mode plus extracted facts, against the owner\'s checklist. Be concrete and honest:',
    '- report only what you can see in the screenshots or the extracted text; quote the exact visible text; never invent problems; if the page is fine say so;',
    '- each finding needs a SUGGESTED CAUSE in terms of the site\'s code/data/pipeline (e.g. "template leftover", "list built at deploy time", "image pool not switched for the season");',
    '- editorial rule: every page must help a resident understand or do something: data -> what it means -> what the reader can do. Lists are raw material, not the finished product;',
    '- US towns use US conventions; Glasgow (UK) uses British spelling, 24-hour-free "7pm" times and degrees Celsius -- do not flag those;',
    '- an image is wrong if it shows another town, the wrong season, a clearly different identifiable place (another university, readable shop signs, landmarks) or does not fit the page;',
    '- also say whether dark mode has unreadable text, invisible controls or wrong backgrounds.',
    'Checklist ids: ' + CHECKLIST.map((c) => `${c.id}=${c.label}`).join('; ') + '.',
    'Keep every string under 220 characters. Answer with JSON ONLY, no prose, no code fence: {"findings":[{"check":<1-10>,"severity":"high|medium|low","where":"<where on the page>","evidence":"<exact visible text or description>","cause":"<suggested cause>"}],"helps_resident":{"verdict":"yes|partly|no","why":"<one sentence>"}}. At most 8 findings, most important first.',
  ].join('\n');
  const L = rec.light?.facts ?? {};
  const hints = (rec.findings ?? []).map((x) => `- [check ${x.check}] ${x.evidence}`).join('\n') || '(none)';
  const user = [
    `Town: ${cfg.display_name} (${town}), country ${cfg.country ?? 'us'}. Local time now: ${local}.`,
    `Page: ${rec.url} (type: ${rec.kind}). Title: ${L.title}. H1: ${(L.h1 ?? []).join(' | ')}. Words in main: ${L.wordCount}.`,
    `Automatic checks already found (do not repeat them unless you add information):\n${hints}`,
    'Visible text of the main area (truncated):', (L.mainText ?? '').slice(0, 6500),
    `Images in main: ${(L.images ?? []).slice(0, 8).map((i) => `${(i.src || '').split('/').pop()} alt="${i.alt}"`).join('; ') || 'none'}`,
  ].join('\n');
  return { system, user };
}

/** Tolerant JSON extraction: strips code fences, and when the reply was cut off (max_tokens) or has a bad tail, keeps every
 *  complete object of the "findings" array instead of throwing the whole review away. Returns null when nothing is usable. */
export function extractJson(text) {
  const t = text.replace(/```(?:json)?/gi, '');
  const a = t.indexOf('{');
  if (a < 0) return null;
  const b = t.lastIndexOf('}');
  if (b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* repair below */ } }
  const fi = t.indexOf('"findings"', a);
  if (fi < 0) return null;
  const arrStart = t.indexOf('[', fi);
  if (arrStart < 0) return null;
  const findings = [];
  let depth = 0, objStart = -1, inStr = false, esc = false;
  for (let i = arrStart + 1; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') { if (depth === 0) objStart = i; depth++; }
    else if (c === '}') { depth--; if (depth === 0 && objStart >= 0) { try { findings.push(JSON.parse(t.slice(objStart, i + 1))); } catch { /* skip */ } objStart = -1; } }
    else if (c === ']' && depth === 0) break;
  }
  return findings.length ? { findings, _repaired: true } : null;
}

export function parseReview(text) {
  const data0 = extractJson(text);
  if (!data0) return [f(10, 'low', '-', 'AI reviewer returned no usable JSON', 'reviewer prompt/format problem', 'ai')];
  const data = data0;
  const out = [];
  for (const x of Array.isArray(data.findings) ? data.findings : []) {
    const check = Number(x.check);
    out.push(f(check >= 1 && check <= 10 ? check : 10, ['high', 'medium', 'low'].includes(x.severity) ? x.severity : 'low',
      String(x.where ?? '').slice(0, 160), String(x.evidence ?? '').slice(0, 400), String(x.cause ?? '').slice(0, 300), 'ai'));
  }
  const h = data.helps_resident;
  if (h && h.verdict && h.verdict !== 'yes') out.push(f(10, h.verdict === 'no' ? 'medium' : 'low', 'whole page', `Helps a resident: ${h.verdict}. ${String(h.why ?? '').slice(0, 300)}`, 'page is mostly raw list/data; add "what it means" and "what you can do"', 'ai'));
  return out;
}

/** Pair review (owner 2026-10-23): a LIST page and one of its DETAIL pages side by side. */
export function buildPairPrompt(listRec, detailRec, { town, cfg, now }) {
  const tz = cfg.timezone;
  const local = new Intl.DateTimeFormat('en-GB', { timeZone: tz, dateStyle: 'full', timeStyle: 'short' }).format(now);
  const todayIso = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
  const system = [
    'You review a LIST page and one of its DETAIL pages of a local-information website, side by side (phone screenshots + extracted text).',
    'Answer two questions, concretely and honestly, quoting visible text; never invent problems:',
    '1. DOES THE DETAIL PAGE ADD ANYTHING THE LIST LACKS? Compare what each page tells a resident. If the detail page mostly repeats text that is already on the list, say so and quote the repeated text;',
    '   say what, if anything, the detail page really adds (facts, context, what the reader can do) and what the list should show instead (a short teaser plus a link, not the text again).',
    `2. DOES OLD CONTENT TAKE TOO MUCH ROOM? Today is ${todayIso}. Say whether items dated well before today (past events, old weeks, expired notices) occupy a large share of either page above newer content or instead of it.`,
    'Answer with JSON ONLY: {"detail_adds":"yes|partly|no","adds":"<what the detail page adds, or what repeats>","list_should":"<what the list page should show instead>","old_content":{"too_much_room":true|false,"evidence":"<quote/dates>"},"findings":[{"check":3|4|10,"severity":"high|medium|low","where":"list|detail|both","evidence":"<exact text>","cause":"<suggested cause in the site\'s code/data/pipeline>"}]}. At most 5 findings.',
  ].join('\n');
  const L = listRec.light?.facts ?? {}; const D = detailRec.light?.facts ?? {};
  const user = [
    `Town: ${cfg.display_name} (${town}). Local time now: ${local}.`,
    `LIST page: ${listRec.url}  (words: ${L.wordCount})`, (L.mainText ?? '').slice(0, 5000),
    `DETAIL page: ${detailRec.url}  (words: ${D.wordCount})`, (D.mainText ?? '').slice(0, 5000),
  ].join('\n\n');
  return { system, user };
}

export function parsePairReview(text, listPath, detailPath) {
  const data = extractJson(text);
  if (!data) return { findings: [f(10, 'low', '-', 'pair reviewer returned no usable JSON', 'reviewer prompt/format problem', 'ai')], pair: null };
  const out = [];
  for (const x of Array.isArray(data.findings) ? data.findings : []) {
    const check = [3, 4, 10].includes(Number(x.check)) ? Number(x.check) : 10;
    const where = x.where === 'list' ? listPath : x.where === 'detail' ? detailPath : `${listPath} + ${detailPath}`;
    out.push(f(check, ['high', 'medium', 'low'].includes(x.severity) ? x.severity : 'low', where, String(x.evidence ?? '').slice(0, 400), String(x.cause ?? '').slice(0, 300), 'ai'));
  }
  if (data.detail_adds === 'no' || data.detail_adds === 'partly') {
    out.push(f(3, data.detail_adds === 'no' ? 'medium' : 'low', `${listPath} + ${detailPath}`, `Detail page adds ${data.detail_adds === 'no' ? 'nothing' : 'little'} beyond the list: ${String(data.adds ?? '').slice(0, 300)}`, String(data.list_should ?? 'show a teaser and a link').slice(0, 300), 'ai'));
  }
  if (data.old_content?.too_much_room === true) out.push(f(4, 'medium', `${listPath} + ${detailPath}`, `Old content takes too much room: ${String(data.old_content.evidence ?? '').slice(0, 300)}`, 'archive items in a main listing (cap the list, link to an archive)', 'ai'));
  return { findings: out, pair: { list: listPath, detail: detailPath, adds: data.detail_adds ?? null, summary: String(data.adds ?? '').slice(0, 400), listShould: String(data.list_should ?? '').slice(0, 300) } };
}
