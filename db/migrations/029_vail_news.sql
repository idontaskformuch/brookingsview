-- 029_vail_news.sql
--
-- Vail Resorts corporate newsroom feed, Broomfield-only (see Handoff: "Vail
-- Resorts news section (/vail-resorts) — Broomfield only"). NOT hyperlocal
-- content -- a mirrored feed of the company's own news.vailresorts.com
-- listing, since Vail Resorts is Broomfield's HQ employer-brand. Town-scoped
-- via town_id exactly like every other table here, even though in practice
-- only broomfield_co will ever have rows -- consistent with the rest of the
-- schema rather than a one-off global table.
--
-- external_url       the RESOLVED absolute URL (dated-slug, vanity-slug, or
--                     ?item=N query-param form -- news.vailresorts.com uses
--                     all three for different items in the same listing,
--                     confirmed live 2026-08-27) -- dedup key. NOT the source
--                     platform's internal item id, since that's only present
--                     for the query-param shape.
-- categories          text[] -- an item can carry more than one category tag
--                     (e.g. {'Do Right + Do Good','Heavenly'}, confirmed
--                     live), not just one.
-- teaser              the listing page's own excerpt, stored VERBATIM -- see
--                     the copyright guardrail in the handoff: this feature
--                     never fetches/stores/rewrites full release bodies.
-- image_url           may be null; hotlinked from the source's own CDN when
--                     present, never re-hosted (see image_source).
-- image_source        'vailresorts' | 'prnewswire' -- which origin the
--                     hotlinked image_url actually points at, since the
--                     fallback source (PR Newswire) serves images from a
--                     different CDN (mmx.prnewswire.com) than the primary.
-- is_translation      true for a detected Spanish-language duplicate of an
--                     English item (news.vailresorts.com publishes both as
--                     separate listing entries, same date, no lang attribute
--                     to key off -- see vail_news_v1.py's stopword heuristic).
--                     Flagged, not deleted, so a false positive is
--                     recoverable without a re-scrape; excluded at render
--                     time instead.
--
-- published_at is DATE, not TIMESTAMPTZ -- the source only ever gives a date
-- ("Aug 18, 2026"), never a time of day. Format via Postgres to_char() in
-- the read query, not via JS Date on the way out (see the Workplace Watch
-- timezone bug this handoff explicitly calls out).
--
-- Körs en gång:  psql "$DATABASE_URL" -f db/migrations/029_vail_news.sql

BEGIN;

CREATE TABLE IF NOT EXISTS vail_news (
    id              BIGSERIAL PRIMARY KEY,
    town_id         TEXT NOT NULL REFERENCES towns(town_id),
    external_url    TEXT NOT NULL,
    title           TEXT NOT NULL,
    published_at    DATE NOT NULL,
    categories      TEXT[] NOT NULL DEFAULT '{}',
    teaser          TEXT,
    image_url       TEXT,
    image_source    TEXT,
    is_translation  BOOLEAN NOT NULL DEFAULT false,
    content_hash    TEXT NOT NULL,
    snapshot_id     BIGINT REFERENCES source_snapshots(id),
    first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (town_id, external_url)
);
CREATE INDEX IF NOT EXISTS idx_vail_news_town_published ON vail_news (town_id, published_at DESC);

COMMIT;
