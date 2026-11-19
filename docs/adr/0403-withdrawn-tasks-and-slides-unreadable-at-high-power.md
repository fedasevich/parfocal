# 0403. A withdrawn task keeps its rows and a slide unreadable at high power is a notice

- Date: 2026-11-19
- Status: Accepted
- Deciders: Claude
- Backlog: PROTO-051 (the API says when a task is withdrawn and when a slide cannot be read at high power)

## Context

PROTO-048 (the viewer's issue states show the mock's cards) read a withdrawn task from a 404, so the review objects never loaded and the answer buttons could not show why they were off. It read a slide that cannot be read at high power only from failed tiles at the two highest magnifications, so the card appeared only after the reader had zoomed in and waited. The API had no way to withdraw a task and no slide fact for either case.

## Options considered

| Option | For | Against |
| --- | --- | --- |
| 1. Withdraw by setting `archived_at` | No migration | Every read of a task filters on `archived_at`, so the task and its objects disappear, which is the 404 the viewer already had |
| 2. A status column with an enum | One field names every state | The other states (in review, signed off) are derived from decisions and sign offs today, so a status column would duplicate them and could disagree |
| 3. Nullable `withdrawn_at` and `withdrawn_by_user_id` on `review_tasks` | Additive migration, the task stays readable, the date is there for the card | Lists that should hide a withdrawn task must filter it themselves |
| A. A new boolean column on `slides` | Plain to query | A migration for a fact that is one of many reading notices |
| B. A `high-power-unreadable` code in the existing `slides.notices` array | No migration, ingest already writes notices and the upload screen already explains them | The flag is read by looking for a code in an array |

## Decision

Option 3 with flag B.

- `POST /api/review-tasks/{task_id}/withdraw` is for project owners. It sets `withdrawn_at` once, writes the `task.withdrawn` audit entry and returns the task. A second call changes nothing.
- A withdrawn task still answers `GET /api/review-tasks/{task_id}` and its objects. Saving a decision answers 409 `task-withdrawn`.
- `POST /api/slides/{slide_id}/high-power-failure` adds `high-power-unreadable` to the slide's notices once. The viewer calls it on the first failed tile at the two highest magnifications. Ingest can write the same code through the notices it already stores.
- `listMySlides` rows carry `high_power_unreadable`. The engine viewer shows the unreadable card from it as soon as the slide opens, and Retry hides that card until a tile fails again.

## Consequences

- My work and the other task lists do not hide withdrawn tasks yet. TODO: filter them where a withdrawn task should not appear.
- The ingest worker does not probe high power reads yet, so the flag comes from the viewer in practice.
- Nothing clears the flag after a later read succeeds.
