import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { isAiText, publicBody, ownPageHref, linkTarget } from './ai-text';
import { shouldNoindexStory } from './noindex';

describe('publicBody', () => {
  it('withholds model-written text (ai:claude-*)', () => {
    expect(publicBody({ body: 'Sunday is December 8.', generated_by: 'ai:claude-sonnet-4-5' })).toBe('');
    expect(isAiText({ generated_by: 'ai:claude-haiku-4-5' })).toBe(true);
  });
  it('keeps text that is not model-written', () => {
    for (const generated_by of ['template_fallback', 'human', 'zero_sales', 'data_pending', 'sdsu_event_calendar', null, undefined]) {
      expect(publicBody({ body: 'Plain text.', generated_by })).toBe('Plain text.');
    }
  });
});

describe('publicBody for a meta-only template body', () => {
  const meta = { venue: 'Larson Ice Center', address: '924 32nd Ave, Brookings, SD' };
  it('renders nothing when the body only repeats the title and the place shown in the fact row', () => {
    const base = { generated_by: 'template', title: 'Jacks Club Hockey vs Creighton', meta };
    expect(publicBody({ ...base, body: 'Jacks Club Hockey vs Creighton at Larson Ice Center.' })).toBe('');
    expect(publicBody({ ...base, title: 'City Council — Tue, Oct 20, 2026', body: 'City Council — Tue, Oct 20, 2026. Location: 924 32nd Ave, Brookings, SD.' })).toBe('');
  });
  it('keeps a template body that says more than title + place, or that cannot be judged', () => {
    const base = { generated_by: 'template', title: 'Jacks Club Hockey vs Creighton', meta };
    expect(publicBody({ ...base, body: 'Jacks Club Hockey vs Creighton at Larson Ice Center. Doors open early.' })).toContain('Doors open early');
    expect(publicBody({ generated_by: 'template', body: 'Plain template text.' })).toBe('Plain template text.'); // no title: unjudgeable
    expect(publicBody({ ...base, generated_by: 'template_fallback', body: 'Jacks Club Hockey vs Creighton at Larson Ice Center.' })).not.toBe('');
  });
});

describe('a permalink with withheld text', () => {
  it('is noindexed however long the stored text is', () => {
    const body = Array(500).fill('word').join(' ');
    expect(shouldNoindexStory({ source_type: 'weekly', body, published_at: '2026-11-01', generated_by: 'ai:claude-sonnet-4-5' })).toBe(true);
    expect(shouldNoindexStory({ source_type: 'weekly', body, published_at: '2026-11-01', generated_by: 'template_fallback' })).toBe(false);
  });
});

// Regression guard (owner 2026-11-06): no layout may print a story's stored text without going through publicBody().
// A layout that reads story.body / summary.body / digest.body etc. must import publicBody (or only use it for logic and
// say so in ALLOWED_LOGIC_ONLY below).
const SRC = join(__dirname, '..');
const ALLOWED_LOGIC_ONLY: Record<string, string> = {
  'components/EventBucket.astro': 'passes body on to StoryCard, which applies publicBody()',
  'pages/events/[facet].astro': 'passes body on to StoryCard, which applies publicBody()',
};
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(astro|ts)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p);
  }
  return out;
}
const READS_STORY_TEXT = /\b(story|item\.story|summary|weeklyStory|thisWeekDigest|digest|d|s|lead)\??\.body\b/;

