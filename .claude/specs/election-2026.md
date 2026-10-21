# Election 2026 handoff: How to vote + local results -- pasted by owner 2026-10-21

Applies to: Brookings, Moreno Valley, Broomfield. Election Tuesday 3 November 2026.
Owner working rule for this spec: "Committa inget förrän jag säger till" (code/pages are NOT committed until the owner says so; overrides
commit-locally-per-step for this work). Priority order 2026-10-21: Phase 1 done Fri 23 Oct (nav phase 1 finished in parallel);
Phase 2 starts Mon 26 Oct with 2a (inventory) first.

| Phase | Content | Deadline |
| --- | --- | --- |
| 1 | `/vote` per town: date, places, deadlines, official links | Fri 23 Oct |
| 2 | `/election-results` per town: fetch from county, render, cron | Mon 2 Nov (dry run) |
| 3 | Election night + recount: tighter cron, then taper to certification | 3 Nov -> certification |

Races in scope:
- Moreno Valley: Mayor, City Council District 2 and District 4. Include local school-board and measure races if Riverside County's results
  source tags them per jurisdiction. https://moval.gov/departments/city-clerk/2026-election.html ;
  https://ci.moreno-valley.ca.us/departments/city-clerk/pdfs/2026_Council_Candidate_Information_ElectionTracker.pdf
- Broomfield: the contests City and County of Broomfield itself reports. Candidate list NOT verified -- fetch from the official source.
- Brookings: the contests Brookings County or SD Secretary of State report for the county. Open question: any purely municipal races in
  November? Verify, do not assume.

## Hard rules (above everything else)
1. NO AI-generated text on the election pages. Numbers, names, percentages and status rendered deterministically from source data. The content
   pipeline and pre-publish gate are not used here.
2. Neutrality. Candidates in ballot order per the source, otherwise alphabetical. No judgements, no party colours, no commentary. No "winner" or
   "leading" text until the county reports final results.
3. Official sources only: county, state SOS or city clerk. No Ballotpedia, news sites or other third parties.
4. Unofficial until certified. Every results view shows "Unofficial results", the source's update time, fetch time and a link to the source.
   For California add a line that counting continues for weeks after election day.
5. Fail closed. On error or invalid data the last valid snapshot stays. Empty, zeroed or partial data is never published.
6. Every date and address on `/vote` has a source URL in config. No source = the field is not published.
7. Respect sources: follow robots.txt and crawl-delay, clear User-Agent. Bot protection is never bypassed.

## Phase 1: `/vote`
One static page per town built from a new `election` block in the town config. No API calls at view time. Google Civic Information API
(voterInfoQuery) needs an address per call and is NOT used in phase 1 (possible later via the Worker router).

Config schema:
```yaml
election:
  enabled: true
  election_date: 2026-11-03
  authority: { name, url, phone }
  registration: { url, deadline?, same_day_note? }
  mail_ballot: { mailed_on?, return_by_mail_by?, received_by?, tracking_url? }
  in_person: [{ name, address, lat, lng, dates, hours, source_url }]
  drop_boxes_url?            # link to the official list, do not copy the list
  polling_place_lookup_url
  sample_ballot_url?
  races_in_scope: [...]      # used by phase 2
  sources: [url, ...]
```
The build must fail loudly if a filled-in field lacks a source URL (same principle as the missing-asset check).

Content per town (verify against the source before entering):
- Broomfield: ballots mailed 9 Oct. Voter Service and Polling Center open 19 Oct - 3 Nov. Mon 26 Oct is the last recommended day to mail the
  ballot; that row must be prominent. https://www.broomfield.org/3530/Important-Dates ; https://broomfield.org/4369/Election-Information
- Moreno Valley: registration via registertovote.ca.gov, Vote by Mail via Riverside County Registrar of Voters. Link to the ROV polling-place
  lookup per ZIP (92551, 92553, 92555, 92557) instead of copying the Vote Center list. https://voteinfo.net/node/1276
- Brookings: open question. Find Brookings County auditor/election page and SD SOS voter lookup. Fill only fields that can be sourced.

Page structure: 1) lead sentence with election date and days left (computed at build); 2) "Key dates" table, passed dates not shown as upcoming;
3) "Where to vote": places from config + link to the official polling-place lookup; 4) "What's on the ballot": list of contests in scope +
link to the official sample ballot, no candidate descriptions; 5) sources and "Last checked" date.

