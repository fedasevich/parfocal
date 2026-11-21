# Result: production reseed time by phase

- Date: 2026-11-21
- Backlog: PROTO-139 (the production reseed finishes in under 15 minutes)
- Kind: benchmark
- Commit: before is 69dbfd6c, after is the PROTO-139 perf commit on top of it
- Environment: Apple M4, macOS 15.8.1, local Postgres in the parfocal compose project, seed connections sent through a local TCP proxy that holds every server reply for 85 ms
- Data: the showcase seed with an owner, one viewer and one agent email, a published fixture store and in-memory result objects (no PHI)

## Question

Why did the reset-production workflow take 49 to 81 minutes on 2026-11-20, where does the time go, and what brings it under 15 minutes.

## Method

The production logs give only a few real-time markers. The seed's own stdout is block buffered and reaches the log when the process exits. The one unbuffered marker is a Pydantic warning on stderr, raised early in the seed's first project phase. For each run, the time from the fixture output to the warning covers the truncate, the tenant object delete loop and the start of the seed. The time from the warning to the end covers the rest of the seed.

To get a round trip time, a local copy of the seed was counted with the proxy. It makes 10073 database round trips, 414 of them before the warning. The production tail after the warning took 812 s and 1191 s in the two runs that finished. Divided by the 9659 trips after the warning, that is 84 ms and 123 ms per trip. That is an upper bound for the network round trip, because it also holds the R2 calls and CPU time. The older releases in those runs seeded fewer clinical cases than today's tree, so their trip count was lower and the real time per trip somewhat higher. The local runs used 85 ms.

The local seed was timed with a scratch script that wraps each seed phase, counts statements with a SQLAlchemy cursor event and counts round trips in the proxy. After the change, a lock sampler read `pg_stat_activity` every 0.2 s to find waits between workspaces. Row counts of every table, the set of audit pseudonym subjects and the audit actions with their counts were written after a seed before and after the change and compared.

## Results

Production runs on 2026-11-20, from the workflow log timestamps.

| Run | Reset step | Fixtures done | Fixtures to warning | Warning to end |
| --- | --- | --- | --- | --- |
| 44760086368 | 60.6 min | 14 s | 2429 s | 1191 s |
| 44791869203 | 52.0 min | 204 s | 2106 s | 812 s |
| 44827393394 | cancelled after 79.5 min | 15 s | 3586 s | over 1171 s |

Whole workflow durations of earlier reseeds were 16, 27, 18, 27 (failed) and 49 minutes from 2026-11-19 to the morning of 2026-11-20. Both finished runs above logged "0 tenant objects" removed.

The local seed at 85 ms per round trip, before the change.

| Phase | Statements | Seconds |
| --- | --- | --- |
| Workspaces, people and owner | 69 | 6.7 |
| Projects, states and styles, 3 workspaces | 2153 | 199.4 |
| Gallery tours, 3 workspaces | 3512 | 321.5 |
| Viewer and agent seats | 48 | 6.9 |
| Annotation examples | 1020 | 97.0 |
| Adjudications | 104 | 24.5 |
| Cell tour seats | 63 | 6.9 |
| Clinical cases | 1841 | 214.8 |
| Whole seed | 8828 | 885.1 |

The local seed at 85 ms per round trip, after the change.

| Phase | Seconds |
| --- | --- |
| Workspaces, people and owner | 6.9 |
| Projects and gallery tours, 3 workspaces side by side | 191.3 |
| Viewer and agent seats | 7.7 |
| Example actor pseudonyms | 5.3 |
| Annotations, adjudications, cell tour seats and cases, 3 workspaces side by side | 118.6 |
| Whole seed | 332.5 |

Statements are not split by phase after the change, because the phases overlap.

Round trips went from 10073 to 10409, and the seed's statement count from 8828 to 8834. Every table's row count, the audit pseudonym subjects and the audit action counts were the same before and after.

The first side by side run, without the shared pseudonyms created up front, took 472.6 s. The lock sampler showed the workspaces waiting on each other's `INSERT INTO audit_people`, since the seeded people are the same users in every workspace. After the pseudonyms were created up front, the sampler saw no lock waits.

## Interpretation

Two costs add up. The larger one is before the seed. The time from fixtures to the warning grew from 2106 s to 3586 s across runs, while the seed's start is about 414 round trips, under a minute. Each reset deletes tenant objects one serial request at a time. The seven day bucket lock on `t/` refuses every delete, so the list of keys grows with each reseed and none are ever removed. This is the likely cause. The truncate inside the same window was not timed separately, and the number of keys under `t/` was not read, so the split is not measured. The reset now prints the time of each phase to stderr, so the next run gives the split.

The seed itself is about 10000 round trips spread over more than 45 statement shapes from real API code paths, so batching any one shape saves little. Running the three workspaces side by side cuts the measured seed from 885 s to 333 s at 85 ms. Tenant deletes now run 32 at a time, which divides the delete loop by up to 32 for the same keys. That number is from the code, not measured against R2.

## Follow-ups

- TODO: the next production reseed prints `reset: <phase> took N s` lines, which give the real truncate, delete and seed split. Read them before closing PROTO-139.
- If the deployed reseed is still over 15 minutes, the next step is to skip `t/` keys younger than the lock age before sending deletes, or to run the seed next to the database.
