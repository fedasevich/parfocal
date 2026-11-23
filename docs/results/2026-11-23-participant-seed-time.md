# Result: one study participant's project seeds in about 1 s and about 270 statements locally

- Date: 2026-11-23
- Backlog: EXP-016 (each study participant starts from the same fresh seeded project)
- Kind: local benchmark
- Commit: the EXP-016 commit on top of cb3f2ca7
- Environment: Apple M4, local Postgres in the shared parfocal compose project, a fresh migrated test database, no latency proxy
- Data: `seed_participant` with the test `EmptyStore` and an in-memory result store, no seat email (no PHI)

## Question

How long does seeding one participant's study project take, and how many statements does it send, against about 15,000 for the full showcase seed?

## Method

`apps/api/tests/test_study_projects.py` seeds P1 into an empty database, then P2. It counts every statement through a SQLAlchemy `before_cursor_execute` listener and times each call with `time.monotonic()`. One run.

## Results

| Code | What it also made | Statements | Wall time |
| --- | --- | --- | --- |
| P1 | the study workspace and its people | 296 | 1.04 s |
| P2 | nothing else | 266 | 1.00 s |

## Interpretation

A participant's seed is about 2% of the full seed's statements. At the round trip that put the full seed near 100 s on the Modal seed function, the same share would be about 2 s plus the function's cold start. That is an estimate, not a measurement. The test holds the count under 400 statements and the local time under 10 s.

## Follow-ups

- TODO: run `python -m parfocal_deploy.study seed P1` on the dev app after the next deploy and record the `reset: study seed P1 took N s` line against the 30 s goal.
