import { describe, it, expect } from 'vitest';
// plain .mjs shared with the Node QA runner (qa/web/run.mjs)
import { checkPage, checkRun, compileBlocklist, applyWaivers } from '../../../qa/web/checks.mjs';

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
