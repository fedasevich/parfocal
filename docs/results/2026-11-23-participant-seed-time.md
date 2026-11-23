# Result: one study participant's project seeds in under 2 s and about 360 statements locally

- Date: 2026-11-23
- Backlog: EXP-016 (each study participant starts from the same fresh seeded project)
- Kind: local benchmark
- Commit: the EXP-016 commits on top of main after 708a71ea
- Environment: Apple M4, local Postgres in the shared parfocal compose project, a fresh migrated test database, no latency proxy
- Data: `seed_participant` with the test `EmptyStore` and an in-memory result store, no seat email (no PHI)

## Question

How long does seeding one participant's study project take, with its region slides, queue, annotate slide and cell review, and how many statements does it send, against about 15,000 for the full showcase seed?

## Method

A scratch script used the helpers of `apps/api/tests/test_study_projects.py` to seed P1, P2 and P3 one after another into one empty database. It counted every statement through a SQLAlchemy `before_cursor_execute` listener and timed each call with `time.monotonic()`. One run.

## Results

| Code | What it also made | Statements | Wall time |
| --- | --- | --- | --- |
| P1 | the study workspace and its people | 387 | 1.32 s |
| P2 | nothing else | 357 | 1.63 s |
| P3 | nothing else | 357 | 1.73 s |

Before the cell review was added, one participant took 266 statements and 1.00 s.

## Interpretation

A participant's seed is about 2.5% of the full seed's statements. At the round trip that put the full seed near 100 s on the Modal seed function, the same share would be about 2.5 s plus the function's cold start and the cell chunk writes to R2. That is an estimate, not a measurement. The test holds the count under 450 statements and the local time under 10 s.

## Follow-ups

- TODO: run `python -m parfocal_deploy.study seed P1` on the dev app after the next deploy and record the `reset: study seed P1 took N s` line against the 30 s goal.
