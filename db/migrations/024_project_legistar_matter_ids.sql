-- Brookings City Hall Project Pages (see NEEDS-HUMAN-REVIEW.md, "Brookings
-- -- City Hall Project Pages"). Legistar's own Matter object is already a
-- threaded project entity (its MatterHistories endpoint returns the full
-- cross-meeting timeline for one Matter directly, no case-number/keyword
-- matching against agenda text needed the way eSCRIBE's PDF-only approach
-- required) -- but a real project sometimes spans more than one Matter
-- (e.g. two separate "Resolution of Intent to Lease" actions a year apart
-- for the same real-world lease relationship, or a Planning Commission
-- recommendation and the City Council ordinance that enacts it are two
-- distinct Matters). A plain array, mirroring case_numbers' shape.

BEGIN;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS legistar_matter_ids INT[] NOT NULL DEFAULT '{}';

COMMIT;
