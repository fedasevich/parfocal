# 0085. Home is one aggregate read, with resume derived from review activity and announcements split out

- Date: 2026-10-18
- Status: Accepted
- Deciders: Yurii Fedas (standing approval)
- Backlog: HOME-000, HOME-001, HOME-002, HOME-003, HOME-009, HOME-010, HOME-011, ONB-006

## Context

The launchpad is everyone's home ([ADR 0021](0021-chosen-home-worklist-status-board-and-account-menu.md), [ADR 0053](0053-ai-results-review-direction.md)). The mock's home scenes ("launch" and "new") show these blocks.

| Block | What it shows in the mock |
|---|---|
| Greeting | The date, tasks in progress, mentions and the next due task |
| Continue | The task code and name, project, slide and case label, slide n of N, objects checked on that slide, due date, blinding, the slide image, Continue (guided review at the object) and Open in the full viewer |
| Start something | Upload, Run a model ("2 slides have no results yet"), New review task, Find an object, New project |
| Projects | A card per project with a strip of up to four slides and a dot for each reviewed one, the slide count, privacy mode, members and the share reviewed |
| This week in your projects | Objects I checked, the share where I agreed with the AI and the disagreements still open |
| Coming up | My tasks with progress and due dates, or who handed a new one to me |
| Announcements | A coloured dot by kind (a new model, a slow model server, a change), the text, who posted it and when |
| First week | The sample project as the Continue card and the getting-started checklist |

The department dashboard (HOME-004) is an idea and needs the metrics pipeline of HOME-005, so it gets no endpoint now. HOME-010 orders the same blocks by role and needs no data of its own. My work already derives "your tasks" ([ADR 0082](0082-my-work-query-api.md)). There is no stored resume state, no announcements table, no mentions (COLLAB) and no thumbnails in storage yet.

## Options considered

1. The client composes Home from existing endpoints: To review, projects, All slides, the disagreement queue per task, and new ones for the week and announcements. Nothing new to keep in step, but the first screen makes six or more requests, the project strip needs a slide list per project, and the queue is per task.
2. One `GET /api/me/home` that returns every block. One request and one permission pass, built from the same functions as My work and the queue. A slow block slows the whole page.
3. One endpoint per block under `/api/me/home/...`. Each block loads and fails alone, but there are more routes and requests, and the greeting needs numbers from three of them.

## Decision

Option 2. Home is the first screen after sign-in, so one round trip matters more than independent loading, and every block is a small read over the user's own tasks and projects.

`GET /api/me/home` returns:

- `resume`: the task, slide and object I worked on last, with the task's code, name, project, the slide's label and case label, its position among my slides (n of N), my verdicts on that slide, the due date and blinding. "Last" is the newest of my verdicts, my reviewed-layer edits and my added objects on a slide I have not submitted, in a task that is neither signed off nor archived. With no such activity it is my first unsubmitted slide in the To review order, with no object. `camera` is null until HOME-003 stores a resume state, and from then on a stored state wins when it is newer than the derived activity.
- `tasks`: the To review list of ADR 0082 with the submitted and signed-off tasks left out, ordered by due date with undated tasks last, and with the name of the person who created each task.
- `projects`: every project I am a member of that is not archived, with its code, name, colour, privacy mode, my role, the member count, the slide count, the result set count, the reviewed slide count (slides with at least one submitted review in any task) and a strip of the first four slides by creation, each with its id, label and whether it is reviewed. The image comes from the thumbnail route once thumbnails reach storage ([ADR 0075](0075-slide-thumbnails-and-overviews.md)).
- `slides_without_results`: slides in my projects with no result set, for the Run a model tile.
- `week`: over the last seven days ending now, the objects I gave a verdict on and the share of them that were agree, with unsure counted in the total. A rolling seven days avoids a locale's week start and time zone. `open_disagreements` counts undecided queue items over the tasks I may adjudicate (projects I read whole, tasks not signed off), and is null when there are none, because the queue is hidden from reviewers ([ADR 0080](0080-disagreement-rule-and-sign-off.md)).
- `announcements`: the workspace's current announcements, newest first. Admins post them with a kind (`model`, `slowdown`, `change`), a text and an optional end time. This is a new backend task, HOME-011 (announcements API), split from HOME-009 (announcements), which keeps the screen.

Mentions wait for COLLAB, and the checklist and the sample project wait for ONB-006 and ONB-004. Each adds a field to the same response when it lands. TODO: platform-wide announcements from Parfocal itself ("CellViT is now one of Parfocal's models") need a platform table outside row-level security, and are left out until the owner wants them.

## Consequences

- HOME-001 builds `GET /api/me/home` with an API test for each block and the tenant isolation suite. It depends on HOME-011 for announcements.
- HOME-011 (announcements API) is new: create, list, end and expiry, with permission and isolation tests. HOME-009 now depends on it and keeps the screen.
- HOME-003 (resume state) stores the camera, mode and selected object, and the aggregate prefers it when newer.
- The response grows as COLLAB, ONB-004 and ONB-006 land. The client must accept missing fields.
- Object-level progress on the Continue card ("4 of 6 regions checked") counts my verdicts on the slide, like ADR 0082, until the scope's candidates can be counted from storage.
