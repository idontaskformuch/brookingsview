import { describe, expect, it } from 'vitest';
import {
  firstSentence, hasQuorumNoticeSignal, selectLatestFrom, selectWorthKnowing,
  isSubstantialMeetingSummary, selectFrontPageRhythm, type FrontPageRhythmOptions,
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

describe('isSubstantialMeetingSummary', () => {
  it('is false for a routine one-sentence summary', () => {
    expect(isSubstantialMeetingSummary('The Planning Commission meets Tuesday.')).toBe(false);
  });

  it('is false for two sentences (still under the substantial threshold)', () => {
    expect(isSubstantialMeetingSummary('The Planning Commission meets Tuesday. Nothing else is on the agenda.')).toBe(false);
  });

  it('is true for three or more sentences', () => {
    expect(isSubstantialMeetingSummary(
      'The Planning Commission will consider a 9.1-acre truck facility. ' +
      'A second item proposes a car wash on Pigeon Pass Road. ' +
      'Public comment is limited to three minutes per speaker.'
    )).toBe(true);
  });
});

describe('selectFrontPageRhythm', () => {
  const imagedSlugs = new Set<string>();
  const baseOptions: FrontPageRhythmOptions = {
    hasImage: (s) => imagedSlugs.has(s.slug),
    widgetSlugs: new Set(),
  };

  it('tier 1: an active alert always wins the lead, image or not', () => {
    const alert = story({ slug: 'alert-1', source_type: 'alert', body: 'Heat advisory in effect.' });
    const meeting = story({ slug: 'meeting-1', source_type: 'meeting', body: 'a. b. c.' });
    imagedSlugs.add('alert-1');
    const result = selectFrontPageRhythm([meeting], [alert], baseOptions);
    expect(result.fullWidthLead?.slug).toBe('alert-1');
    imagedSlugs.clear();
  });

  it('tier 2: a substantial meeting wins over a routine one', () => {
    const routine = story({ slug: 'routine', source_type: 'meeting', body: 'Nothing on the agenda.' });
    const substantial = story({
      slug: 'substantial', source_type: 'meeting',
      body: 'Item one is substantial. Item two is also substantial. A third sentence closes it out.',
    });
    imagedSlugs.add('substantial');
    const result = selectFrontPageRhythm([routine, substantial], [], baseOptions);
    expect(result.fullWidthLead?.slug).toBe('substantial');
    imagedSlugs.clear();
  });

  it('tier 3: the newest announcement wins when no alert or substantial meeting exists', () => {
    const routine = story({ slug: 'routine', source_type: 'meeting', body: 'Nothing on the agenda.' });
    const announcement = story({ slug: 'announcement-1', source_type: 'announcement', body: 'We launched a thing.' });
    imagedSlugs.add('announcement-1');
    const result = selectFrontPageRhythm([routine, announcement], [], baseOptions);
    expect(result.fullWidthLead?.slug).toBe('announcement-1');
    imagedSlugs.clear();
  });

  it('tier 4: the newest imaged item wins when nothing else qualifies', () => {
    const a = story({ slug: 'event-a', source_type: 'event', body: 'a.' });
    const b = story({ slug: 'event-b', source_type: 'event', body: 'b.' });
    imagedSlugs.add('event-b');
    const result = selectFrontPageRhythm([a, b], [], baseOptions);
    expect(result.fullWidthLead?.slug).toBe('event-b');
    imagedSlugs.clear();
  });

  it('tier 5 + fail-down: the newest item wins but demotes to secondary when it has no image anywhere', () => {
    const a = story({ slug: 'event-a', source_type: 'event', body: 'a.' });
    const b = story({ slug: 'event-b', source_type: 'event', body: 'b.' });
    const c = story({ slug: 'event-c', source_type: 'event', body: 'c.' });
    const result = selectFrontPageRhythm([a, b, c], [], baseOptions);
    expect(result.fullWidthLead).toBeNull();
    expect(result.secondary.map((s) => s.slug)).toEqual(['event-a', 'event-b', 'event-c']);
  });

  it('secondary row is the next two items after the lead, excluding it', () => {
    const lead = story({ slug: 'lead', source_type: 'announcement', body: 'x' });
    const second = story({ slug: 'second', source_type: 'event', body: 'x' });
    const third = story({ slug: 'third', source_type: 'event', body: 'x' });
    const fourth = story({ slug: 'fourth', source_type: 'event', body: 'x' });
    imagedSlugs.add('lead');
    const result = selectFrontPageRhythm([lead, second, third, fourth], [], baseOptions);
    expect(result.fullWidthLead?.slug).toBe('lead');
    expect(result.secondary.map((s) => s.slug)).toEqual(['second', 'third']);
    imagedSlugs.clear();
  });

  it('usedSlugs covers the lead and every secondary item, for the caller to dedupe against', () => {
    const lead = story({ slug: 'lead', source_type: 'announcement', body: 'x' });
    const second = story({ slug: 'second', source_type: 'event', body: 'x' });
    imagedSlugs.add('lead');
    const result = selectFrontPageRhythm([lead, second], [], baseOptions);
    expect(result.usedSlugs).toEqual(new Set(['lead', 'second']));
    imagedSlugs.clear();
  });

  it('never picks a candidate whose slug is already in the widget row', () => {
    const widgetItem = story({ slug: 'widget-item', source_type: 'announcement', body: 'x' });
    const other = story({ slug: 'other', source_type: 'event', body: 'x' });
    imagedSlugs.add('widget-item');
    imagedSlugs.add('other');
    const result = selectFrontPageRhythm(
      [widgetItem, other], [],
      { hasImage: (s) => imagedSlugs.has(s.slug), widgetSlugs: new Set(['widget-item']) },
    );
    expect(result.fullWidthLead?.slug).toBe('other');
    expect(result.secondary.some((s) => s.slug === 'widget-item')).toBe(false);
    imagedSlugs.clear();
  });

  it('returns an empty selection when there are no candidates and no alerts', () => {
    const result = selectFrontPageRhythm([], [], baseOptions);
    expect(result.fullWidthLead).toBeNull();
    expect(result.secondary).toEqual([]);
    expect(result.usedSlugs.size).toBe(0);
  });
});
