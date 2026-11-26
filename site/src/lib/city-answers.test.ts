import { describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { answerStatus, checkAtWarnings, faqJsonLd, inlineHtml, seasonText, upcomingDated, UNCONFIRMED_AFTER_DAYS } from './city-answers';
import { CITY_ANSWERS, answerPagesFor } from '../config/city-answers';
import { MORENO_VALLEY_ANSWERS } from '../config/city-answers/moreno_valley_ca';
import CityAnswers from '../components/answers/CityAnswers.astro';

const M1 = MORENO_VALLEY_ANSWERS[0];

describe('answer status (owner 2026-11-19: unconfirmed after 120 days; FAQ JSON-LD only for confirmed)', () => {
  it('confirmed up to 120 days after the read, unconfirmed from day 121', () => {
    const a = { checked: '2026-11-19' };
    expect(UNCONFIRMED_AFTER_DAYS).toBe(120);
    expect(answerStatus(a, '2027-03-19')).toBe('confirmed'); // 120 days
    expect(answerStatus(a, '2027-03-20')).toBe('unconfirmed');
    expect(answerStatus({ ...a, unconfirmed: true }, '2026-11-19')).toBe('unconfirmed');
  });
  it('FAQPage lists confirmed answers with a faq sentence only, and is null when none is left', () => {
    const ld = faqJsonLd(M1.answers, '2026-11-19')!;
    expect((ld.mainEntity as unknown[]).length).toBe(2);
    expect(faqJsonLd(M1.answers, '2027-06-01')).toBeNull(); // past 120 days: both unconfirmed
    expect(faqJsonLd(M1.answers.map((a) => ({ ...a, unconfirmed: true })), '2026-11-19')).toBeNull();
  });
  it('a build after checkAt warns once per answer, naming the page and anchor', () => {
    expect(checkAtWarnings(MORENO_VALLEY_ANSWERS, '2026-12-15', 'moreno_valley_ca')).toEqual([]);
    const w = checkAtWarnings(MORENO_VALLEY_ANSWERS, '2026-12-16', 'moreno_valley_ca');
    expect(w).toHaveLength(2);
    expect(w[0]).toContain('/christmas-tree-pickup/#when: checkAt 2026-12-15 has passed');
  });
});

describe('inline markup and dated data', () => {
  it('**bold** and [link](href) only; everything else escaped; external links get rel=noopener', () => {
    expect(inlineHtml('**On** <b>x</b> & [the page](https://x.test/a?b=1&c=2) and [City Hall](/city-hall/)'))
      .toBe('<strong>On</strong> &lt;b&gt;x&lt;/b&gt; &amp; <a href="https://x.test/a?b=1&amp;c=2" rel="noopener">the page</a> and <a href="/city-hall/">City Hall</a>');
  });
  it('a season shows `during` through its last day and `after` from the next (M1: the pickup ends 8 Jan 2027)', () => {
    const season = M1.answers[0].blocks.find((b) => b.kind === 'season')!;
    if (season.kind !== 'season') throw new Error('no season');
    expect(seasonText(season, '2027-01-08')).toContain('December 26, 2026 to January 8, 2027');
    expect(seasonText(season, '2027-01-09')).toContain('is over');
  });
  it('dated lines disappear once their date has passed', () => {
    const items = [{ date: '2026-11-28', text: 'Nov 28' }, { date: '2026-12-23', text: 'Dec 23' }];
    expect(upcomingDated(items, '2026-11-28').map((i) => i.text)).toEqual(['Nov 28', 'Dec 23']);
    expect(upcomingDated(items, '2026-11-29').map((i) => i.text)).toEqual(['Dec 23']);
    expect(upcomingDated(items, '2026-12-24')).toEqual([]);
  });
});

const TOWN_NAME: Record<string, string> = { brookings_sd: 'Brookings', broomfield_co: 'Broomfield', moreno_valley_ca: 'Moreno Valley' };

describe('config/city-answers', () => {
  const all = Object.entries(CITY_ANSWERS).flatMap(([town, pages]) => pages.map((p) => ({ town, p })));
  it('every page: a unique slug that no static page file takes, a title with the name of the town (no {Site} suffix), answers with https sources and checkAt after checked', () => {
    for (const { town, p } of all) {
      expect(existsSync(new URL(`../pages/${p.slug}.astro`, import.meta.url)), `${town} ${p.slug} collides with a static page`).toBe(false);
      // A page with a `facility` has its title and meta made from it (lib/answer-facility.ts, tested in answer-facility.test.ts); no hand-written ones.
      if (p.facility) { expect(p.title, `${town} ${p.slug}`).toBeUndefined(); expect(p.description, `${town} ${p.slug}`).toBeUndefined(); }
      else {
        // Hand-written titles (owner order 2026-11-26 (12)): the town's name in it, at most 60 characters, no site suffix.
        expect(p.title, `${town} ${p.slug}`).not.toContain('{Site}');
        expect(p.title!.length, `${town} ${p.slug}: ${p.title}`).toBeLessThanOrEqual(60);
        expect(p.title, `${town} ${p.slug}`).toContain(TOWN_NAME[town]);
        expect((p.description ?? '').length).toBeLessThanOrEqual(160);
      }
      expect(p.answers.length).toBeGreaterThan(0);
      for (const a of p.answers) {
        expect(a.sources.length, a.id).toBeGreaterThan(0);
        for (const s of a.sources) expect(s.url).toMatch(/^https:\/\//);
        expect(a.checkAt >= a.checked, `${p.slug}#${a.id}`).toBe(true);
        expect(a.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
    for (const [town, pages] of Object.entries(CITY_ANSWERS)) expect(new Set(pages.map((p) => p.slug)).size, town).toBe(pages.length);
  });
  it('M1 (Moreno Valley) carries the source text: regular collection day, the first two weeks after Christmas, the three rules', () => {
    const text = JSON.stringify(M1);
    for (const s of ['regular collection day', 'first two weeks after Christmas', 'longer than six feet', 'tinsel, metal ornaments and metal stands', 'Flocked trees are collected but cannot be recycled'])
      expect(text).toContain(s);
    expect(M1.answers[0].sources[0].url).toBe('https://ci.moreno-valley.ca.us/resident_services/waste/special-xmastree.html');
  });
  it('drafts are left out unless asked for', () => {
    for (const town of Object.keys(CITY_ANSWERS)) expect(answerPagesFor(town).some((p) => p.draft)).toBe(false);
  });
});

describe('CityAnswers renders one card per answer, the question as H2, no unconfirmed line while confirmed', () => {
  it('Moreno Valley M1 on 19 Nov 2026', async () => {
    const html = await (await AstroContainer.create()).renderToString(CityAnswers, { props: { page: M1, today: '2026-11-19' } });
    expect(html.match(/<section class="ans"/g)?.length).toBe(2);
    expect(html).toContain('When is my Christmas tree picked up?</h2>');
    expect(html).toContain('<strong>December 26, 2026 to January 8, 2027</strong>');
    expect(html).not.toContain('Unconfirmed');
    const later = await (await AstroContainer.create()).renderToString(CityAnswers, { props: { page: M1, today: '2027-04-01' } });
    expect(later).toContain('Unconfirmed');
    vi.useRealTimers();
  });
});
