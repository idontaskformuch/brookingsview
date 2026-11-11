/**
 * Owner rule 2026-11-11 (all towns, all page types): content comes straight after the H1. No explanation of sources, method or "how this page
 * works" between the H1 and the first content block; that text lives in <AboutThisPage slot="about"> at the bottom of the page.
 *
 * `findIntroText(html, path)` returns the paragraphs (text >= MIN_CHARS) found between the first </h1> inside <main> and the first content
 * block (heading, list, table, form, card/grid/row container, image, ...), minus the allow-list below. An empty list = the page passes.
 *
 * Allow-list (owner 2026-11-11):
 *  - data rows that sit with the content: freshness stamps ("Last checked", "Updated"), the /vote status line, the /sports season line,
 *    "Unofficial results" on /election-results (a status label, not an explanation);
 *  - page types where the first paragraph IS the content (`intro` = the weekly story's own summary on /this-week/<week>): policy pages, error/offline pages, meeting notices on story pages, facility and
 *    project descriptions, event-detail meta lines, the holiday insight lines, /winter-guide's "short version".
 */
export const MIN_CHARS = 30;

/** Paragraph classes that are data rows or content, wherever they appear. */
export const ALLOWED_CLASSES = new Set([
  'cw-checked', 'wx-meta', 'vote-lead', 'season-status', 'er-unofficial', 'story__passed-notice', 'byline', 'ui-insight', 'hp-state',
  'lede__meta', 'desc', 'location', 'description', 'kicker', 'empty', 'ui-hero__meta', 'today-block__forecast', 'intro',
  'traffic-status',
]);

/** Pages whose opening text is the content itself (exact paths). */
export const ALLOWED_PAGES = [
  '/about/', '/advertising/', '/terms/', '/privacy/', '/cookies/', '/corrections/', '/editorial-policy/', '/how-we-gather-this/',
  '/how-city-council-works/', '/contact/', '/offline/', '/winter-guide/', '/404.html',
];
/** Detail pages (story, event, project, facility): the text under the H1 is the item's own description or notice. The index pages are still checked. */
export const ALLOWED_DETAIL_PREFIXES = ['/s/', '/whats-on/', '/city-hall/projects/', '/facilities/'];

const BLOCK_TAGS = new Set(['h2', 'h3', 'table', 'ul', 'ol', 'dl', 'form', 'details', 'nav', 'article', 'section', 'figure', 'svg', 'button', 'img', 'iframe', 'canvas', 'aside']);
const BLOCK_CLASS = /(grid|card|list|row|tile|strip|banner|widget)/;

function isAllowedPath(path) {
  return ALLOWED_PAGES.includes(path) || ALLOWED_DETAIL_PREFIXES.some((p) => path.startsWith(p) && path !== p);
}

const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

export function findIntroText(html, path) {
  if (isAllowedPath(path)) return [];
  const mainStart = html.indexOf('<main');
  if (mainStart < 0) return [];
  const main = html.slice(mainStart);
  const h1 = main.search(/<h1[\s>]/);
  if (h1 < 0) return [];
  const afterH1 = main.indexOf('</h1>', h1);
  if (afterH1 < 0) return [];
  const rest = main.slice(afterH1 + 5);
  const found = [];
  const tag = /<(\/?)([a-z][a-z0-9-]*)([^>]*)>/gi;
  let m;
  while ((m = tag.exec(rest))) {
    const [, close, name, attrs] = m;
    if (close) continue;
    const lower = name.toLowerCase();
    const cls = /class="([^"]*)"/.exec(attrs)?.[1] ?? '';
    if (lower === 'p') {
      const end = rest.indexOf('</p>', tag.lastIndex);
      if (end < 0) break;
      const body = text(rest.slice(tag.lastIndex, end));
      const classes = cls.split(/\s+/).filter(Boolean);
      if (body.length >= MIN_CHARS && !classes.some((c) => ALLOWED_CLASSES.has(c))) found.push(body);
      tag.lastIndex = end + 4;
      continue;
    }
    if (lower === 'script' || lower === 'style') { const e = rest.indexOf(`</${lower}>`, tag.lastIndex); if (e > 0) tag.lastIndex = e; continue; }
    if (lower === 'img' && /section-hero/.test(cls)) continue; // compact hero on /today, /tonight, /this-weekend sits before the H1's content by owner decision
    if (BLOCK_TAGS.has(lower) && !(lower === 'section' && /data-about-this-page/.test(attrs))) break;
    if ((lower === 'div' || lower === 'aside') && BLOCK_CLASS.test(cls)) break;
  }
  return found;
}
