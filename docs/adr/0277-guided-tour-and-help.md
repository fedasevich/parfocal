# 0277. The guided tour is ten steps from the mock's chapters and its progress is one personal setting

- Date: 2026-11-09
- Status: Accepted
- Deciders: Parfocal agents, owner to review
- Backlog: PILOT-001 (user help and onboarding)

## Context

PILOT-001 asks for a guided first-run walkthrough based on the mock's tour. The mock has no ten-step tour. It has a play-all walkthrough of about sixty steps in nine chapters (upload, run a model, new review task, watching progress, review, disagreements, adjudication, sign-off and report, clinical report). ADR 0267 (sign-up and setup flow) says the setup role sets "which walkthrough you see first".

## Decision

The tour has ten steps, one per chapter of the mock plus a first step on Home and a last step on keys and help. The adjudication and clinical report chapters fold into the disagreements step and the end of the tour, because they need data a new person does not have.

Each step opens its own page when it can find the project or task it needs, and otherwise stays where it is. A step may ring one element, found by selector, and shows nothing if the element is missing, so a moved button never breaks the tour.

Progress is one personal setting in the existing catalogue (ADR 0138, settings catalogue in Python): `tour_progress` is the number of steps completed from 0 to 10. Declining the first-run offer on Home saves 10, so the offer never returns, and Help can still start the tour from step one. No migration is needed because personal settings are stored as values. Stopping keeps the place, Help offers "Resume the tour", and finishing lets the tour start again from step one.

Help is a dialog from the account menu with six short topics, a way to start or resume the tour, and a link to the shortcut sheet, which stays the Shortcuts section of Settings reached by the question mark key.

## Consequences

The tour is the same for every role. A role-specific shorter tour for reviewers is a possible follow-up. A tour that acts on real controls, as the mock does, is not built, because the real screens need real data.
