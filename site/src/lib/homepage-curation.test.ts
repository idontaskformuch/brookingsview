import { describe, expect, it } from 'vitest';
import {
  firstSentence, hasQuorumNoticeSignal, selectLatestFrom, selectWorthKnowing,
  excludedFromComingUp,
} from './homepage-curation';
import type { Story } from './db';

function story(overrides: Partial<Story>): Story {
  return {
    id: 1, title: 'Untitled', slug: 'untitled', body: '', source_type: 'meeting',
    source_url: null, occurs_at: null, published_at: '2026-08-23T12:00:00Z',
    generated_by: 'scraper', byline: null, image_path: null, image_alt: null, rating: null,
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
    const result = selectWorthKnowing([bannered], new Set(['heat-advisory']), [], new Set());
    expect(result).toEqual([]);
  });

  it('caps at the given limit', () => {
    const items = ['a', 'b', 'c', 'd'].map((slug) => story({ slug }));
    expect(selectWorthKnowing(items, new Set(), [], new Set(), 3)).toHaveLength(3);
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
    const result = selectWorthKnowing([meetingNotice, realDecision], new Set(), [quorumColumn], new Set());
    expect(result.map((s) => s.slug)).toEqual(['meeting-2']);
  });

  it('does not drop a real civic decision that happens to share no theme with Latest From', () => {
    const realDecision = story({
      slug: 'meeting-2', source_type: 'meeting',
      body: 'The Planning Commission approved a conditional use permit for a truck facility.',
    });
    const unrelatedColumn = story({ slug: 'gopher-bounty', source_type: 'vetenskap_kronika', body: 'Pest control ecology.' });
    const result = selectWorthKnowing([realDecision], new Set(), [unrelatedColumn], new Set());
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
    const result = selectWorthKnowing([notice1, notice2], new Set(), [], new Set());
    expect(result.map((s) => s.slug)).toEqual(['meeting-a']);
  });

  it('featured items are not excluded by the theme check just for existing', () => {
    const featured = story({ slug: 'featured-item', source_type: 'meeting', featured: true, body: 'Nothing quorum-related here.' });
    const result = selectWorthKnowing([featured], new Set(), [], new Set());
    expect(result.map((s) => s.slug)).toEqual(['featured-item']);
  });

  // 2026-10-02, item D5: the real bug this parameter exists to close -- a
  // meeting (or any other worth-knowing-eligible story) picked as the
  // homepage's own hero/secondary card must never ALSO appear in Worth
  // Knowing, which used to be selected from the same candidate pool with
  // no cross-check against the hero/secondary selection at all.
  describe('usedSlugs (no duplicate with hero/secondary)', () => {
    it('excludes a candidate whose slug is already used as the hero or a secondary card', () => {
      const heroCandidate = story({ slug: 'council-vote', source_type: 'meeting', body: 'The Council approved a new budget line item.' });
      const other = story({ slug: 'other-meeting', source_type: 'meeting', body: 'The Planning Commission approved a permit.' });
      const result = selectWorthKnowing([heroCandidate, other], new Set(), [], new Set(['council-vote']));
      expect(result.map((s) => s.slug)).toEqual(['other-meeting']);
    });

    it('with an empty usedSlugs set, behaves exactly as before (no new exclusions)', () => {
      const a = story({ slug: 'meeting-a', source_type: 'meeting', body: 'The Council approved a budget item.' });
      const result = selectWorthKnowing([a], new Set(), [], new Set());
      expect(result.map((s) => s.slug)).toEqual(['meeting-a']);
    });

    it('excluding the hero slug can surface a candidate that would otherwise be cut by the limit', () => {
      const used = story({ slug: 'used-1', source_type: 'meeting', body: 'Routine council business A.' });
      const promoted = story({ slug: 'promoted', source_type: 'meeting', body: 'Routine council business B.' });
      const result = selectWorthKnowing([used, promoted], new Set(), [], new Set(['used-1']), 1);
      expect(result.map((s) => s.slug)).toEqual(['promoted']);
    });
  });
});

describe('excludedFromComingUp', () => {
  // QA finding #8 (2026-10): the real bug was a quorum-notice meeting story
  // rendering once in Worth Knowing and again as the first "Coming up" card
  // -- usedSlugs (lead/secondary) alone didn't cover that.
  it('includes a Worth Knowing pick even when usedSlugs is empty', () => {
    const quorumNotice = story({ slug: 'quorum-notice' });
    const result = excludedFromComingUp(new Set(), [quorumNotice]);
    expect(result.has('quorum-notice')).toBe(true);
  });

  it('still includes the lead/secondary slugs from usedSlugs', () => {
    const result = excludedFromComingUp(new Set(['lead', 'second']), []);
    expect(result).toEqual(new Set(['lead', 'second']));
  });

  it('unions both sources without dropping either', () => {
    const quorumNotice = story({ slug: 'quorum-notice' });
    const result = excludedFromComingUp(new Set(['lead']), [quorumNotice]);
    expect(result).toEqual(new Set(['lead', 'quorum-notice']));
  });
});
