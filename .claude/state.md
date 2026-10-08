# State

Master spec: HANDOFF_journey_cleanup_events.md (current phase only) -- not found on disk, using in-context copy
Current: Phase 1 DONE and pushed (387e287). Starting Phase 2.

## Status
- Phase 0: DONE, pushed (1cc6055)
- Phase 1: DONE, pushed. Timezone fix (28d1128), recurring-merge pass 1+2
  (a52227b, 2850995; 1033 rows superseded), bare-state-code fix (9b5c26e),
  AI-fabrication guardrail (8935084), stale-body regen (79dbc0e, 20/24 fixed
  live). Confirmed clean: 20/20 regenerated rows + 3 fresh live-source
  spot-checks all correct.
- Phase 2: STARTING. First item per owner: Broomfield has 0 events (webtrac
  source disabled) -- point 2d.

## Known residuals (owner aware, logged not dropped)
- 4 rows still template_fallback (incl. audit's "Corpse Bride" example) --
  both AI attempts rejected for unrelated reasons, old body left as-is.
- 2 is_recurring_series rows need a full merge rebuild to regenerate -- skipped.
- 11 duplicate-title groups still lack a canonical series row.
- Venue-name-dropping (ICS feeds lack venue names): accepted, no paid geocoding.
- Local stash "superseded-broomfield-draft": still present, owner's to drop.

## New rule
CLAUDE.md rule 7: live-DB writes need owner approval, same as push, unless
already explicitly ordered in the same instruction.

## Next
Phase 2, point 2d: Broomfield event source investigation. Then 2a-2c
(weekend front-door structure), per the master spec.
