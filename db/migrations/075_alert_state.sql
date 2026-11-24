-- Alert state (owner 2026-11-24, "larmbrus"): one row per ongoing problem, so the same problem gives ONE alert when it appears, ONE reminder
-- per day while it lasts and ONE "resolved" message when it is gone, instead of one alert per run (scrapers/alert_state.py).
-- alert_key names the problem, never its wording (e.g. 'freshness|ops.sport-freshness|glasgow|/glasgow/sportspress_calendar:queens-park').
-- resolved_at NULL = still open. A problem that returns after being resolved reopens the same row (first_seen_at starts over).
CREATE TABLE IF NOT EXISTS alert_state (
    alert_key        text PRIMARY KEY,
    first_seen_at    timestamptz NOT NULL DEFAULT now(),
    last_notified_at timestamptz NOT NULL DEFAULT now(),
    last_message     text NOT NULL,
    notified_count   integer NOT NULL DEFAULT 1,
    resolved_at      timestamptz
);
