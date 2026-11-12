import { describe, expect, it } from 'vitest';
import { pruneNav, resolveNavTarget } from './nav-prune.mjs';

// Markup and robots states from broomfieldview.com, build 5beb348 (2026-11-12): /today/, /traffic/, /jobs/ and /vail-resorts/ were
// noindex, /this-week/ the redirect stub below. The footer row carries data-nav-id as BaseLayout emits it from this change on.
const STUB = '<!doctype html><title>Redirecting to: /this-week/2026-w46/</title><meta http-equiv="refresh" content="2;url=/this-week/2026-w46/"><meta name="robots" content="noindex">';
const page = (noindex: boolean) => `<meta name="robots" content="${noindex ? 'noindex,follow,' : ''}max-image-preview:large" />`;
const SERVED: Record<string, string> = {
  '/today/': page(true), '/tonight/': page(false), '/whats-on/': page(false), '/this-week/': STUB, '/this-week/2026-w46/': page(false),
  '/weather/': page(false), '/safety/': page(false), '/city-hall/': page(false), '/traffic/': page(true), '/facilities/': page(false),
  '/holidays/': page(false), '/jobs/': page(true), '/vail-resorts/': page(true),
};
const readPage = (p: string) => SERVED[p] ?? null;
const resolve = (href: string) => resolveNavTarget(href, readPage);

const ROW = '<div class="snav__row" data-snav-row> <a href="/today/" data-nav-id="today">Today</a><a href="/tonight/" data-nav-id="tonight">Tonight</a><a href="/whats-on/" data-nav-id="whatson">What&#39;s On</a> </div>';
const GROUPS = '<section class="snav__group"> <h3 class="snav__group-title">Now</h3> <ul class="snav__list"> <li><a href="/today/" data-nav-id="today">Today</a></li><li><a href="/this-week/" data-nav-id="thisweek">This week</a></li><li><a href="/weather/" data-nav-id="weather">Weather</a></li> </ul> </section><section class="snav__group"> <h3 class="snav__group-title">Community</h3> <ul class="snav__list"> <li><a href="/jobs/" data-nav-id="jobs">Jobs</a></li> </ul> </section>';
const FOOTER = '<div class="colophon__group" data-astro-cid-37fxchfa> <p class="colophon__group-label" data-astro-cid-37fxchfa>Community</p> <ul class="colophon__group-list" data-astro-cid-37fxchfa> <li data-astro-cid-37fxchfa><a href="/vail-resorts/" data-nav-id="vail" data-astro-cid-37fxchfa>Vail Resorts</a></li><li data-astro-cid-37fxchfa><a href="/jobs/" data-nav-id="jobs" data-astro-cid-37fxchfa>Jobs</a></li> </ul> </div>';
const ABOUT = '<nav class="colophon__links" aria-label="About this site"><a href="/about/">About</a></nav>';

describe('resolveNavTarget', () => {
  it('follows a redirect stub to the page it points at', () => {
    expect(resolve('/this-week/')).toEqual({ ok: true, href: '/this-week/2026-w46/' });
  });
  it('rejects a noindex page and a path nothing is built at', () => {
    expect(resolve('/today/')).toMatchObject({ ok: false, reason: 'noindex' });
    expect(resolve('/sports/')).toMatchObject({ ok: false, reason: 'missing' });
  });
  it('leaves links that are not site paths alone', () => {
    expect(resolve('https://www.broomfield.org/')).toEqual({ ok: true, href: 'https://www.broomfield.org/' });
  });
});

describe('pruneNav (QA build.nav-links)', () => {
  it('drops tab-row entries whose target is noindex', () => {
    const { html, removed } = pruneNav(ROW, resolve);
    expect(html).not.toContain('/today/');
    expect(html).toContain('<a href="/tonight/" data-nav-id="tonight">Tonight</a>');
    expect(removed).toEqual([{ href: '/today/', reason: 'noindex' }]);
  });
  it('drops the <li> with the link, points a redirect at its target, and drops a group left empty', () => {
    const { html, rewritten } = pruneNav(GROUPS, resolve);
    expect(html).not.toContain('<li><a href="/today/"');
    expect(html).toContain('<li><a href="/this-week/2026-w46/" data-nav-id="thisweek">This week</a></li>');
    expect(html).not.toContain('Community');
    expect(html).toContain('Now');
    expect(rewritten).toEqual([{ from: '/this-week/', to: '/this-week/2026-w46/' }]);
  });
  it('does the same in the footer (scoped-style attributes and all)', () => {
    expect(pruneNav(FOOTER, resolve).html).toBe('');
  });
  it('never touches links without data-nav-id', () => {
    expect(pruneNav(ABOUT, () => ({ ok: false, href: '/about/', reason: 'noindex' })).html).toBe(ABOUT);
  });
});
