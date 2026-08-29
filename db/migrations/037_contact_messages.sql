-- Real contact form for /contact (see site/server/contact.ts) -- the page
-- previously only offered a mailto: link, no server-side path at all.
-- Durable storage is the source of truth for a submission regardless of
-- whether outbound email delivery (Resend, optional -- see contact.ts's
-- own comment) is configured or succeeds; nothing is lost if RESEND_API_KEY
-- is unset or Resend's API call fails.
--
-- Same shape/conventions as worker_pulse_comments (018_worker_pulse_
-- comments.sql): ip_hash + created_at back a per-IP daily rate limit,
-- computed the same way (sha256(ip + IP_HASH_SALT)) in contact.ts.

BEGIN;

CREATE TABLE IF NOT EXISTS contact_messages (
  id SERIAL PRIMARY KEY,
  town_id TEXT NOT NULL,
  name TEXT,
  email TEXT,
  message TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  -- Best-effort Resend delivery outcome -- 'sent', 'failed', or 'skipped'
  -- (RESEND_API_KEY not configured). Never blocks the submission itself;
  -- purely informational for whoever reads this table.
  email_status TEXT NOT NULL DEFAULT 'skipped',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contact_messages_ip_hash_created_at_idx
  ON contact_messages (ip_hash, created_at);

COMMIT;

-- Run once: psql "$DATABASE_URL" -f db/migrations/037_contact_messages.sql
