// Answer-engine-visibility handoff, Section 6 item 2: "server-log the AI
// crawler user-agents from Section 1 -- are they actually fetching, and
// which pages?" Matches ONLY the named bots already live-audited in
// NEEDS-HUMAN-REVIEW.md #60 -- never a human visitor, never an IP, never a
// cookie. See db/migrations/044_ai_crawler_hits.sql for why this is a
// deliberately narrower thing than the same spec section's "separate AI
// referral traffic" idea (that one was decided against -- it would mean
// logging real visitors' Referer headers, which privacy.astro explicitly
// promises this site doesn't do; this only ever logs a bot's own,
// self-declared identity string).
//
// Order matches the Section 1 audit table (NEEDS-HUMAN-REVIEW.md #60) plus
// the two extra OpenAI/Anthropic agents that audit also tested
// (ChatGPT-User, Claude-Web) -- same crawler families, both real and
// citation-relevant, not a scope expansion beyond what was already
// checked live.
const AI_CRAWLER_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: 'GPTBot', pattern: /GPTBot/ },
  { name: 'OAI-SearchBot', pattern: /OAI-SearchBot/ },
  { name: 'ChatGPT-User', pattern: /ChatGPT-User/ },
  { name: 'ClaudeBot', pattern: /ClaudeBot/ },
  { name: 'Claude-Web', pattern: /Claude-Web/ },
  { name: 'PerplexityBot', pattern: /PerplexityBot/ },
  { name: 'Google-Extended', pattern: /Google-Extended/ },
  { name: 'Bingbot', pattern: /bingbot/i },
  { name: 'Googlebot', pattern: /Googlebot/ },
];

/** Returns the matched crawler's canonical name, or null for anything else
 *  (including ordinary browsers and every OTHER bot/scraper -- this is
 *  deliberately narrow, not a general bot-detection heuristic). Checked in
 *  the order above so a UA naming both e.g. "Googlebot" and something else
 *  still gets one deterministic label. */
export function matchAiCrawler(userAgent: string | null): string | null {
  if (!userAgent) return null;
  for (const { name, pattern } of AI_CRAWLER_PATTERNS) {
    if (pattern.test(userAgent)) return name;
  }
  return null;
}

/** Fire-and-forget insert -- callers pass this to `ctx.waitUntil()` so it
 *  never delays the actual response a crawler (or anyone else) receives.
 *  Errors are swallowed with a console.error, not rethrown: a logging
 *  failure must never be the reason a real request fails, matching this
 *  file's own "purely additive observability" design. */
export async function logAiCrawlerHit(
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>,
  townId: string,
  crawlerName: string,
  path: string,
  userAgent: string,
): Promise<void> {
  try {
    await sql`
      INSERT INTO ai_crawler_hits (town_id, crawler_name, path, user_agent)
      VALUES (${townId}, ${crawlerName}, ${path}, ${userAgent})
    `;
  } catch (err) {
    console.error('logAiCrawlerHit failed:', err);
  }
}
