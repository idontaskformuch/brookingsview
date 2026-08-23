import { describe, expect, it } from 'vitest';
import { firstSentence, hasQuorumNoticeSignal, selectLatestFrom, selectWorthKnowing } from './homepage-curation';
import type { Story } from './db';

function story(overrides: Partial<Story>): Story {
  return {
    id: 1, title: 'Untitled', slug: 'untitled', body: '', source_type: 'meeting',
    source_url: null, occurs_at: null, published_at: '2026-08-23T12:00:00Z',
    generated_by: 'scraper', byline: null, image_path: null, rating: null,
    ingredients: null, instructions: null,
    ...overrides,
  };
}

describe('hasQuorumNoticeSignal', () => {
  it('matches the real recurring notice phrasing', () => {
    expect(hasQuorumNoticeSignal(
      'Downtown at Sundown happens Thursday. At least four City Council ' +
      'members may attend, though no official city business will be conducted.'
    )).toBe(true);
  });

  it('does not match ordinary civic text', () => {
    expect(hasQuorumNoticeSignal('The council held a public hearing on leasing city property to RTI, LLC.')).toBe(false);
  });
});

describe('firstSentence', () => {
  it('extracts just the first sentence', () => {
    expect(firstSentence('Brookings held a hearing on Tuesday. The council also discussed the budget.'))
      .toBe('Brookings held a hearing on Tuesday.');
  });

  it('falls back to the whole body with no sentence-ending punctuation', () => {
    expect(firstSentence('a headline with no period')).toBe('a headline with no period');
  });

  it('empty body stays empty', () => {
    expect(firstSentence('')).toBe('');
    expect(firstSentence('   ')).toBe('');
  });
});

describe('selectLatestFrom', () => {
  it('sorts most recent first', () => {
    const older = story({ slug: 'a', source_type: 'editorial', published_at: '2026-08-20T00:00:00Z' });
    const newer = story({ slug: 'b', source_type: 'editorial', published_at: '2026-08-22T00:00:00Z' });
    expect(selectLatestFrom([older, newer]).map((s) => s.slug)).toEqual(['b', 'a']);
  });

  it('breaks a same-timestamp tie with genre priority: editorial > columns > reviews > recipes', () => {
    const ts = '2026-08-23T00:00:00Z';
    const recipe = story({ slug: 'recipe', source_type: 'vardagsmiddag', published_at: ts });
    const review = story({ slug: 'review', source_type: 'media_recension', published_at: ts });
    const column = story({ slug: 'column', source_type: 'kvick_essa', published_at: ts });
    const editorial = story({ slug: 'editorial', source_type: 'editorial', published_at: ts });
    const result = selectLatestFrom([recipe, review, column, editorial], 4);
    expect(result.map((s) => s.slug)).toEqual(['editorial', 'column', 'review', 'recipe']);
  });

  it('caps at the given limit', () => {
    const items = ['a', 'b', 'c', 'd'].map((slug, i) =>
      story({ slug, source_type: 'editorial', published_at: `2026-08-2${i}T00:00:00Z` }));
    expect(selectLatestFrom(items, 3)).toHaveLength(3);
  });

  it('fewer than the limit just returns what exists', () => {
    const items = [story({ slug: 'only', source_type: 'editorial' })];
    expect(selectLatestFrom(items, 3)).toHaveLength(1);
  });
});

describe('selectWorthKnowing', () => {
  it('excludes a story already shown in the alert banner', () => {
    const bannered = story({ slug: 'heat-advisory', source_type: 'alert' });
    const result = selectWorthKnowing([bannered], new Set(['heat-advisory']), []);
    expect(result).toEqual([]);
  });

  it('caps at the given limit', () => {
    const items = ['a', 'b', 'c', 'd'].map((slug) => story({ slug }));
    expect(selectWorthKnowing(items, new Set(), [], 3)).toHaveLength(3);
  });

  it('drops a quorum-notice-themed candidate when Latest From already covers that theme', () => {
    const meetingNotice = story({
      slug: 'meeting-1', source_type: 'meeting',
      body: 'At least four City Council members may attend, though no official city business will be conducted.',
    });
    const realDecision = story({
      slug: 'meeting-2', source_type: 'meeting',
      body: 'The Planning Commission approved a conditional use permit for a truck facility and automated car wash.',
    });
    const quorumColumn = story({
      slug: 'the-quorum-at-sundown', source_type: 'culture_essay',
      title: 'The Quorum at Sundown',
      body: 'Five times this summer the city has issued a quorum notice for Downtown at Sundown.',
    });
    const result = selectWorthKnowing([meetingNotice, realDecision], new Set(), [quorumColumn]);
    expect(result.map((s) => s.slug)).toEqual(['meeting-2']);
  });

  it('does not drop a real civic decision that happens to share no theme with Latest From', () => {
    const realDecision = story({
      slug: 'meeting-2', source_type: 'meeting',
      body: 'The Planning Commission approved a conditional use permit for a truck facility.',
    });
    const unrelatedColumn = story({ slug: 'gopher-bounty', source_type: 'vetenskap_kronika', body: 'Pest control ecology.' });
    const result = selectWorthKnowing([realDecision], new Set(), [unrelatedColumn]);
    expect(result.map((s) => s.slug)).toEqual(['meeting-2']);
  });

  it('also suppresses duplicate themes within Worth Knowing itself, not just against Latest From', () => {
    const notice1 = story({
      slug: 'meeting-a', source_type: 'meeting',
      body: 'No official city business will be conducted at this quorum notice gathering.',
    });
    const notice2 = story({
      slug: 'meeting-b', source_type: 'meeting',
      body: 'At least four members may attend, though no official city business will be conducted.',
    });
    const result = selectWorthKnowing([notice1, notice2], new Set(), []);
    expect(result.map((s) => s.slug)).toEqual(['meeting-a']);
  });

  it('featured items are not excluded by the theme check just for existing', () => {
    const featured = story({ slug: 'featured-item', source_type: 'meeting', featured: true, body: 'Nothing quorum-related here.' });
    const result = selectWorthKnowing([featured], new Set(), []);
    expect(result.map((s) => s.slug)).toEqual(['featured-item']);
  });
});
