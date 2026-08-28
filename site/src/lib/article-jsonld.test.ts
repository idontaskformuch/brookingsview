import { describe, expect, it } from 'vitest';
import {
  buildArticleJsonLd, buildDatasetJsonLd, buildRecipeJsonLd, buildBreadcrumbJsonLd,
  buildFaqJsonLd, buildSchoolClosureNewsArticleJsonLd,
} from './article-jsonld';

const SITE_NAME = 'Moreno Valley View';
const HERO_URL = 'https://morenovalleyview.com/og/culture_essay-2026-08-01.png';
const CANONICAL_URL = 'https://morenovalleyview.com/s/home-sales-digest-2026-07/';

function baseStory(overrides: Partial<Parameters<typeof buildArticleJsonLd>[0]>) {
  return {
    title: 'Test Story',
    published_at: '2026-08-01T15:00:00.000Z',
    body: 'Body text.',
    source_type: 'culture_essay' as const,
    rating: null,
    ...overrides,
  };
}

describe('buildArticleJsonLd -- type selection', () => {
  it('uses OpinionNewsArticle for editorials', () => {
    const result = buildArticleJsonLd(baseStory({ source_type: 'editorial' }), HERO_URL, SITE_NAME);
    expect(result['@type']).toBe('OpinionNewsArticle');
  });

  it('uses ReviewNewsArticle for reviews', () => {
    const result = buildArticleJsonLd(baseStory({ source_type: 'media_recension' }), HERO_URL, SITE_NAME);
    expect(result['@type']).toBe('ReviewNewsArticle');
  });

  it('uses the generic Article type for columns/essays', () => {
    for (const sourceType of ['culture_essay', 'kvick_essa', 'vetenskap_kronika'] as const) {
      const result = buildArticleJsonLd(baseStory({ source_type: sourceType }), HERO_URL, SITE_NAME);
      expect(result['@type']).toBe('Article');
    }
  });

  it('falls back to NewsArticle for factual reporting types (meeting, event, ...)', () => {
    const result = buildArticleJsonLd(baseStory({ source_type: 'meeting' }), HERO_URL, SITE_NAME);
    expect(result['@type']).toBe('NewsArticle');
  });

  it('always attributes authorship to the publication Organization, never a fabricated Person', () => {
    const result = buildArticleJsonLd(baseStory({}), HERO_URL, SITE_NAME);
    expect(result.author).toEqual({ '@type': 'Organization', name: SITE_NAME });
    expect(result.publisher).toEqual({ '@type': 'Organization', name: SITE_NAME });
  });

  it('carries a structured reviewRating only when a real rating was extracted', () => {
    const withRating = buildArticleJsonLd(baseStory({ source_type: 'media_recension', rating: 4 }), HERO_URL, SITE_NAME);
    expect(withRating.reviewRating).toEqual({ '@type': 'Rating', ratingValue: 4, bestRating: 5, worstRating: 1 });

    const withoutRating = buildArticleJsonLd(baseStory({ source_type: 'media_recension', rating: null }), HERO_URL, SITE_NAME);
    expect(withoutRating.reviewRating).toBeUndefined();
  });

  it('image is just [heroUrl] when no crop variants are given', () => {
    const result = buildArticleJsonLd(baseStory({}), HERO_URL, SITE_NAME);
    expect(result.image).toEqual([HERO_URL]);
  });

  it('image includes crop variants when the caller confirms they exist', () => {
    const crop4x3 = 'https://morenovalleyview.com/assets/images/culture_essay-2026-08-01-4x3.png';
    const crop1x1 = 'https://morenovalleyview.com/assets/images/culture_essay-2026-08-01-1x1.png';
    const result = buildArticleJsonLd(baseStory({}), HERO_URL, SITE_NAME, [crop4x3, crop1x1]);
    expect(result.image).toEqual([HERO_URL, crop4x3, crop1x1]);
  });
});