describe('layouts never print model-written story text', () => {
  const offenders = walk(join(SRC, 'pages')).concat(walk(join(SRC, 'components')), walk(join(SRC, 'layouts')))
    .map((f) => ({ f, rel: relative(SRC, f).split(sep).join('/'), text: readFileSync(f, 'utf8') }))
    .filter(({ text }) => text.split('\n').some((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && READS_STORY_TEXT.test(l)))
    .filter(({ rel, text }) => !/publicBody\(/.test(text) && !(rel in ALLOWED_LOGIC_ONLY));
  it('every file reading story.body goes through publicBody()', () => {
    expect(offenders.map((o) => o.rel)).toEqual([]);
  });
});

describe('links to a story page', () => {
  it('ownPageHref is null for withheld text, the /s/ path otherwise', () => {
    expect(ownPageHref({ slug: 'meeting-1', generated_by: 'ai:claude-sonnet-4-5' })).toBeNull();
    expect(ownPageHref({ slug: 'meeting-1', generated_by: 'template_fallback' })).toBe('/s/meeting-1/');
  });
  it('linkTarget falls back to the source, and to null without an http(s) source', () => {
    const ai = { slug: 'e-1', generated_by: 'ai:claude-sonnet-4-5' };
    expect(linkTarget({ ...ai, source_url: 'https://example.org/e' })).toBe('https://example.org/e');
    expect(linkTarget({ ...ai, source_url: 'javascript:alert(1)' })).toBeNull();
    expect(linkTarget({ ...ai, source_url: null })).toBeNull();
    expect(linkTarget({ slug: 'e-2', generated_by: 'human', source_url: 'https://example.org/e' })).toBe('/s/e-2/');
  });
});

// Regression guard (owner 2026-11-06): nothing links to /s/<slug>/ without asking whether that page has any text.
// Layouts go through ownPageHref()/linkTarget(); the few files below build a /s/ URL for a reason that is safe.
const MAY_BUILD_STORY_HREF: Record<string, string> = {
  'lib/ai-text.ts': 'the helper itself',
  'lib/content-slugs.ts': 'defines storyHref',
  'pages/s/[slug].astro': "the story page's own canonical URL",
  'pages/s/[slug].ics.ts': "the story page's own .ics file",
  'lib/cross-site-canonical.ts': 'canonical of a noindex page on the origin town',
  'lib/news-sitemap.ts': 'the caller filters out withheld text (news-sitemap.xml.ts)',
  'pages/rss.xml.ts': 'filters out withheld text before building items',
  'pages/this-week/[week].astro': 'only shown when the weekly intro (publicBody) is non-empty',
  'components/meetings/MeetingCard.astro': 'storySlug comes from getMeetingRowsForView(), which only returns slugs of stories with public text',
  'pages/month/[slug].astro': 'only shown when digestExists, which requires ownPageHref()',
};
describe('layouts never link an empty /s/ page', () => {
  const offenders = walk(SRC)
    .map((f) => ({ rel: relative(SRC, f).split(sep).join('/'), text: readFileSync(f, 'utf8') }))
    .filter(({ rel, text }) => !(rel in MAY_BUILD_STORY_HREF) && text.split('\n').some((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && /\bstoryHref\(/.test(l)));
  it('storyHref() is only used where the page is known to have text', () => {
    expect(offenders.map((o) => o.rel)).toEqual([]);
  });
});

// Regression guard (owner 2026-11-06): the model-written text in the site's own tables (not stories) is not read at all.
// No source file may query these tables/columns or print their values; the generators in ai_pipeline/ may keep writing.
const AI_TABLES_AND_FIELDS = /\b(event_deck_digest|closure_watch_prose|whats_on_intro|free_teaser|getEventDeckDigests|getClosureWatchProse|getWhatsOnIntro|rolling_summary|u\.synthesis|\.synthesis)\b/;
describe('the site never reads the model-written tables', () => {
  const offenders = walk(SRC)
    .map((f) => ({ rel: relative(SRC, f).split(sep).join('/'), text: readFileSync(f, 'utf8') }))
    .filter(({ text }) => text.split('\n').some((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*') && AI_TABLES_AND_FIELDS.test(l)));
  it('no event_deck_digest / closure_watch_prose / whats_on_intro / free_teaser / project synthesis / rolling_summary in src', () => {
    expect(offenders.map((o) => o.rel)).toEqual([]);
  });
});
