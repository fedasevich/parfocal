# 0114. Tasks the thesis assignment adds, and thesis material kept private

- Date: 2026-10-31
- Status: Accepted
- Deciders: owner, Claude
- Backlog: GUIDE-012 (least sure first order), TEST-019 (application performance on main paths), GUIDE-002 (guided review)

## Context

Parfocal is the practical part of the owner's master's thesis. The assignment sent to the supervisor on 2026-10-27 asks for a review in which pathologists confirm or correct model outputs "starting with those the model is least sure of", and for measuring "the performance of the rendering and of the application as a whole". No backlog task built either. Guided review (GUIDE-002) shows one object at a time but names no order, and the performance tasks (VIEW-040, TEST-006) cover only the viewer.

This repository is public, and FIT runs submitted theses through plagiarism detection that compares them with what is published online. Until now the thesis plan sat in `docs/project/thesis.md`.

## Options considered

1. Keep the thesis plan, guidance and tasks in this repository's `docs/`. Everything is on one board, but the plan and guidance are public and the thesis tasks mix with product tasks.
2. Keep every piece of thesis material in a private repository and add only the product tasks the assignment needs here.

## Decision

Option 2. The thesis plan, its writing guidance, its decisions, its tasks and the text live in the private repository `fedasevich/parfocal-thesis`, checked out next to this one. This repository keeps only what the product must do.

- GUIDE-012 (least sure first order) orders each reviewer's objects by the model's certainty, lowest first, with unscored objects after them in the task's fixed random order.
- TEST-019 (application performance on main paths) measures opening a slide, a jump, importing result sets, a model run on a whole slide and the step from a verdict to the next object, each against a budget.
- GUIDE-002 (guided review) depends on GUIDE-012, because guided review shows objects in that order.

## Consequences

- `docs/project/thesis.md` moved to the private repository. Its earlier versions stay in this repository's git history.
- A thesis section is drafted when the Parfocal tasks it describes are ticked, which the private repository reads from this backlog. Nothing here depends on the thesis.
