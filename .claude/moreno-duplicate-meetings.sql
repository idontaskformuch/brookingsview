-- Moreno Valley duplicate meetings (same eSCRIBE meeting stored twice under different content_hash).
-- Keep 2193 and 2194; delete 13786 and 13788. Run in the Neon console, one block at a time.
-- Checked read-only 2026-10-21: nothing references 13786/13788 (6 FK tables = 0 rows, no stories
-- for any of the four ids, no slug/URL/redirect mentions anywhere in the DB or the repo).

-- ============ STEP 1: SELECT -- shows the four rows; the pairs must share the same GUID and date ====
SELECT id,
       body,
       meeting_date,
       raw_data->>'ID'  AS escribe_guid,
       created_at,
       CASE WHEN id IN (2193, 2194) THEN 'KEEP' ELSE 'DELETE' END AS plan
  FROM meetings
 WHERE id IN (2193, 2194, 13786, 13788)
 ORDER BY meeting_date, id;
-- Expect 4 rows: 2193 KEEP + 13786 DELETE (same guid c5f15e68-...), 2194 KEEP + 13788 DELETE (same guid 604f1e64-...).

-- ============ STEP 2: SELECT -- nothing may reference the rows to delete (every count must be 0) =====
SELECT 'meeting_decisions'            AS tbl, count(*) FROM meeting_decisions            WHERE meeting_id IN (13786, 13788)
UNION ALL SELECT 'project_updates',              count(*) FROM project_updates              WHERE meeting_id IN (13786, 13788)
UNION ALL SELECT 'project_match_review_queue',   count(*) FROM project_match_review_queue   WHERE meeting_id IN (13786, 13788)
UNION ALL SELECT 'project_new_candidate_queue',  count(*) FROM project_new_candidate_queue  WHERE meeting_id IN (13786, 13788)
UNION ALL SELECT 'project_updates_checkpoints',  count(*) FROM project_updates_checkpoints  WHERE meeting_id IN (13786, 13788)
UNION ALL SELECT 'stories',                      count(*) FROM stories                      WHERE meeting_id IN (13786, 13788);

-- ============ STEP 3: DELETE, in one transaction ======================================================
-- The guard only deletes a row if a lower-id keeper with the SAME eSCRIBE guid and date exists,
-- so it cannot remove anything that is not a duplicate. RETURNING must show exactly 2 rows.
BEGIN;

DELETE FROM meetings m
 WHERE m.id IN (13786, 13788)
   AND m.town_id = 'moreno_valley_ca'
   AND EXISTS (
         SELECT 1 FROM meetings k
          WHERE k.id IN (2193, 2194)
            AND k.town_id = m.town_id
            AND k.raw_data->>'ID' = m.raw_data->>'ID'
            AND k.meeting_date = m.meeting_date
       )
RETURNING m.id, m.body, m.meeting_date;

-- If RETURNING did not show exactly 2 rows (13786 and 13788), run ROLLBACK; instead of COMMIT;.
COMMIT;

-- ============ STEP 4: SELECT -- control: 2193 and 2194 remain, 13786 and 13788 are gone ================
SELECT id, body, meeting_date, raw_data->>'ID' AS escribe_guid
  FROM meetings
 WHERE id IN (2193, 2194, 13786, 13788)
 ORDER BY id;
-- Expect exactly 2 rows: 2193 and 2194.
