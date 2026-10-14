# State

2026-10-14 4-point task. Pts 1-3 DONE (DB written, committed, NOT pushed).
Pt 4: research+design only, nothing built (owner's explicit call).

P1: migration 053 run via psycopg (psql not installed here) + verified.
Historical report = all zeros, expected (no backfill). Pushed (0872a4b).
P2: scripts/find_duplicate_meetings.py (2ebc72a) -- true dup needs
EventTime+EventLocation match, not just body+date. Live: 0 true dups/16
explained non-dups, 0 pairs marked. "Public notice" badge (c0c340d) on
quorum-notice stories, StoryCard/Lead/SecondaryStory.
P3 (7545e75): 10 MV pairs verified (same eSCRIBE GUID/StartDate/body, all
from one 2026-10-01 mass-reinsert). 8/10 identical content->newer
canonical; 2/10 (Sep15 pairs)->OLDER canonical, owner's call, newer row
lost real agenda_text. generate_duplicate_story_redirects.py replaces
hand-written redirect json, regenerates from superseded_by_slug.
P4: confirmed MatterHistoryId==EventItemId on 30 items/3 meetings. New:
recent meetings (<~3wk) lack MatterHistory (sync lag). New: consent-agenda
items' votes live under a shared block EventItemId (100495's votes point
to 100730). Owner's decision: show block vote + "via Consent Agenda"
label on each item, don't leave NULL. NOT implemented.

Bug/gotcha: astro build has no per-town outDir -- concurrent SITE_CITY
builds corrupt the same dist/. Build sequentially, move dist/ aside first.

Verified before commit: vitest 998/998, pytest 765/8skip, astro check 0
errors, all 3 towns build clean, sitemap/noindex-disjoint OK (106/139/78).

Untouched: cf-bot-fight-probe.yml (owner: leave it, pre-existing).

Next: owner approval to push (2ebc72a, c0c340d, 7545e75). Then decide on
building Phase 7's vote-tally feature.
