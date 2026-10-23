import { describe, it, expect } from 'vitest';
// plain .mjs shared with the Node QA runner (qa/q3/run.mjs)
import { deterministicFindings, duplicateSentences, parseReview, currentSeason, buildReviewPrompt, buildPairPrompt, parsePairReview, CHECKLIST } from '../../../qa/q3/review.mjs';
import { renderReport } from '../../../qa/q3/report.mjs';

const now = new Date('2026-10-23T18:00:00Z');
const facts = (over: object = {}) => ({
  title: 'T', h1: ['T'], mainText: 'Plain page text.', shellText: 'Menu', wordCount: 3, emptyHeadings: [], paragraphWords: [10],
  images: [], timestamps: [], links: [], ...over,
});
const rec = (path: string, f: object = {}, over: object = {}) => ({ town: 'brookings_sd', path, kind: 'section', url: `https://x.test${path}`, findings: [], light: { facts: facts(f), contrast: [] }, dark: { facts: facts(f), contrast: [] }, ...over });
const run = (r: ReturnType<typeof rec>, extra: object = {}) =>
  deterministicFindings(r, { town: 'brookings_sd', now, dup: [], season: 'autumn', ...extra });
const checks = (r: ReturnType<typeof rec>, extra: object = {}) => run(r, extra).map((x: { check: number }) => x.check);