describe('buildRecipeJsonLd', () => {
  it('emits Recipe markup with structured ingredients/instructions', () => {
    const story = {
      title: 'Weeknight Chicken',
      body: 'A quick one.',
      published_at: '2026-08-01T15:00:00.000Z',
      ingredients: ['400 g chicken thighs', '2 cloves garlic'],
      instructions: ['Heat the pan.', 'Cook the chicken.'],
    };
    const result = buildRecipeJsonLd(story, HERO_URL, SITE_NAME);
    expect(result).not.toBeNull();
    expect(result!['@type']).toBe('Recipe');
    expect(result!.recipeIngredient).toEqual(story.ingredients);
    expect(result!.recipeInstructions).toEqual([
      { '@type': 'HowToStep', text: 'Heat the pan.' },
      { '@type': 'HowToStep', text: 'Cook the chicken.' },
    ]);
  });

  it('emits nothing when ingredients or instructions are missing', () => {
    const noIngredients = {
      title: 'Broken', body: 'x', published_at: '2026-08-01T15:00:00.000Z',
      ingredients: null, instructions: ['Step one.'],
    };
    expect(buildRecipeJsonLd(noIngredients, HERO_URL, SITE_NAME)).toBeNull();

    const noInstructions = {
      title: 'Broken', body: 'x', published_at: '2026-08-01T15:00:00.000Z',
      ingredients: ['Something'], instructions: null,
    };
    expect(buildRecipeJsonLd(noInstructions, HERO_URL, SITE_NAME)).toBeNull();
  });
});

describe('buildDatasetJsonLd', () => {
  it('emits Dataset markup with the covered month as temporalCoverage', () => {
    const story = {
      title: 'Moreno Valley home sales: what sold in July 2026',
      body: 'One hundred homes sold...',
      occurs_at: '2026-07-01T00:00:00.000Z',
      published_at: '2026-08-01T15:00:00.000Z',
    };
    const result = buildDatasetJsonLd(story, CANONICAL_URL, 'Moreno Valley', SITE_NAME);
    expect(result).not.toBeNull();
    expect(result!['@type']).toBe('Dataset');
    expect(result!.temporalCoverage).toBe('2026-07');
    expect(result!.spatialCoverage).toEqual({ '@type': 'Place', name: 'Moreno Valley' });
  });

  it('emits nothing without a covered month (occurs_at)', () => {
    const story = {
      title: 'Untitled', body: 'x', occurs_at: null, published_at: '2026-08-01T15:00:00.000Z',
    };
    expect(buildDatasetJsonLd(story, CANONICAL_URL, 'Moreno Valley', SITE_NAME)).toBeNull();
  });

  it('handles occurs_at coming back as a Date object, not just a string', () => {
    // Regression test: the Neon driver returns a TIMESTAMPTZ column as
    // either a string or an already-parsed Date depending on context (same
    // caveat db.ts's calendarDateParts() already documents) -- a real
    // `astro build` caught this as a runtime TypeError (`.slice is not a
    // function`) before this test existed.
    const story = {
      title: 'Moreno Valley home sales: what sold in July 2026',
      body: 'x',
      occurs_at: new Date('2026-07-01T00:00:00.000Z'),
      published_at: '2026-08-01T15:00:00.000Z',
    };
    const result = buildDatasetJsonLd(story, CANONICAL_URL, 'Moreno Valley', SITE_NAME);
    expect(result!.temporalCoverage).toBe('2026-07');
  });
});

