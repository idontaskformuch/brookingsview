import { describe, expect, it } from 'vitest';
import { matchAiCrawler } from './ai-crawler-log';

// Real UA strings for each entry, verified live against all three domains
// in the answer-engine-visibility handoff's crawler-access audit (see
// NEEDS-HUMAN-REVIEW.md #60) -- not invented shapes.
describe('matchAiCrawler', () => {
  it('matches each of the nine audited crawlers by their real UA string', () => {
    const cases: [string, string][] = [
      ['Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)', 'GPTBot'],
      ['Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)', 'OAI-SearchBot'],
      ['Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)', 'ChatGPT-User'],
      ['Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)', 'ClaudeBot'],
      ['Mozilla/5.0 (compatible; Claude-Web/1.0; +https://www.anthropic.com)', 'Claude-Web'],
      ['Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)', 'PerplexityBot'],
      ['Mozilla/5.0 (compatible; Google-Extended)', 'Google-Extended'],
      ['Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)', 'Bingbot'],
      ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Googlebot'],
    ];
    for (const [ua, expected] of cases) {
      expect(matchAiCrawler(ua)).toBe(expected);
    }
  });

  it('returns null for an ordinary browser', () => {
    expect(matchAiCrawler(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    )).toBeNull();
  });

  it('returns null for a non-AI crawler (not in scope for this table)', () => {
    expect(matchAiCrawler('Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)')).toBeNull();
  });

  it('returns null for a missing User-Agent header', () => {
    expect(matchAiCrawler(null)).toBeNull();
  });

  it('bingbot match is case-insensitive (real UA is lowercase "bingbot")', () => {
    expect(matchAiCrawler('bingbot/2.0')).toBe('Bingbot');
  });
});
