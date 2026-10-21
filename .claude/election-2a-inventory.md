# Election phase 2a: results source inventory (2026-10-21, read-only, no November URLs fetched)

## Riverside County (Moreno Valley) -- voteinfo.net (ROV)
- Results published as PDFs under https://voteinfo.net/sites/g/files/aldnop371/files/ElectionResults/2026/<Mon><DD>/ElectionSummaryReportRPT<NN>.pdf
  (seen: 2026/Jun24/...RPT25.pdf, 2026-06/ElectionSummaryReportRPT19.pdf). Both returned 200 application/pdf to curl. Folder/RPT numbering
  is per update, NOT predictable -> need the index page to discover URLs.
- voteinfo.net home page returns 403 to curl (Cloudflare challenge, same as phase 1 note). Not bypassed. Index/HTML results page NOT inspected.
- robots.txt (via 301 to https://voteinfo.net/robots.txt): standard Drupal, no Disallow on ElectionResults, no Crawl-delay.
- Format: PDF confirmed; JSON/XML/CSV NOT found (unverified, blocked by 403). Update frequency: June 2026 had semi-final updates on
  Jun 3, 12, 18, 24, 26 (certified Jun 26; 550,840 ballots) per press. "Last updated" timestamp inside PDF: NOT verified (PDF text not extracted).
- Risk: automated fetch of the index page will likely meet the 403 challenge. Decision needed (ask ROV for a feed / use PDFs only).

## Broomfield (CO) -- Colorado SoS central ENR, not a county platform
- Counties upload to the state ENR from 7 pm; counties MAY also post on own sites. broomfield.org election pages (3530, 4369) link NO results
  and name no vendor.
- Found file: https://www.sos.state.co.us/pubs/elections/Results/ENR/files/Broomfield.pdf (200, application/pdf, 6107 B, Last-Modified
  2026-07-01 11:01Z). Same URL held the Nov 4 2025 election-night report ("Election Night 10pm Summary Report") earlier -> the file is
  OVERWRITTEN per election, so URL pattern is stable but history is lost unless we snapshot. .xml/.csv variants 404. ENR landing page
  (/pubs/elections/Results/ENR/index.html) 404 -> the live ENR app URL is not identified; machine-readable export NOT confirmed.
- robots.txt (sos.state.co.us): Disallow /apps/, /clerk/, /common/ etc.; no Crawl-delay seen; /pubs/elections/Results not disallowed. The live ENR app may sit under /apps/ (would be disallowed) -- unverified.
- Update frequency: counties upload election night after 7 pm MT; canvass starts Fri 2026-11-20 (broomfield.org). broomfield.org robots: Crawl-delay 20 only for Siteimprove bots.
- Historical certified data: historicalelectiondata.coloradosos.gov (county abstracts).

## Brookings / SD -- electionresults.sd.gov (SD SOS)
- ASP.NET site backed by https://sdresws.azurewebsites.us/ (JS calls it). Pages: Statewide / Legislative / County Races and Ballot Questions /
  Local Races / Voter Turnout / Results by County / Exports / Possible Recounts / Provisional. Header shows "Results last updated: <date time> CT"
  (e.g. 10/21/2026 2:35 PM CT) -> source timestamp EXISTS in HTML.
- Exports page: https://electionresults.sd.gov/ResultsExport.aspx?eid=<id> ("Statewide Export", "Legislative Export"; County export on the same
  page). Links go to Export.aspx?eid=<id> (JS-driven, "Preparing Export..."). The export file FORMAT and county-level export NOT confirmed.
  Primary 2026-06-02 = eid 773 (from search; unverified). Server sdresws.azurewebsites.us returns 200 text/html (IIS).
- robots.txt: electionresults.sd.gov/robots.txt = 404 (no restrictions stated). sdsos.gov/robots.txt blocks only named SEO bots; none apply.
- Brookings-specific: county races are under "County Races and Ballot Questions"; Brookings figures not extracted. SD certified the
  primary 2026-06-09. Nov general election (2026-11-03) already listed on the site (not fetched).

## Open items before any adapter is built (need owner call)
1. Riverside: PDF-only parsing + discovery of new PDF URLs behind a 403 challenge. Options: ask ROV for a feed; poll known URL pattern; skip.
2. Broomfield: identify the live ENR URL and whether it has an export and is robots-allowed (can't be done without opening the app; /apps/ is Disallow).
3. SD: confirm Export.aspx output (CSV/XML?) with a read-only GET against the primary eid (needs a browser-like run of the JS, or inspect script.bundle.js).
4. All three: the "last updated" source timestamp is confirmed only for SD.