describe('buildBreadcrumbJsonLd', () => {
  it('emits a positioned ListItem per trail entry', () => {
    const trail = [
      { label: 'Home', href: 'https://example.com/' },
      { label: 'City hall', href: 'https://example.com/city-hall/' },
      { label: 'City Council meets Tuesday', href: 'https://example.com/s/meeting-1/' },
    ];
    const result = buildBreadcrumbJsonLd(trail, 'https://example.com/s/meeting-1/');
    expect(result['@type']).toBe('BreadcrumbList');
    const items = result.itemListElement as Record<string, unknown>[];
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ position: 1, name: 'Home', item: 'https://example.com/' });
    expect(items[1]).toMatchObject({ position: 2, name: 'City hall', item: 'https://example.com/city-hall/' });
  });

  it('the last item always uses the real page URL, even if its own href in the trail differs', () => {
    // The last crumb's own `href` is never actually used for navigation
    // (Breadcrumbs.astro renders it as plain text) -- pageUrl is the
    // single source of truth for what the CURRENT page's URL really is.
    const trail = [
      { label: 'Home', href: '/' },
      { label: 'Current Page', href: '/wrong-or-stale-href/' },
    ];
    const result = buildBreadcrumbJsonLd(trail, 'https://example.com/real-canonical/');
    const items = result.itemListElement as Record<string, unknown>[];
    expect(items[1].item).toBe('https://example.com/real-canonical/');
  });

  it('resolves site-relative hrefs to absolute URLs -- every real caller passes relative paths', () => {
    // Regression test: a real build emitted `"item": "/"` and
    // `"item": "/city-hall/"` for the first two crumbs before this was
    // fixed -- schema.org's BreadcrumbList requires an absolute URL per
    // item, and every actual page (see [slug].astro etc.) builds its
    // trail with plain root-relative hrefs like '/', '/city-hall/'.
    const trail = [
      { label: 'Home', href: '/' },
      { label: 'City hall', href: '/city-hall/' },
      { label: 'Library Board — Thu, Aug 13, 2026', href: 'https://brookingsview.com/s/meeting-10703/' },
    ];
    const result = buildBreadcrumbJsonLd(trail, 'https://brookingsview.com/s/meeting-10703/');
    const items = result.itemListElement as Record<string, unknown>[];
    expect(items[0].item).toBe('https://brookingsview.com/');
    expect(items[1].item).toBe('https://brookingsview.com/city-hall/');
  });

  it('a 2-level trail (no known parent section) still produces valid markup', () => {
    const trail = [
      { label: 'Home', href: '/' },
      { label: 'Heat Advisory', href: 'https://example.com/s/alert-1/' },
    ];
    const result = buildBreadcrumbJsonLd(trail, 'https://example.com/s/alert-1/');
    expect((result.itemListElement as unknown[])).toHaveLength(2);
  });
});

describe('buildFaqJsonLd', () => {
  it('emits one Question/Answer pair per entry, in order', () => {
    const result = buildFaqJsonLd([
      { question: 'Is school closed today in Brookings?', answer: 'No closures have been announced today.' },
      { question: 'How are closures announced in Brookings?', answer: 'Through the district’s own notification channel.' },
    ]);
    expect(result['@type']).toBe('FAQPage');
    const entities = result.mainEntity as Record<string, unknown>[];
    expect(entities).toHaveLength(2);
    expect(entities[0].name).toBe('Is school closed today in Brookings?');
    expect((entities[0].acceptedAnswer as Record<string, unknown>).text).toBe('No closures have been announced today.');
  });
});

describe('buildSchoolClosureNewsArticleJsonLd', () => {
  it('renders the district message verbatim as articleBody, never re-authored', () => {
    const result = buildSchoolClosureNewsArticleJsonLd(
      { title: 'District closed today', message: 'All schools are closed today due to weather.', postedAt: '2026-02-01T12:00:00.000Z' },
      'https://brookingsview.com/closures/',
      'Brookings View',
    );
    expect(result['@type']).toBe('NewsArticle');
    expect(result.articleBody).toBe('All schools are closed today due to weather.');
    expect(result.datePublished).toBe('2026-02-01T12:00:00.000Z');
  });

  it('falls back to a generic headline when the district gave no title', () => {
    const result = buildSchoolClosureNewsArticleJsonLd(
      { title: null, message: 'Two-hour delay today.', postedAt: '2026-02-01T12:00:00.000Z' },
      'https://brookingsview.com/closures/',
      'Brookings View',
    );
    expect(result.headline).toBe('School closure notice');
  });
});
