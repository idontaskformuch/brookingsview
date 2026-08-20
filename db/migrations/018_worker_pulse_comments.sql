-- 018_worker_pulse_comments.sql
--
-- No-login, AI-moderated comments -- scoped to Worker Pulse pages ONLY
-- (the comparison page, page_slug='workplace-watch', and individual
-- monthly employer digests, page_slug=<the digest story's own slug>), not
-- site-wide. Moderation happens BEFORE a row is ever visible: see
-- site/functions/api/comment.ts. That Function is TypeScript running in a
-- Cloudflare Pages Function (edge runtime) -- it does NOT go through
-- ai_pipeline/guardrails.py, which is Python and only runs in GitHub
-- Actions batch jobs. This table's `status` is the moderation outcome:
--   'published'       -- passed the gate, shown on the site
--   'pending_review'  -- borderline (e.g. an unverified claim about a
--                        named employer) -- held, spot-checked manually,
--                        never auto-published. See scripts/review_comments.py.
--   'rejected'         -- spam/harassment, kept for the abuse record, never shown
--
-- No admin UI in v1 -- the spec calls this "low-volume, spot-checked
-- occasionally, not a daily obligation", so a script/manual query is
-- proportionate; see scripts/review_comments.py.

BEGIN;

CREATE TABLE IF NOT EXISTS worker_pulse_comments (
    id                BIGSERIAL PRIMARY KEY,
    town_id           TEXT NOT NULL REFERENCES towns(town_id),
    page_slug         TEXT NOT NULL,
    body              TEXT NOT NULL,
    status            TEXT NOT NULL,
    moderation_reason TEXT,
    ip_hash           TEXT NOT NULL,
    created_at        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_worker_pulse_comments_page
    ON worker_pulse_comments (town_id, page_slug, created_at);
CREATE INDEX IF NOT EXISTS idx_worker_pulse_comments_review_queue
    ON worker_pulse_comments (town_id, status, created_at)
    WHERE status = 'pending_review';

COMMIT;
