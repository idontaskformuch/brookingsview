# State

2026-10-14, Phase 8 ("Month in <Town>") research — no code built, per
  owner's "research first, build nothing" instruction. Full findings:
  .claude/phase8-research.md.

DECISIONS/FINDINGS: (1) Only moreno_valley_ca clears the spec's "≥4 modules
  have data" bar, from Aug 2026 (projects+events+traffic+jobs); brookings_sd
  has 3 real modules (decisions/events/jobs, no sales/traffic), broomfield_co
  has 2 (traffic/jobs only — its events rows are NWS alerts, not real
  events, per earlier investigation) — so build order is MV first, matches
  owner's "city with most data" instruction. (2) No age-based retention/
  purge found on any of the 6 module tables (grep for DELETE FROM across
  repo) — traffic_incidents is mutated in place (last_seen_at bumped) not
  append-only, everything else is append-only forever. (3) Jobs must group
  by OUR scrape month (created_at, starts Aug 2026 all 3 towns) never
  Adzuna's own posted_at (goes back to 2024) — grouping by posted_at would
  invent coverage we don't have. (4) Recommend LINK not replace against the
  existing moreno-valley-only AI home_sales_digest/archive (Phase 8 is
  explicitly no-AI v1; replacing would lose the only real editorial content
  for that topic and 2 of 3 towns have zero property_sales rows anyway).
  Proposed URLs/linking/noindex gate/template sentences all in the research
  file, awaiting owner go-ahead before building.

KNOWN BUGS: none new this session.

Next: owner reviews .claude/phase8-research.md's proposals (link vs
  replace, URL structure, publishable-months rule); on approval, build
  Moreno Valley only, Aug or Sep 2026, noindex until ≥4 modules (already
  true for both).
