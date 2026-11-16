status: review
by: claude parallel run
branch: claude/quirky-pascal-htseil
since: 2026-11-15
note: Not done on purpose. ci-ok is a required check on main (ruleset 24612221, active). The baselines are still to be generated with gh workflow run ci -f update_goldens=true and committed, but doing it now would go stale because the ui stories keep changing on the train. Do it once after the train merges, then confirm a second run is stable.
