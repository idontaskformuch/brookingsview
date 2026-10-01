-- 046_api_usage.sql
--
-- Spec: API Cost Logging (2026-10-01). One row per paid API call (Anthropic
-- across the Python generators AND the Cloudflare worker's comment
-- moderation call, Brave Search, fal.ai) so cost can be analyzed by
-- generator/town/outcome instead of guessed at from the Anthropic Console.
-- Measurement only -- this migration does not change any pipeline behavior.
--
-- cost_usd is computed and stored AT WRITE TIME (config/pricing.py /
-- site/server/pricing.ts), not derived later from model+tokens -- so
-- historical rows stay accurate if prices change. An unrecognized model
-- logs cost_usd = NULL (never a guessed price) plus a stderr warning from
-- the caller.
--
-- outcome starts as 'pending' at insert time (the call just happened, the
-- pipeline doesn't yet know if the guardrail/pre-publish gate will accept
-- it) and is UPDATEd once that's known -- see ai_pipeline/api_usage.py's
-- finalize_outcome()/finalize_generation(). A row still 'pending' long after
-- the run that created it ended means the process crashed or was killed
-- between the call and the outcome being decided -- cost_report.py's waste
-- query (outcome NOT IN ('published','dry_run')) deliberately counts
-- 'pending' as waste rather than silently excluding it, since an orphaned
-- row represents real spend with no confirmed use.
--
-- town_id is nullable for shared, non-town-scoped content (per the spec);
-- every call site in THIS codebase currently has a concrete town_id
-- available (every content type is generated per-town today), so in
-- practice the column is never actually NULL yet -- the nullability exists
-- for the shared-content architecture the spec names, not a current gap.

BEGIN;

CREATE TABLE IF NOT EXISTS api_usage (
    id                 BIGSERIAL PRIMARY KEY,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    run_id             TEXT NOT NULL,
    town_id            TEXT REFERENCES towns(town_id),
    generator          TEXT NOT NULL,
    provider           TEXT NOT NULL,                  -- 'anthropic' | 'brave' | 'fal'
    model              TEXT,
    input_tokens       INT,
    output_tokens      INT,
    cache_read_tokens  INT,
    cache_write_tokens INT,
    units              INT,
    cost_usd           NUMERIC(10, 6),
    attempt            INT NOT NULL DEFAULT 1,
    outcome            TEXT NOT NULL DEFAULT 'pending'  -- 'pending' | 'published' | 'guardrail_rejected' | 'template_fallback' | 'error' | 'dry_run'
);

-- cost_report.py's primary grouping axes.
CREATE INDEX IF NOT EXISTS idx_api_usage_generator ON api_usage (generator, created_at);
CREATE INDEX IF NOT EXISTS idx_api_usage_town ON api_usage (town_id, created_at);
CREATE INDEX IF NOT EXISTS idx_api_usage_run ON api_usage (run_id);
-- waste query: cost where outcome isn't a successful terminal state.
CREATE INDEX IF NOT EXISTS idx_api_usage_outcome ON api_usage (outcome) WHERE outcome NOT IN ('published', 'dry_run');

COMMIT;