## Phase 2: `/election-results`
Each county gets its own adapter. Results stored as snapshots in Neon, rendered deterministically. No free national results API (AP is paid).

2a. Source inventory (REPORT BACK before any code is written):
- Riverside (Moreno Valley): where ROV publishes election-night results; JSON/XML/CSV besides HTML? Test against the June 2026 primary if still up.
- Broomfield: ENR platform with export, or only HTML/PDF? Test against the 30 June 2026 primary.
- Brookings / SD: does SD SOS have machine-readable results per county? Test against the latest finished election.
Report per source: URL pattern, format, robots.txt, update frequency, whether a "last updated" timestamp exists in the data. Do not guess November
URLs. HTML parsing is OK if no export exists.

2b. Schema:
```
election_contests(id, town_id, election_date, source_contest_id, name, jurisdiction, seats, ballot_order)
election_snapshots(id, town_id, election_date, source_url, source_updated_at, fetched_at, raw_hash, raw_payload, valid bool)
election_results(snapshot_id, contest_id, choice_name, choice_order, votes, pct)
election_turnout(snapshot_id, ballots_counted, registered?, precincts_reporting?)
```
Raw data stored in full. Old snapshots are never deleted.

2c. Validation per snapshot -- `valid` only if ALL hold: every contest in races_in_scope matched on source_contest_id (never fuzzy names); votes are
integers >= 0 and never decrease vs the previous valid snapshot (a decrease blocks and is flagged); pct recomputed from votes within 0.1 pp of
the source pct if given; candidate set identical to the previous valid snapshot.

2d. Cron: before 3 Nov 20:00 local = no fetching, page says "Results will appear after polls close"; election night 20:00-02:00 local = every
10 min (longer if crawl-delay requires); 4 Nov -> certification = twice a day; after certification stop, page marked "Certified" if the source says
so. Each new valid snapshot triggers a rebuild via the existing deploy hook. Evaluate whether GitHub Actions cron suffices for election night or a
Cloudflare Cron Trigger on the existing Worker is needed; choose and justify.

2e. Rendering: each contest a card; candidates in choice_order with votes, percent and a horizontal bar in a single neutral colour. Top of page:
`Unofficial results · Updated by [source] at [time] · Fetched at [time]`

## Integration and lifecycle
- CityStatus: new module `election`. Before election day "Election Day: Tue Nov 3 · How to vote". After 20:00 on 3 Nov "Results: unofficial,
  updated [time]". Outside the window returns null (null-means-omit).
- Nav: temporary link "Election 2026" until certification. RelatedContent links to `/vote` from `/city-hall` and `/events`.
- SEO: both pages indexable and in sitemap. Title/H1 per the title-tag pass, e.g. "How to Vote in Broomfield: Nov 3, 2026 Election".
  BreadcrumbList yes, no Article schema on the results page.
- IndexNow: ping `/vote` at publication and `/election-results` at the first valid snapshot.
- After the election: `/vote` shows "The 2026 election is over" with a link to the results and becomes noindex 30 days after. Results page becomes
  a permanent archive at `/election-results/2026-11-03`, with a 301 from the short URL after certification.
- Gating: everything driven by `election.enabled` per town, never by hardcoded town names. Cross-town leakage verified with the existing build check.

## Acceptance criteria
Phase 1 (by 23 Oct): astro check 0 errors and all three towns build clean; every date and address has a source URL and is manually checked
against the source; build fails when a field lacks a source (tested by deliberately removing one); passed dates not shown as upcoming; no data
leaks between towns.
Phase 2 (dry run by 2 Nov): 2a inventory reported and approved before adapters are built; each adapter tested against a finished election;
validation blocks decreasing votes, missing contest, changed candidate set and empty response (a fixture per case); on error the last valid
snapshot stays with its timestamp; no AI calls in any code path of the election pages (grep-verified); cron dry-run with simulated election-night
time incl. rebuild trigger; "Unofficial" row, source time and fetch time on all results views.
Election night: first real snapshot reviewed manually against the source page for each town before any link is shared.

## Open questions
Any purely municipal races in Brookings on 3 Nov? Export formats of the three results sources (answered by 2a)? Is GitHub Actions cron enough for
election night, or is a Cloudflare Cron Trigger needed?
