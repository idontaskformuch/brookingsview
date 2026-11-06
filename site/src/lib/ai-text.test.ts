import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { isAiText, publicBody } from './ai-text';
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
