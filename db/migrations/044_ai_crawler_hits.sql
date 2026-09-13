-- 044_ai_crawler_hits.sql
--
-- Answer-engine-visibility handoff, Section 6 item 2: "server-log the AI
-- crawler user-agents from Section 1 -- are they actually fetching, and
-- which pages?" Logs a hit only when the request's own User-Agent matches
-- one of the named crawlers already audited in NEEDS-HUMAN-REVIEW.md #60
-- (GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-Web,
-- PerplexityBot, Google-Extended, Bingbot, Googlebot) -- see
-- site/server/ai-crawler-log.ts for the match list and the actual write.
--
-- Deliberately NOT the same shape as the referral-channel idea the same
-- spec section asked for (logging a REAL VISITOR's Referer header) --
-- that was explicitly decided against to hold privacy.astro's own
-- "we don't otherwise run analytics or tracking scripts" promise. This
-- table only ever gets a row from a request that self-identifies as one
-- of these specific bots; no IP, no cookie, no human visitor is ever
-- represented here. `user_agent` is the bot's own public, self-declared
-- identity string (e.g. "Mozilla/5.0 (compatible; GPTBot/1.2; ...)"),
-- not personal data -- kept alongside `crawler_name` (the matched,
-- canonical short name) so a future UA-string change on the bot's side
-- is visible rather than silently absorbed into the existing match.

BEGIN;

CREATE TABLE IF NOT EXISTS ai_crawler_hits (
    id           BIGSERIAL PRIMARY KEY,
    town_id      TEXT NOT NULL REFERENCES towns(town_id),
    crawler_name TEXT NOT NULL,
    path         TEXT NOT NULL,
    user_agent   TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_crawler_hits_lookup
    ON ai_crawler_hits (town_id, crawler_name, created_at);

COMMIT;
