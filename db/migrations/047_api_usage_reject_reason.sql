-- 047_api_usage_reject_reason.sql
--
-- API Cost Logging follow-up (2026-10-02): the meeting/event guardrail-
-- rejection investigation needs the EXACT violation text per attempt, not
-- just the outcome label -- "guardrail_rejected" alone can't distinguish a
-- date-coherence mismatch from a missing-entity/missing-number lexical
-- check, which is exactly the ambiguity blocking that investigation.
--
-- Nullable: only ever populated on a row where a check actually ran and
-- returned violations (guardrail_rejected, and the final template_fallback
-- attempt) -- published/dry_run (nothing to report) and error/pending
-- (never reached validation) stay NULL.

BEGIN;

ALTER TABLE api_usage ADD COLUMN IF NOT EXISTS reject_reason TEXT;

COMMIT;