describe('Q3 checklist', () => {
  it('has the ten items the owner listed, in order', () => {
    expect(CHECKLIST.map((c: { id: number }) => c.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe('Q3 deterministic findings', () => {
  it('a clean page has none', () => expect(run(rec('/events/'))).toEqual([]));
  it('1: leaked code in main or in the shell (the stray ")}" case)', () => {
    expect(checks(rec('/', { mainText: 'Hello )} world' }))).toContain(1);
    expect(checks(rec('/', { shellText: 'Menu )} Today' }))).toContain(1);
    expect(checks(rec('/', { mainText: 'Starts undefined' }))).toContain(1);
  });
  it('2: a dated item more than a day in the past on an upcoming list, but not on an archive', () => {
    expect(checks(rec('/events/', { timestamps: ['2026-10-10T12:00:00Z'] }))).toContain(2);
    expect(checks(rec('/this-week/2026-w41/', { timestamps: ['2026-10-10T12:00:00Z'] }))).not.toContain(2);
    expect(checks(rec('/events/', { timestamps: ['2026-10-24T12:00:00Z'] }))).not.toContain(2);
  });
  it('4: many items older than 30 days on a main page', () => {
    const old = Array.from({ length: 6 }, () => '2026-08-01T12:00:00Z');
    expect(checks(rec('/university/', { timestamps: old }))).toContain(4);
    expect(checks(rec('/events/past/', { timestamps: old }))).not.toContain(4);
  });
  it('5: another town, wrong season, broken image', () => {
    const img = (src: string, ok = true, alt = 'alt') => ({ src, alt, ok, w: 1200, h: 800 });
    expect(checks(rec('/', { images: [img('/assets/images/this-week/glasgow-autumn-03.jpg')] }))).toContain(5);
    expect(checks(rec('/', { images: [img('/assets/images/this-week/brookings_sd-winter-06.jpg')] }))).toContain(5);
    expect(checks(rec('/', { images: [img('/assets/images/this-week/brookings_sd-autumn-06.jpg')] }))).not.toContain(5);
    expect(checks(rec('/', { images: [img('/x/a.jpg', false)] }))).toContain(5);
  });
  it('6: empty headings', () => expect(checks(rec('/x/', { emptyHeadings: ['Weekly preview'] }))).toContain(6));
  it('7: all-caps abbreviations are hinted, known ones are not', () => {
    expect(checks(rec('/', { mainText: 'VB vs USD tonight' }))).toContain(7);
    expect(checks(rec('/', { mainText: 'SDSU in SD, 7 PM' }))).not.toContain(7);
  });
  it('8: a very long paragraph', () => expect(checks(rec('/', { paragraphWords: [140] }))).toContain(8));
  it('9: contrast problems in dark mode', () => {
    const r = rec('/', {}, { dark: { facts: facts(), contrast: [{ target: '.kicker', summary: '' }] } });
    expect(run(r).find((x: { check: number }) => x.check === 9)?.evidence).toContain('dark mode');
  });
  it('3: the same long sentence on a list page and its detail page', () => {
    const s = 'This week at South Dakota State University the football team plays at home and the choir sings on Friday evening.';
    const dup = duplicateSentences([{ path: '/university/', text: s }, { path: '/s/university-digest-2026-w43/', text: `${s} More.` }, { path: '/about/', text: 'Other text.' }]);
    expect(dup).toHaveLength(1);
    expect(checks(rec('/university/'), { dup })).toContain(3);
    expect(checks(rec('/about/'), { dup })).not.toContain(3);
  });
});

describe('Q3 helpers', () => {
  it('season', () => {
    expect(currentSeason(new Date('2026-10-23T00:00:00Z'), 55)).toBe('autumn');
    expect(currentSeason(new Date('2026-01-10T00:00:00Z'), 40)).toBe('winter');
    expect(currentSeason(new Date('2026-07-10T00:00:00Z'), -30)).toBe('winter');
  });
  it('parses the reviewer JSON, tolerates prose around it and bad ids', () => {
    const out = parseReview('Here you go:\n{"findings":[{"check":5,"severity":"high","where":"hero","evidence":"gothic campus","cause":"wrong pool"},{"check":99,"severity":"weird","evidence":"x","cause":"y"}],"helps_resident":{"verdict":"partly","why":"mostly a list"}}');
    expect(out.map((x: { check: number; severity: string }) => [x.check, x.severity])).toEqual([[5, 'high'], [10, 'low'], [10, 'low']]);
    expect(out.every((x: { source: string }) => x.source === 'ai')).toBe(true);
  });
  it('no JSON or invalid JSON becomes a visible finding, never a silent pass', () => {
    expect(parseReview('nothing here')).toHaveLength(1);
    expect(parseReview('{bad json}')).toHaveLength(1);
  });
  it('the prompt carries the checklist, local time and the editorial rule', () => {
    const p = buildReviewPrompt(rec('/events/'), { town: 'brookings_sd', cfg: { display_name: 'Brookings', timezone: 'America/Chicago', country: 'us' }, now });
    expect(p.system).toContain('data -> what it means -> what the reader can do');
    expect(p.system).toContain('10=');
    expect(p.user).toContain('23 October 2026');
  });
  it('renders a report with the screenshots, the finding and its cause', () => {
    const page = { ...rec('/events/'), status: 200, findings: [{ check: 1, severity: 'high', source: 'det', where: '/events/', evidence: 'visible: )}', cause: 'template leftover' }],
      light: { shots: { fold: 'C:/x/screenshots/b-events-light-fold.jpg' } }, dark: { shots: { fold: 'C:/x/screenshots/b-events-dark-fold.jpg' } } };
    const html = renderReport({ summary: { date: '2026-10-23', model: null, tokens: { input: 0, output: 0 }, estimatedUsd: 0, priceAssumption: '' }, pages: [page] });
    expect(html).toContain('screenshots/b-events-light-fold.jpg');
    expect(html).toContain('screenshots/b-events-dark-fold.jpg');
    expect(html).toContain('template leftover');
    expect(html).toContain('1. Leaked code');
  });
});

describe('Q3 list + detail pair review (born_from: University digest finding 2026-10-23)', () => {
  const cfg = { display_name: 'Brookings', timezone: 'America/Chicago' };
  it('the prompt asks both owner questions and carries the date of today', () => {
    const p = buildPairPrompt(rec('/university/'), rec('/s/university-digest-2026-w43/'), { town: 'brookings_sd', cfg, now });
    expect(p.system).toContain('DOES THE DETAIL PAGE ADD ANYTHING THE LIST LACKS');
    expect(p.system).toContain('DOES OLD CONTENT TAKE TOO MUCH ROOM');
    expect(p.system).toContain('Today is 2026-10-23');
    expect(p.user).toContain('LIST page: https://x.test/university/');
    expect(p.user).toContain('DETAIL page: https://x.test/s/university-digest-2026-w43/');
  });
  it('a detail page that adds nothing, and old content, become findings on the pair', () => {
    const out = parsePairReview('{"detail_adds":"no","adds":"repeats the whole digest text","list_should":"a two-line teaser","old_content":{"too_much_room":true,"evidence":"12 digests back to August"},"findings":[{"check":3,"severity":"high","where":"both","evidence":"same paragraph twice","cause":"card renders the full body"}]}', '/university/', '/s/university-digest-2026-w43/');
    expect(out.pair).toMatchObject({ adds: 'no', list: '/university/' });
    const checksSeen = out.findings.map((x: { check: number }) => x.check).sort();
    expect(checksSeen).toEqual([3, 3, 4]);
    expect(out.findings.every((x: { source: string }) => x.source === 'ai')).toBe(true);
  });
  it('a detail page that adds value produces no finding, bad JSON is visible', () => {
    expect(parsePairReview('{"detail_adds":"yes","adds":"full list","old_content":{"too_much_room":false},"findings":[]}', '/a/', '/b/').findings).toEqual([]);
    expect(parsePairReview('nope', '/a/', '/b/').findings).toHaveLength(1);
  });
});

describe('Q3 reviewer reply parsing survives real-world damage (25 of 72 replies were unusable in the first run)', () => {
  it('code fences, prose around the JSON and a reply cut off mid-finding keep the complete findings', () => {
    const one = '{"check":5,"severity":"high","where":"hero","evidence":"gothic campus","cause":"wrong pool"}';
    const two = '{"check":7,"severity":"low","where":"list","evidence":"VB vs USD","cause":"abbreviation"}';
    expect(parseReview('```json\n{"findings":[' + one + ']}\n```').map((x: { check: number }) => x.check)).toEqual([5]);
    const cut = `{"findings":[${one},${two},{"check":3,"severity":"low","where":"both","evidence":"same para`;
    expect(parseReview(cut).map((x: { check: number }) => x.check)).toEqual([5, 7]);
    expect(parseReview('{"findings":[{"check":5,"severity":"low","evidence":"has \\"quotes\\" inside","cause":"x"}],"helps_resident":{"verdict":"yes"}}')).toHaveLength(1);
  });
  it('a pair reply that is cut off is still usable', () => {
    const cut = '{"detail_adds":"no","adds":"repeats","findings":[{"check":3,"severity":"high","where":"both","evidence":"same","cause":"card"},{"check":4,"sev';
    expect(parsePairReview(cut, '/a/', '/b/').findings.length).toBeGreaterThanOrEqual(1);
  });
});
