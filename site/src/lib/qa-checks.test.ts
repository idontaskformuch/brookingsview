import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
// plain .mjs shared with the Node QA runner (qa/web/run.mjs)
import { checkPage, checkDiag, checkRun, compileBlocklist, applyWaivers, zonedInstant, duplicateContentFindings } from '../../../qa/web/checks.mjs';

const base = {
  url: 'https://x.test/a/', path: '/a/', status: 200, redirects: 0, inSitemap: true,
  title: 'A page', titleCount: 1, h1: ['A'], metaRobots: '', mainText: 'Hello world', metaDescription: '',
  imgAlts: [], loneDashNodes: 0, brokenImgs: [], consoleErrors: [], failedRequests: [], blockedAttempts: [],
};
const compiled = compileBlocklist({ brookings_sd: ['Moreno Valley', 'Inland Empire', '951'] });
const ids = (s: object, town = 'brookings_sd') => checkPage({ ...base, ...s }, town, compiled).map((f: { check: string }) => f.check);

describe('qa checkPage', () => {
  it('clean page has no findings', () => expect(ids({})).toEqual([]));
  it('non-200 -> web.status only', () => expect(ids({ status: 404, h1: [] })).toEqual(['web.status']));
  it('flags undefined / NaN / null / lone --', () => {
    expect(ids({ mainText: 'Starts undefined' })).toContain('web.literal');
    expect(ids({ mainText: 'NaN items' })).toContain('web.literal');
    expect(ids({ mainText: 'a null b' })).toContain('web.literal');
    expect(ids({ loneDashNodes: 1 })).toContain('web.literal');
    expect(ids({ mainText: 'The nullable column' })).not.toContain('web.literal');
  });
  it('h1/title rules', () => {
    expect(ids({ h1: [] })).toContain('web.h1');
    expect(ids({ h1: ['a', 'b'] })).toContain('web.h1');
    expect(ids({ titleCount: 2 })).toContain('web.h1');
    expect(ids({ title: '  ' })).toContain('web.h1');
  });
  it('broken image and console error are hard checks', () => {
    expect(ids({ brokenImgs: ['/i.png'] })).toContain('web.img');
    expect(ids({ consoleErrors: ['boom'] })).toContain('web.console');
  });
  it('cross-town leak is found with word boundaries (951 not inside 19512)', () => {
    expect(ids({ mainText: 'Moves to Moreno Valley soon' })).toContain('web.leak');
    expect(ids({ mainText: 'Call 951 555' })).toContain('web.leak');
    expect(ids({ mainText: 'Route 19512 closed' })).not.toContain('web.leak');
  });
  it('Cloudflare challenge is named in the status finding', () => {
    const f = checkPage({ ...base, status: 403, cfMitigated: 'challenge' }, 'brookings_sd', compiled);
    expect(f).toHaveLength(1);
    expect(f[0].message).toMatch(/cf-mitigated/);
  });
  it('noindex in sitemap', () => expect(ids({ metaRobots: 'noindex,follow' })).toContain('web.noindex-sitemap'));
  it('tracking attempts are reported (soft) not hidden', () => expect(ids({ blockedAttempts: ['https://www.googletagmanager.com/gtag/js'] })).toContain('qa.tracking'));
});

describe('qa run-level + waivers', () => {
  it('duplicate titles', () => {
    const f = checkRun([{ ...base, path: '/a/' }, { ...base, path: '/b/' }], 'brookings_sd');
    expect(f.map((x: { check: string }) => x.check)).toEqual(['web.title-dup']);
  });
  it('waiver hides until expiry', () => {
    const f = [{ check: 'web.img', town: 'brookings_sd', path: '/a/' }];
    const w = [{ check: 'web.img', town: 'brookings_sd', url_pattern: '/a/', expires: '2026-12-01' }];
    expect(applyWaivers(f, w, '2026-11-01')).toEqual([]);
    expect(applyWaivers(f, w, '2026-12-02')).toHaveLength(1);
  });
});

describe('qa Q1 diag checks', () => {
  const d = (x: object) => checkDiag({ ...base, label: 'desktop-dark', emptySections: [], clientfill: null, staleAlerts: [], pastEvents: [], axe: [], ...x }, 'brookings_sd').map((f: { check: string }) => f.check);
  it('nothing to report on a clean probe', () => expect(d({})).toEqual([]));
  it('empty section', () => expect(d({ emptySections: ['Weather'] })).toEqual(['web.empty']));
  it('client fill: events in template, nothing shown, no note -> hard; any shown part is fine', () => {
    expect(d({ clientfill: { items: 4, tonight: false, tomorrow: false, none: false } })).toEqual(['web.clientfill']);
    expect(d({ clientfill: { items: 4, tonight: true, tomorrow: false, none: false } })).toEqual([]);
    expect(d({ clientfill: { items: 0, tonight: false, tomorrow: false, none: false } })).toEqual([]);
    expect(d({ clientfill: { items: 3, tonight: false, tomorrow: false, none: true } })).toEqual([]);
  });
  it('stale alert and past event', () => {
    expect(d({ staleAlerts: ['2026-10-20T01:00:00Z :: Winter storm'] })).toEqual(['web.stale-alert']);
    expect(d({ pastEvents: ['tonight: Concert'] })).toEqual(['web.past-event']);
  });
  it('axe: serious/critical hard, others soft', () => {
    expect(d({ axe: [{ id: 'color-contrast', impact: 'serious', help: 'x', count: 2, targets: ['a'] }] })).toEqual(['web.axe']);
    expect(d({ axe: [{ id: 'region', impact: 'moderate', help: 'x', count: 1, targets: ['a'] }] })).toEqual(['web.axe-minor']);
  });
  it('images blocked -> no broken-image finding', () => {
    expect(ids({ brokenImgs: ['/i.png'], imagesBlocked: true })).not.toContain('web.img');
  });
});

