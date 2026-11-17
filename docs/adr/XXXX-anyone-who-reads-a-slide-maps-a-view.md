# XXXX. Anyone who can read a slide maps a view, and the audit event carries the GPU seconds

- Date: 2026-11-17
- Status: Accepted
- Deciders: Yurii Fedas (decision 129, who may map a view of a slide on the server, option B with the note that everyone gets all AI tools)
- Backlog: AITUM-013 (anyone who can read a slide maps a view). Amends [ADR 0357](0357-the-view-map-calls-the-interactive-lane.md) (the view map asks the interactive lane for one view tile at a time).

## Context

ADR 0357 gave `POST /api/slides/{slide_id}/view-map/{column}/{row}` (`scoreViewMapTile`) the "run models" right and a project the person controls, so a reviewer or a project viewer could not map a view. The owner chose in decision 129 that everyone who can read a slide gets every AI tool, and asked that the GPU seconds be counted per person. Decision 108 (whole-slide runs on annotate tasks) still keeps whole-slide runs to the "run models" right.

GPU seconds are counted today in `gpu_usage`, one row per job step. Its `job_id` is required and points at `jobs`, and it has no person column. A view tile is a blocking call on the interactive lane with no job.

## Options

1. Write view map seconds to `gpu_usage`. It needs a migration that makes `job_id` optional and adds a person, or a fake job row per tile that workers could claim and job lists would show.
2. Put the seconds in the `view-map.scored` audit event. The event already names the person through the audit pseudonym, the slide, the project and the tile, and it is written in the same transaction that answers the tile.
3. Count seconds per person in `rate_counters`. Its one-minute windows are swept after five minutes and only the auth scope sees it ([ADR 0088](0088-rate-limits-in-postgres-and-at-the-edge.md), rate limits in Postgres), so nothing would stay to count.

## Decision

Option 2.

- The route needs `see-slides` with write, the same right as warming the embedder (`warmSlideEmbedder`), and the slide must be readable by `readable_slide`. A service token without the `see-slides` scope gets 403. A person who cannot read the slide, such as an unassigned reviewer, a project outsider or another workspace, gets 404, as before. Hidden AI and a hidden tumor model still answer 404, so a reviewer on a blinded first read cannot map the view.
- The embedder pool's `ViewMapService.answer` times each answer inside its lock, so the seconds are the container's busy time for that tile and leave out the queue and the cold start. `parfocal_common.view_maps.timed` adds them to the reply as `seconds`, and `seconds_in` reads them back, refusing anything that is not a number from 0 to 3,600.
- The API writes `gpu_seconds` into the `view-map.scored` details, rounded to milliseconds. When the reply carries no valid seconds it writes the time it waited for the call instead, which is an upper bound.
- The web shows the "Map this view" panel to everyone who sees the slide outside the annotate workspace, as long as no heatmap result set is ready.

## Consequences

- API tests show a reviewer and a project viewer map a view, a token without read access gets 403, and two people's seconds sum to each of them separately in the audit log.
- The AI usage page (`getAiUsage`) still counts jobs only, so view map seconds do not show there. Showing them needs a migration that lets `gpu_usage` hold a row without a job and with a person (TODO, a follow-up task).
- Nothing caps a person's view map seconds yet. Each ask can still send up to 64 tile calls. A cap needs a number from the owner and fits in the follow-up above (TODO if the bill shows it).
- The first tile on a cold container includes the model fetch and the slide download in its seconds, because the container is busy for that person.
- The other consequences of ADR 0357 stand, such as one embedder container shared by view maps and segmentation embeds.
