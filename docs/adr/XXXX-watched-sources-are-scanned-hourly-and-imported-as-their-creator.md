# XXXX. Watched sources are scanned hourly and imported as the person who set them up

- Date: 2026-11-17
- Status: Accepted
- Deciders: agent, for Yurii Fedas
- Backlog: REMOTE-004 (watched folder or bucket), REMOTE-006 (a connected source that stays down notifies the admins)

## Context

[ADR 0379](0379-remote-sources-read-in-place-signed-webhooks-and-at-least-once-events.md) (remote sources read in place, signed webhooks, events delivered at least once) lists a watched folder or bucket next to the webhook in. A watch has to notice new files without a person, put them through the same checks as an upload, never import a file twice, and run in a production that scales to zero. Modal allows five deployed crons, and the hourly `events` run already carries event delivery and the remote cache sweep ([ADR 0383](0383-remote-slides-are-served-by-the-api-from-cached-byte-ranges.md), remote slides served from cached byte ranges). ADR 0379 also says a source that stays down for 15 minutes writes one `integration-down` notification, which nothing wrote yet.

## Decision

1. A project watches at most one saved import source. The watch row keeps the source, the person who set it up and when it was last scanned. Setting one up needs the integrations permission, as the webhook secret does.
2. Setting up a watch lists the source once and records every file already there as seen. Only files that arrive afterwards are imported, so pointing a watch at a full archive copies nothing.
3. The scheduled hourly `events` run scans every watch after it sweeps the caches. No new cron, nothing that stays awake, and the mock's 5 and 10 minute choices are shown as 1 hour.
4. A scan acts as the person who set the watch up. It lists the source with the saved credential, sorts and pairs the new files with the same code as a link import (`look`, `planned_files`, `start_file`), and so re-checks that this person may still upload to the project. Uploads are created by that person and audited with the system actor. A scan starts at most 50 new slides, and the rest wait for the next hour.
5. Every file a scan considered is written to `watched_files` (name, classed as PHI, and the upload it started), whether it started, was left out as a duplicate or was refused later. A file is never imported twice by the same watch, and a refused file is refused once.
6. New slides are copied into Parfocal. Reading them in place is a later choice.
7. A source is down when one of its live remote slides has failed three reads in a row and has been failing for 15 minutes, which is the rule the admin storage screen already shows as unreachable. The check runs in the hourly run and whenever a token mint or a tile read fails. `import_sources.down_notified_at` is claimed with a conditional update, so one outage writes one `integration-down` notification to the workspace admins even when the two checks race, and an outage that starts after the last notice notifies again. The notification targets the source, its inbox line opens the admin storage screen, and its payload holds the source name but never its address.

## Alternatives

- Importing everything at the first scan is simpler, but a watch pointed at a lab archive would copy terabytes the owner pays for.
- A dedicated cron every 10 minutes would match the mock, but it needs one of the five crons and wakes Neon six times as often.
- A service account for watches would survive the creator leaving, but no such principal can upload today. A watch whose creator is gone simply stops, as a webhook whose owner is gone does.
- Deduplicating by what is already in the project would need no ledger, but a file still being fetched or refused would be imported again every hour.
- Clearing the notice marker when a slide reads again would also allow a second notice, but it needs a write on the tile path, while comparing with the outage start needs none.

## Consequences

- Migrations add `import_sources.down_notified_at`, `source_watches` and `watched_files`.
- `watchSource` and `stopWatchingSource` set and remove the watch, and `getProjectImports` shows it under the watched folder.
- Nothing starts the `ingest` Modal function yet (see `knowledge/deploy.md`), so in production a watched file waits like any other upload until a worker runs.
- Still to build: the switch and source picker in the project imports overlay, reading new slides in place, and a scan of folders below the top level.
