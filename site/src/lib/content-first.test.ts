// Owner rule 2026-11-11: content comes straight after the H1; explanations, sources and method live in "About this page" at the bottom.
// The same checker runs on the real dist/ of every town in scripts/verify_content_first.mjs (part of the battery); this file pins its rules.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findIntroText } from '../../../scripts/content_first.mjs';

const page = (body: string) => `<html><body><header>masthead</header><main id="main"><div class="shell">${body}</div></main><footer>f</footer></body></html>`;
const LONG = 'Public places in Example, with the address and whether it is open right now, checked against each official page.';

describe('findIntroText', () => {
  it('flags an explanatory paragraph between the H1 and the first content block', () => {
    const html = page(`<header><h1>Places</h1><p>${LONG}</p></header><ul class="x"><li>a</li></ul>`);
    expect(findIntroText(html, '/facilities/')).toHaveLength(1);
  });

  it('passes when the content follows the H1 and the explanation sits in the about section', () => {
    const html = page(`<header><h1>Places</h1></header><ul><li>a</li></ul><section class="ui-about" data-about-this-page><h2>About this page</h2><p>${LONG}</p></section>`);
    expect(findIntroText(html, '/facilities/')).toEqual([]);
  });

  it('a holiday page\'s "Last checked" stamp is a data row, also with a two-digit day (2026-11-11: 30 chars tripped MIN_CHARS)', () => {
    const html = page(`<header class="hp-title"><h1>Thanksgiving 2026</h1><p class="hp-checked">Last checked <time datetime="2026-11-11">November 11, 2026</time></p></header><section class="hp-group"><ul><li>a</li></ul></section>`);
    expect(findIntroText(html, '/thanksgiving/')).toEqual([]);
  });

  it('flags a "Looking for X? See Y" link line too', () => {
    const html = page(`<h1>Past events</h1><p>Looking for what's coming up? See <a href="/events/">What's on</a>, updated every day.</p><h2>May</h2>`);
    expect(findIntroText(html, '/events/past/')).toHaveLength(1);
  });

  it('lets the data rows through: freshness stamp, vote status line, season status line, unofficial label', () => {
    for (const cls of ['cw-checked', 'vote-lead', 'season-status', 'er-unofficial', 'wx-meta']) {
      const html = page(`<h1>T</h1><p class="${cls}">Last checked 2:03 AM, Wednesday, November 11, 2026</p><ul><li>a</li></ul>`);
      expect(findIntroText(html, '/closures/'), cls).toEqual([]);
    }
  });

  it('ignores short labels and stops at the first block even when later text is long', () => {
    expect(findIntroText(page('<h1>T</h1><p>Short.</p><ul></ul>'), '/x/')).toEqual([]);
    expect(findIntroText(page(`<h1>T</h1><h2>Section</h2><p>${LONG}</p>`), '/x/')).toEqual([]);
  });

  it('allows pages whose opening text is the content (policy pages, detail pages) but still checks index pages', () => {
    const html = page(`<h1>T</h1><p>${LONG}</p><h2>Next</h2>`);
    for (const path of ['/about/', '/terms/', '/offline/', '/winter-guide/', '/s/some-story/', '/whats-on/some-show-abc123/', '/facilities/arrowhead-park/', '/city-hall/projects/rezoning/']) {
      expect(findIntroText(html, path), path).toEqual([]);
    }
    for (const path of ['/whats-on/', '/facilities/', '/city-hall/projects/']) expect(findIntroText(html, path), path).toHaveLength(1);
  });

  it('does not count the compact section hero image as content', () => {
    const html = page(`<img class="section-hero section-hero--compact" src="/a.jpg" alt=""><h1>T</h1><ul><li>a</li></ul>`);
    expect(findIntroText(html, '/today/')).toEqual([]);
  });
});

describe('page sources: the moved text is in the about slot', () => {
  const src = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
  it('BaseLayout renders the about slot after the content, inside <main>', () => {
    const layout = src('layouts/BaseLayout.astro');
    expect(layout).toContain('<slot name="about" />');
    expect(layout.indexOf('<slot />')).toBeLessThan(layout.indexOf('<slot name="about" />'));
    expect(layout.indexOf('<slot name="about" />')).toBeLessThan(layout.indexOf('<footer class="colophon">'));
  });
  it('AboutThisPage is open text under an "About this page" heading, not a <details>', () => {
    const c = src('components/ui/AboutThisPage.astro');
    expect(c).toContain("title = 'About this page'");
    expect(c).not.toContain('<details');
  });
  it('no page type outside the home/section heroes still imports SectionHero (owner 2026-11-11: only the compact /today, /tonight, /this-weekend heroes stay)', () => {
    const keep = new Set(['pages/today.astro', 'pages/tonight.astro', 'pages/this-weekend.astro']);
    const pages = ['city-hall.astro', 'closures.astro', 'farm-report.astro', 'game-day.astro', 'home-sales.astro', 'jackrabbits.astro', 'jobs.astro', 'sports.astro', 'university.astro', '[traffic].astro', 'workplace-watch/index.astro', 'city-hall/projects/[slug].astro'];
    for (const p of pages) expect(src(`pages/${p}`), p).not.toContain('<SectionHero');
    for (const p of keep) expect(src(p), p).toContain('<SectionHero');
  });
});