describe('qa zonedInstant', () => {
  it('town-local wall time -> UTC instant, DST aware', () => {
    expect(zonedInstant('2026-10-21', '19:00', 'America/Chicago').toISOString()).toBe('2026-10-22T00:00:00.000Z'); // CDT = UTC-5
    expect(zonedInstant('2026-12-21', '07:00', 'America/Denver').toISOString()).toBe('2026-12-21T14:00:00.000Z'); // MST = UTC-7
    expect(zonedInstant('2026-10-21', '23:30', 'America/Los_Angeles').toISOString()).toBe('2026-10-22T06:30:00.000Z'); // PDT = UTC-7
  });
});

describe('web.literal reads the page shell, not only <main> (born_from: stray ")}" under the nav, 2026-10-23)', () => {
  // Header HTML captured from the live site while the bug was live: `</nav> )}` left behind in BaseLayout.astro.
  const html = readFileSync(new URL('../../../tests/fixtures/qa_literal_stray_header_2026-10-23.html', import.meta.url), 'utf8');
  const shellText = html
    .replace(/<main[\s\S]*?<\/main>|<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>|<title[\s\S]*?<\/title>/g, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  it('flags the captured buggy header', () => {
    expect(shellText).toContain(')}');
    const found = checkPage({ ...base, mainText: 'Body text', shellText }, 'brookingsview', compiled).filter((f: { check: string }) => f.check === 'web.literal');
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain(')}');
  });
  it('flags loose code characters in the shell and in main', () => {
    for (const bad of [')}', '{{', '}}', '${']) {
      expect(ids({ shellText: `Menu ${bad} Today` })).toContain('web.literal');
      expect(ids({ mainText: `Hello ${bad} world` })).toContain('web.literal');
    }
  });
  it('a clean shell passes', () => expect(ids({ shellText: 'Skip to content Today Events (3) All sections' })).not.toContain('web.literal'));
});

describe('web.duplicate-content (born_from: University digest finding 2026-10-23)', () => {
  const snap = (path: string, mainText: string, outLinks: string[] = []) => ({ url: `https://x.test${path}`, path, status: 200, mainText, outLinks });
  const para = (n: number, seed: string) => Array.from({ length: n }, (_, i) => `${seed}${i % 17}`).join(' ');

  it('flags BOTH pages when the linked page is mostly text already on the linking page (real capture, before the fix)', () => {
    const fx = JSON.parse(readFileSync(new URL('../../../tests/fixtures/qa_duplicate_university_2026-10-23.json', import.meta.url), 'utf8')) as
      { town: string; pages: { path: string; text: string; outLinks: string[] }[] };
    const snaps = fx.pages.map((p) => snap(p.path, p.text, p.outLinks));
    const found = duplicateContentFindings(snaps, fx.town);
    expect(found.map((x: { path: string }) => x.path).sort()).toEqual(['/s/university-digest-2026-w34/', '/university/']);
    expect(found.every((x: { check: string }) => x.check === 'web.duplicate-content')).toBe(true);
    expect(found[0].message).toMatch(/\d+%/);
  });
  it('through checkRun, so the runner reports it with the other run-level checks', () => {
    const a = 'The strongest games this week include a home volleyball match and a choir concert in the evening on campus. '.repeat(6);
    const found = checkRun([{ ...snap('/list/', `${a} Plus other things here.`, ['/detail/']), title: 'L' }, { ...snap('/detail/', a), title: 'D' }], 'brookings_sd');
    expect(found.filter((x: { check: string }) => x.check === 'web.duplicate-content')).toHaveLength(2);
  });
  it('does not flag a detail page that adds real content beyond the teaser', () => {
    const teaser = para(60, 'alpha');
    const detail = `${teaser} ${para(200, 'beta')}`;
    expect(duplicateContentFindings([snap('/list/', teaser, ['/d/']), snap('/d/', detail)], 't')).toEqual([]);
  });
  it('only counts pages that LINK to it (two pages with similar text and no link are not flagged)', () => {
    const t = para(120, 'gamma');
    expect(duplicateContentFindings([snap('/a/', t), snap('/b/', t)], 't')).toEqual([]);
  });
  it('ignores short pages and survives a truncated teaser', () => {
    expect(duplicateContentFindings([snap('/a/', 'tiny text here', ['/b/']), snap('/b/', 'tiny text here')], 't')).toEqual([]);
    const full = para(150, 'delta');
    const truncated = full.split(' ').slice(0, 130).join(' ') + '…';
    expect(duplicateContentFindings([snap('/a/', `${truncated} more`, ['/b/']), snap('/b/', full)], 't').length).toBe(2);
  });
});

describe('web.stale-recently (born 2026-10-24: series start pages under "Recently")', () => {
  const snap = { ...base, label: 'desktop-light', emptySections: [], clientfill: null, staleAlerts: [], pastEvents: [], axe: [] };
  const ids = (x: object) => checkDiag({ ...snap, ...x }, 'glasgow').map((f: { check: string }) => f.check);
  it('flags an old card under Recently', () => expect(ids({ staleRecently: ['Board Games More Games (2026-06-01T23:00:00.000Z)'] })).toEqual(['web.stale-recently']));
  it('is quiet when there is none', () => expect(ids({ staleRecently: [] })).toEqual([]));
});
