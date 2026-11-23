# 0434. Each study participant gets a project of their own, seeded fresh

- Date: 2026-11-23
- Status: Accepted
- Deciders: Claude
- Backlog: EXP-016 (each study participant starts from the same fresh seeded project)

## Context

The usability study runs on the deployed dev app ([ADR 0390](0390-app-parfocal-eu-is-a-development-environment.md), the deployed app is dev). Its tasks submit reviews, decide queued objects and draw outlines, so whatever one participant does changes the state the next one starts from. Every participant has to start from the same state, or task times cannot be compared. The full showcase seed takes about 100 s on the Modal seed function next to the database since OPS-039 (the seed runs on Modal), and it starts with a truncate of every app table. A study session should not wait on that or wipe the rest of the app.

## Options considered

- A shared reset between sessions. The whole app is truncated and reseeded before each participant. It reuses what exists, but it costs about 100 s plus the migrate and fixture steps each time, wipes every other workspace and every agent's test data, and loses the earlier participant's data unless it was exported first.
- A snapshot of one study project restored before each session. Fast to restore, but nothing in the app copies a project with its result sets, tasks and decisions, and the restore would have to follow every schema change.
- A small project per participant code, seeded from the showcase seed's parts into one study workspace. Each project is built the same way from the same fixture slides and model results, takes a few hundred statements, and leaves every other project alone.

## Decision

- A participant code such as P1 gets the project "Study P1" in the workspace `cvut-study` (ČVUT · Usability study), made the first time a participant is seeded. The workspace carries the same invented people as the showcase workspaces.
- Each project holds two slides with real model regions under the review task "Study review" for the participant's seat, two slides under "Study disagreement queue" that Rhea and Remy already reviewed and submitted with one region disagreement each and one outline disagreement, and one slide under the annotate task "Study annotation" for the seat. The seat is a project owner, so it can open the queue. Nothing runs on a GPU.
- The seat is the account the study runs under, passed as `STUDY_SEAT_EMAIL` or `--seat`. Without one, the seat is a placeholder person for the code that nobody can sign in as.
- Seeding a code that already has a live project deletes that project first, so a reseed always starts fresh. Removing a code deletes its live project through the app's own project delete, after the session's data is exported. The delete is the soft delete every project gets, so the rows and the audit trail stay until a full reset.
- `python -m parfocal_ingest.study_seed seed P1` runs it against `DATABASE_URL`. `python -m parfocal_deploy.study seed P1` and `remove P1` run it on the Modal seed function next to the database, through the same function the reset uses, by passing `STUDY_PARTICIPANT` and `STUDY_ACTION` in its settings. That command never migrates or truncates.
- A study task's start path names places in the participant's project with the tokens `{studyProject}`, `{reviewTask}`, `{reviewSlide}`, `{queueTask}`, `{queueSlide}`, `{annotateTask}` and `{annotateSlide}`. The study page fills them from the project named after the code, found by its fixed task names and slide labels. A start path whose project is not seeded yet does not resolve.

## Consequences

- A participant's seed takes about 1 s and about 270 statements locally, against about 15,000 statements for the full seed. A test holds it under 400. The deployed time is still to be measured (TODO).
- When every participant uses the same seat, that seat sees every live study project, so the moderator removes the previous participant's project before the next session.
- Deleted study projects pile up as soft-deleted rows in the study workspace until the next full reset. That is small, and it keeps every session's data recoverable.
- The study page depends on the fixed project, task and slide names. A test reads the web constants and fails when the seed renames one.
