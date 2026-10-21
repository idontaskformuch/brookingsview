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

---
# Beslut och uppföljning 2026-10-21

## Ägarbeslut
1. Riverside: ägaren skickar mejlet nedan. TILLS ROV sagt ja: Morenos /election-results visar bara "Official results: Riverside County
   Registrar of Voters" + länk, inga egna siffror (ingen scraping av voteinfo.net).
2. Broomfield: undersöktes, se nedan. 3. SD: undersöktes, se nedan.

## Mejlutkast till ROV (engelska; ägaren skickar, fyll i avsändare/kontakt)
Subject: Request for permitted access / data feed for election-night results (automated, non-commercial local news site)

Hello,

I run Moreno Valley View (https://morenovalleyview.com), a small independent local information site for Moreno Valley residents. For the
November 3, 2026 election we would like to link to, and show a short summary of, the Registrar's unofficial results, always labeled as
unofficial and credited to the Riverside County Registrar of Voters with a link back to voteinfo.net.

voteinfo.net currently blocks automated requests, and we do not want to work around that. Could you tell us either:
1. whether there is a permitted way to read results automatically (a data feed, JSON/XML/CSV export, or an approved URL pattern and
   polling interval), or
2. whether you would allow our crawler to be allow-listed by name?

Our crawler always identifies itself honestly as:
  User-Agent: ViewMediaBot (+https://morenovalleyview.com/contact)
It would fetch only the results files, no more often than you specify (we suggest at most once every 10 minutes on election night and
twice a day afterwards, or slower if you prefer), honor robots.txt and any rate limit, and stop at certification. Until we hear from you
we will not fetch results automatically and will only link to your site.

Thank you,
<name>, <role>, <phone/email>
Moreno Valley View - https://morenovalleyview.com/contact

## Broomfield: Colorado publishes ENR on an external platform (Clarity)
- Link on sos.state.co.us/pubs/elections/Results/ENR/countyLevelResults.html -> https://results.enr.clarityelections.com/CO/126592/web.345435/#/summary
  (June 30 2026 primary; CO = state entity, event id 126592 is per election, the November id is NOT known/guessed).
- Machine-readable, all read with our UA, all HTTP 200:
  * <base>/current_ver.txt (plain text version number, 377440) -> poll this to detect new data
  * <base>/<ver>/json/en/summary.json (gzip JSON, 197 contests; per contest CH choices, votes arrays, precincts TP/PR)
  * <base>/<ver>/json/en/electionsettings.json: "websiteupdatedat" ("7/23/2026 4:23:33 PM MDT"), file sizes, statewide precincts reporting
  * <base>/<ver>/reports/detailxml.zip -> detail.xml (425 kB): <Timestamp> in source, per-county turnout incl. Broomfield
    (totalVoters 56478, ballotsCast 22906, 2/2 precincts), per-contest ParticipatingCounties and county precinct reporting; also reports/summary.zip.
- Source timestamp EXISTS (Timestamp in detail.xml, websiteupdatedat). Broomfield-local contests (council, local questions) were not
  separately verified in the state XML; the 2025 Broomfield-only report was a separate PDF (sos.state.co.us/.../ENR/files/Broomfield.pdf, overwritten per election).
- robots.txt: results.enr.clarityelections.com/robots.txt returns the ENR app HTML (200), i.e. NO robots rules exist; a plain curl with
  no User-Agent got a 403 from the CDN, with ViewMediaBot UA all requests succeeded. No stated crawl-delay or terms read -> ask/limit polling
  to current_ver.txt every 5-10 min, fetch data only when the version changes. Clarity URL tokens (event id, web.<n>) must be read from the
  SoS ENR page for November, not guessed.

## SD: export format = XLSX, per county, via ASP.NET postback
- https://electionresults.sd.gov/ResultsExport.aspx?eid=<id> has Statewide Export, Legislative Export and one link per county; each is
  `__doPostBack('ctl00$MainContent$ctlNN','')` (Brookings = ctl12, ids step by 2 alphabetically). POST the page's hidden fields
  (__VIEWSTATE etc.) + __EVENTTARGET -> HTTP 200, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,
  Content-Disposition "Brookings Results.xlsx" (21 kB, 11 sheets). Tested read-only against primary eid=773 with our UA.
- Sheet names = contest (e.g. "REP14297Sheriff  Brookings", "NON13932School Board Member", plus US Senator/Rep, Governor, legislature, delegates...).
  Contents: title "2026 Unofficial Primary Election Results", "Precincts 686 of 686 Reporting", county name, "Downloaded at 10/21/2026 3:02:16 PM",
  per-precinct rows with candidates as columns and a TOTALS row. Candidate names have double spaces ("Mike  Rounds"). Sheet-name prefix carries a
  party code + numeric contest id; contest ids are per election (match on id, not name).
- The page also shows "Results last updated: <date time> CT" in the HTML. The XLSX has a download time only, not the source update time.
- robots: electionresults.sd.gov/robots.txt 404 (no rules). Needs openpyxl or zip+XML parsing in the adapter. Today's page already lists the
  Nov 3 general eid; the November eid must be read from the site on the day.
