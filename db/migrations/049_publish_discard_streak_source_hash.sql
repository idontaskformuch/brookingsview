-- 049_publish_discard_streak_source_hash.sql
--
-- Reset path for the retry cap (db/migrations/048_publish_discard_streak.sql):
-- without this, a record permanently given up on stays given up forever,
-- even after a human fixes the underlying source data (e.g. a corrected
-- agenda, a scraper fix) or a guardrail gets loosened. source_content_hash
-- stores the raw record's OWN content_hash (meetings.content_hash /
-- events.content_hash -- already computed by the scraper, not a new hash
-- scheme) at the time of each discard; when a record's current
-- content_hash no longer matches what's stored here, publish.py treats it
-- as effectively new data and resets the streak, un-giving-up the record
-- if it had already crossed the threshold.
--
-- Named source_content_hash, not content_hash, to avoid confusion with
-- stories.content_hash (a hash of the GENERATED text, used for a different
-- purpose -- weekly.py-style idempotency against unchanged source data,
-- not retry-cap bookkeeping).

BEGIN;

ALTER TABLE publish_discard_streak ADD COLUMN IF NOT EXISTS source_content_hash TEXT;

COMMIT;
