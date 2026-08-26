import { describe, expect, it } from 'vitest';
import {
  buildNewsSitemapXml, isWithinNewsWindow, stripTownPrefix, NEWS_SITEMAP_WINDOW_HOURS,
  type NewsSitemapStory, type NewsSitemapSite,
} from './news-sitemap';
import { buildArticleJsonLd } from './article-jsonld';
import { formatDate } from './db';

const SITE: NewsSitemapSite = {
  siteUrl: 'https://brookingsview.com',
  publicationName: 'Brookings View',
  timezone: 'America/Chicago',
  cityName: 'Brookings',
};

function story(overrides: Partial<NewsSitemapStory>): NewsSitemapStory {
  return {
    slug: 'meeting-10703', title: 'Brookings: Library Board — Thu, Aug 13, 2026',
    published_at: '2026-08-25T19:30:00.000Z',
    ...overrides,
  };
}

describe('isWithinNewsWindow', () => {
  const now = new Date('2026-08-25T12:00:00Z');

  it('includes an article published 1 hour ago', () => {
    expect(isWithinNewsWindow('2026-08-25T11:00:00Z', now)).toBe(true);
  });

  it('includes an article published exactly at the 48h boundary', () => {
    const boundary = new Date(now.getTime() - NEWS_SITEMAP_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
    expect(isWithinNewsWindow(boundary, now)).toBe(true);
  });

  it('excludes an article published 49 hours ago', () => {
    const tooOld = new Date(now.getTime() - 49 * 60 * 60 * 1000).toISOString();
    expect(isWithinNewsWindow(tooOld, now)).toBe(false);
  });

  it('has no upper bound -- only the 48h lower cutoff matters', () => {
    // published_at is always set to a real now() at insert time (see
    // ai_pipeline/publish.py/daily_content.py/weekly.py), so a future
    // value can't actually occur -- this just documents that the function
    // itself doesn't need to defend against one.
    const future = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    expect(isWithinNewsWindow(future, now)).toBe(true);
  });
});

describe('stripTownPrefix', () => {
  it('strips an exact "{cityName}: " prefix', () => {
    expect(stripTownPrefix('Brookings: Library Board — Thu, Aug 13, 2026', 'Brookings'))
      .toBe('Library Board — Thu, Aug 13, 2026');
  });

  it('leaves a title with no matching prefix untouched', () => {
    expect(stripTownPrefix('This week in Brookings: August 24–30', 'Brookings'))
      .toBe('This week in Brookings: August 24–30');
  });

  it('does not strip a mid-sentence mention, only a true leading prefix', () => {
    const title = 'A guide to Brookings: what to know';
    expect(stripTownPrefix(title, 'Brookings')).toBe(title);
  });
});

describe('buildNewsSitemapXml', () => {
  const now = new Date('2026-08-26T00:00:00Z');

  it('emits a valid urlset with the news namespace', () => {
    const xml = buildNewsSitemapXml([story({})], SITE, now);
    expect(xml).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
    expect(xml).toContain('xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"');
  });

  it('excludes an article older than 48 hours entirely -- not just its news:news block', () => {
    const old = story({ slug: 'old-meeting', published_at: '2026-08-01T00:00:00Z' });
    const xml = buildNewsSitemapXml([old], SITE, now);
    expect(xml).not.toContain('old-meeting');
  });

  it('includes loc, publication name, language, publication_date, and a de-prefixed title', () => {
    const xml = buildNewsSitemapXml([story({})], SITE, now);
    expect(xml).toContain('<loc>https://brookingsview.com/s/meeting-10703/</loc>');
    expect(xml).toContain('<news:name>Brookings View</news:name>');
    expect(xml).toContain('<news:language>en</news:language>');
    expect(xml).toContain('<news:title>Library Board — Thu, Aug 13, 2026</news:title>');
  });

  it('escapes XML-special characters in the title', () => {
    const xml = buildNewsSitemapXml(
      [story({ title: 'Council Approves "Main St" & 5th Ave Rezoning' })], SITE, now,
    );
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&quot;');
    expect(xml).not.toContain('" & ');
  });

  it('an empty eligible list still produces a valid (empty) urlset, never malformed XML', () => {
    const xml = buildNewsSitemapXml([], SITE, now);
    expect(xml).toContain('<urlset');
    expect(xml).toContain('</urlset>');
  });
});

describe('the three-surface date consistency the brief explicitly requires', () => {
  // News sitemap <news:publication_date>, NewsArticle datePublished, and the
  // on-page visible timestamp must all resolve to the SAME real instant --
  // checked here as an actual automated test, not a one-time manual
  // eyeball check, per the brief's own explicit instruction (easy to get
  // subtly wrong: one field in UTC, another in local time, differing only
  // by the timezone offset).
  const publishedAt = '2026-08-25T19:30:00.000Z';
  const sample = story({ published_at: publishedAt });

  it('sitemap publication_date and schema datePublished represent the identical instant', () => {
    const xml = buildNewsSitemapXml([sample], SITE, new Date('2026-08-26T00:00:00Z'));
    const sitemapDateMatch = xml.match(/<news:publication_date>([^<]+)<\/news:publication_date>/);
    expect(sitemapDateMatch).not.toBeNull();
    const sitemapInstant = new Date(sitemapDateMatch![1]).getTime();

    const jsonLd = buildArticleJsonLd(
      { title: sample.title, published_at: publishedAt, body: 'x', source_type: 'meeting', rating: null },
      'https://brookingsview.com/og/meeting-10703.png', 'Brookings View',
    );
    const schemaInstant = new Date(jsonLd.datePublished as string).getTime();

    expect(sitemapInstant).toBe(schemaInstant);
  });

  it('the sitemap instant also matches what formatDate() renders as the on-page day', () => {
    const xml = buildNewsSitemapXml([sample], SITE, new Date('2026-08-26T00:00:00Z'));
    const sitemapDateMatch = xml.match(/<news:publication_date>([^<]+)<\/news:publication_date>/);
    const sitemapDate = new Date(sitemapDateMatch![1]);

    // formatDate() renders in the BUILD's own siteConfig timezone (test
    // environment default: Brookings/America/Chicago, same as SITE above) --
    // both derive from the exact same published_at, so the calendar day
    // formatDate() prints must be the sitemap instant's own local day.
    const onPageText = formatDate(publishedAt);
    const expectedDay = String(sitemapDate.getUTCDate());
    // sitemapDate is already zoned (toZonedISOString output re-parsed as
    // if UTC by `new Date()`), so its UTC-getter fields ARE the local
    // Chicago wall-clock fields -- reading .getUTCDate() here is correct,
    // not a re-introduction of the UTC-vs-local bug this test exists to catch.
    expect(onPageText).toContain(expectedDay);
  });

  it('publication_date never changes across repeated sitemap builds for the same published_at', () => {
    // The brief's hard requirement: a value that shifts on regeneration
    // would silently break the 48h window logic. buildNewsSitemapXml is a
    // pure function of (stories, site, now) -- calling it twice with the
    // same published_at (only `now` advancing, as a real rebuild would)
    // must yield the identical publication_date.
    const xml1 = buildNewsSitemapXml([sample], SITE, new Date('2026-08-25T20:00:00Z'));
    const xml2 = buildNewsSitemapXml([sample], SITE, new Date('2026-08-26T05:00:00Z'));
    const extract = (xml: string) => xml.match(/<news:publication_date>([^<]+)<\/news:publication_date>/)![1];
    expect(extract(xml1)).toBe(extract(xml2));
  });
});
