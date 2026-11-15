# 0337. Layout experiments split only production users who have not chosen, and pinned means bottom right

- Date: 2026-11-15
- Status: Accepted
- Deciders: Parfocal agents, owner to review
- Backlog: EXP-004 (layout experiments)

## Context

Kit decisions D6 and D8 leave two layouts open: viewer tools in a left rail or a bottom dock, and a minimap that moves to the quietest corner or stays pinned. ADR 0336 (flag targeting rules and PostHog over HTTP) gave typed flags and an `experiment_exposed` event. The tools layout is also a personal setting, and the fake API serves stable ids that every browser and screenshot test depends on.

## Options considered

1. Split everyone in every environment, and let the arm override the setting.
2. Split only in production against the real API, let a personal `tools` setting beat the arm, and pin the minimap to one fixed corner.
3. Run the experiments only through PostHog variants, with the local file in `default` mode.

## Decision

Option 2. Two flags, `viewer_tools_layout` (`rail`, `dock`) and `minimap_motion` (`moving`, `pinned`), both in `split` mode with today's layout as default. `useArm` asks the experiments only when the build is `prod` with the fake API off, the person's ids are pseudonymous, and returns the default otherwise, so dev, test and screenshots never change. A `tools` value the person saved wins over the arm, and such a person is never asked for the arm or exposed, because overriding a choice would annoy and pollute the comparison. The tools arm is asked only once the setting layers have loaded. The pinned minimap sits bottom right, the corner the moving placement already prefers, so the arms differ only in motion. The analysis query lives in `apps/web/analytics/layout-experiments.hogql` and compares, per arm after first exposure, review tasks finished and abandoned, median review time, viewer chrome coverage, tools selected and SEQ and SUS scores.

## Consequences

- Dev builds cannot preview an arm except the dock through the `tools` setting. A preview override is a later step if wanted.
- People who chose a tools layout fall out of that experiment, so its sample is smaller than the minimap one.
- TODO: the owner creates, in the PostHog EU project, the multivariate flags `viewer_tools_layout` and `minimap_motion` with the same variant names, and saves the query as a HogQL insight.
