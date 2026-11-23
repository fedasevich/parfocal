# XXXX. Study sessions and traces upload to the API, and the results page reads them there

- Date: 2026-11-23
- Status: Accepted
- Deciders: Claude
- Backlog: EXP-015 (study sessions and traces reach the server and the results page reads them). Builds on [ADR 0376](0376-study-replay-is-a-first-party-recorder-without-a-library.md) (study replay is a first-party recorder) and [ADR 0435](0435-per-participant-study-projects.md) (a project per study participant).

## Context

Study answers lived only in the participant browser's localStorage and traces only in its IndexedDB, so a cleared browser lost a session and the moderator could read results only on the machine that ran it. The POC and nur studies uploaded gzipped parts of each session to a Neon table `parts(sid, seq, pid, gz, size, summary, body)` and read them back on a results page. The thesis compares round 5 with round 4, so the results page also needs round 4's per-task metrics plus first click, time to first action and path straightness, which nothing defined yet.

## Options considered

- Parts as objects in the store, under the workspace prefix, as feedback screenshots are. Cheap per byte, but listing a study means listing objects and reading every answers file, and nothing in the database would say which sessions exist or which are dry runs.
- Two tables in Postgres with row security per workspace. A session row holds the latest answers as JSONB and a dry-run flag, and trace parts are gzipped bytea keyed by session and part number. One query lists a study and the answers stay queryable. A study of about 10 sessions at well under 1 MB gzipped each stays far below the Neon plan's storage.
- One table of parts with the answers inside the latest part, as the POC did. Fewer tables, but the list would decompress every session's newest part to show it.

## Decision

- The migration adds `study_sessions` (session key, participant code, round, answers JSONB, dry run) and `study_trace_parts` (session key, part number as bigint, gzipped body, size), both with the standard tenant isolation policy. It only adds.
- `PUT /api/me/study-sessions/{key}` and `PUT /api/me/study-sessions/{key}/trace/{seq}` take gzipped JSON as base64 from any member, since the participant seat may be a reviewer. Both are idempotent, so a retry never doubles a part. A part is at most 2 MiB gzipped and the answers at most 1 MiB unpacked, and anything else is a 400.
- Reading the list and a trace and marking a dry run need `create-cases`, which a researcher holds and a reviewer does not, so the study seat and the moderator can read results and a participant signed in as a reviewer cannot.
- The browser keeps an outbox of session ids and trace part numbers in localStorage. The participant page sends a session whenever its stored answers change, which happens at every task edge and final answer, and each trace part as the batcher cuts it at task edges and every minute. It retries every minute, when the browser comes back online and when the study page or console opens. The page shows `data-upload` as idle, sending, waiting or synced. Typed text stays masked in the trace as ADR 0376 has it.
- The recorder samples the viewer camera of every registered stage engine (slide, centre, zoom as log2 of screen pixels per slide pixel, slide size and stage size) four times a second and logs a `camera` event when it changes, because DOM frames do not hold the WebGL canvas. Replay draws the recorded view as a box on the slide's outline, so it works after the participant's project is deleted.
- Time to first action is the time from the task start to the first pointer press, key or wheel in the app outside the study bar. First click correct says whether that first press lands inside the task's `firstClick` selector, and is empty when a task names none. Path straightness is the straight distance from the first pointer position in the task to the first press, divided by the pointer path travelled to it, from 0 to 1.
- One filter leaves dry runs out of every table, mean, comparison, CSV and JSON export. The CSV has one row per task attempt. The round 4 column shows only the numbers quoted from the round 4 deck, labelled as reported, and never computes one.

## Consequences

- A study is readable from any browser signed in to the workspace, and a dry run can be marked after the fact.
- Round 4 had no recorded definition of time to first action, so the 4.8 s comparison holds only if its prototype measured the same thing. That is a TODO for the thesis text, not for the app.
- Trace parts grow with DOM frames. The 2 MiB cap per part and the 400 frame cap per session from ADR 0376 bound one session to tens of megabytes at worst.
